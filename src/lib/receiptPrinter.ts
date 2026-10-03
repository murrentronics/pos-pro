/**
 * receiptPrinter.ts — builds an ESC/POS receipt payload and sends it
 * through the active printer connection (USB or Bluetooth).
 *
 * Connection management lives in printerConnection.ts.
 * This file only handles ESC/POS command building + the public printReceipt() call.
 */

import {
  disconnectPrinter,
  isPrinterConnected,
  sendBytesToPrinter,
  type PrintResult,
} from "@/lib/printerConnection";
import { buildCreditBillEscPos } from "@/lib/creditBillEscPos";
import { buildSupplierStatementEscPos, type SupplierStatement } from "@/lib/supplierStatementEscPos";
import { brandReceipt } from "@/lib/receiptSettings";
import {
  DRAWER_PULSE_HEX,
  getSavedPrinterPort,
  isElectronApp,
  printAndOpenDrawerElectron,
  savePrinterConnection,
} from "@/lib/electronPrinter";

export type { PrintResult };

const COL_WIDTH = 48;

export interface CreditBillEntry {
  when: string;
  kind: "charge" | "payment" | "cash";
  lines: { name: string; qty: number; price: number }[];
  amount: number;
  note?: string | null;
}

/** Full customer bill: every charge, cash sale, and payment, plus the balance owed. */
export interface CreditBill {
  entries: CreditBillEntry[];
  charges: number;
  payments: number;
  cashSales: number;
  balanceOwed: number;
}

function esc(b: number): string {
  return String.fromCharCode(b);
}

export interface ReceiptData {
  storeName: string;
  locationName?: string;
  orderNumber?: string | number;
  serverName?: string;
  items: { name: string; qty: number; price: number }[];
  subtotal: number;
  discount?: number;
  originalTotal?: number;
  tax?: number;
  total: number;
  paid: number;
  change: number;
  payMode: string;
  customerName?: string;
  date?: string;
  /** Printed under the totals. Defaults to "Thank you for your purchase!" */
  footerTagline?: string;
  /** Logo data URL, shown above the store name. */
  logoUrl?: string;
  /** Prebuilt ESC/POS raster for the logo. Set by brandReceipt before printing. */
  logoEscPos?: string;
  creditBill?: CreditBill;
  supplierStatement?: SupplierStatement;
}

// ─── ESC/POS builder ──────────────────────────────────────────────────────────

export function buildReceiptEscPos(data: ReceiptData): Uint8Array {
  if (data.creditBill) return buildCreditBillEscPos(data);
  if (data.supplierStatement) {
    return buildSupplierStatementEscPos({
      storeName: data.storeName,
      date: data.date || new Date().toLocaleString("en-GB", { timeZone: "America/Port_of_Spain" }),
      statement: data.supplierStatement,
      logoEscPos: data.logoEscPos,
    });
  }
  const lines: string[] = [];

  lines.push(esc(0x1b) + esc(0x40)); // reset
  lines.push(esc(0x1b) + esc(0x61) + esc(0x01)); // center

  if (data.logoEscPos) lines.push(data.logoEscPos);
  lines.push(bold((data.storeName || "My Business").toUpperCase()));
  if (data.locationName) lines.push(data.locationName);

  const dateStr =
    data.date ||
    new Date().toLocaleString("en-US", {
      month: "numeric", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
    });
  lines.push(dateStr);
  lines.push(`Served by ${data.serverName || "Staff"}`);
  if (data.customerName) lines.push(`Customer: ${data.customerName}`);
  lines.push(hr());

  lines.push(esc(0x1b) + esc(0x61) + esc(0x01));
  lines.push(esc(0x1d) + esc(0x21) + esc(0x11));
  lines.push(esc(0x1b) + esc(0x45) + esc(0x01));
  lines.push(`ORDER #${data.orderNumber ?? 1}`);
  lines.push(esc(0x1d) + esc(0x21) + esc(0x00));
  lines.push(esc(0x1b) + esc(0x45) + esc(0x00));
  lines.push(hr());

  lines.push(esc(0x1b) + esc(0x61) + esc(0x00)); // left align
  for (const it of data.items) {
    const qtyPrefix = `${it.qty}x `;
    const priceStr = `$${(it.qty * it.price).toFixed(2)}`;
    const maxNameLen = COL_WIDTH - qtyPrefix.length - priceStr.length;
    const nameStr = (it.name || "").padEnd(Math.max(1, maxNameLen)).slice(0, Math.max(1, maxNameLen));
    lines.push(`${qtyPrefix}${nameStr}${priceStr}`);
  }
  lines.push(hr());

  lines.push(row("Subtotal", `$${data.subtotal.toFixed(2)}`));
  if (data.discount != null && data.discount > 0) {
    lines.push(row("Discount", `-$${data.discount.toFixed(2)}`));
  }
  if (data.tax != null && data.tax > 0) lines.push(row("Tax", `$${data.tax.toFixed(2)}`));
  lines.push(bold(row("Total", `$${data.total.toFixed(2)}`)));
  lines.push(hr());

  const payLabel = data.payMode === "credit" ? "Credit" : "Cash Tendered";
  lines.push(row(payLabel, `$${data.paid.toFixed(2)}`));
  lines.push(row("Change", `$${data.change.toFixed(2)}`));

  lines.push(hr());
  lines.push(esc(0x1b) + esc(0x61) + esc(0x01));
  lines.push((data.footerTagline || "").trim() || "Thank you for your purchase!");
  lines.push(esc(0x1b) + esc(0x64) + esc(0x05)); // feed 5 lines
  lines.push(esc(0x1d) + esc(0x56) + esc(0x42) + esc(0x00)); // partial cut

  const payload = lines.join("\n");
  const bytes = new Uint8Array(payload.length);
  for (let i = 0; i < payload.length; i++) bytes[i] = payload.charCodeAt(i) & 0xff;
  return bytes;
}

function center(text: string): string {
  return text.padStart(Math.floor((COL_WIDTH + text.length) / 2)).slice(0, COL_WIDTH);
}
function bold(text: string): string {
  return esc(0x1b) + esc(0x45) + esc(0x01) + text + esc(0x1b) + esc(0x45) + esc(0x00);
}
function hr(): string { return "-".repeat(COL_WIDTH); }
function row(label: string, value: string): string {
  const gap = COL_WIDTH - label.length - value.length;
  return label + " ".repeat(Math.max(1, gap)) + value;
}

// ─── Public API ───────────────────────────────────────────────────────────────

function withDate(data: ReceiptData): ReceiptData {
  const dateStr = data.date || new Date().toLocaleString("en-US", {
    month: "numeric", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  });
  return { ...data, date: dateStr };
}

export async function printReceipt(data: ReceiptData): Promise<PrintResult> {
  const branded = await brandReceipt(data);
  const payload = buildReceiptEscPos(withDate(branded));
  return sendBytesToPrinter(payload);
}

/** Cash sales: print the receipt and kick the drawer on the same connection. */
export async function printReceiptAndOpenDrawer(data: ReceiptData): Promise<PrintResult> {
  const branded = await brandReceipt(data);
  const payload = buildReceiptEscPos(withDate(branded));
  if (isElectronApp()) {
    const port = getSavedPrinterPort();
    if (!port) return { printed: false, mode: "none", error: "Connect a printer first" };
    const pulse = (typeof localStorage !== "undefined" && localStorage.getItem("pospro-drawer-pulse")) || DRAWER_PULSE_HEX;
    const result = await printAndOpenDrawerElectron(port, payload, pulse.replace(/\s+/g, ""));
    return { printed: !!result.success, mode: "usb", error: result.error, label: port };
  }
  const pulseHex = (typeof localStorage !== "undefined" && localStorage.getItem("pospro-drawer-pulse")) || DRAWER_PULSE_HEX;
  const pairs = pulseHex.replace(/\s+/g, "").match(/[0-9a-fA-F]{2}/g) ?? [];
  const pulse = new Uint8Array(pairs.map((h) => parseInt(h, 16)));
  const combined = new Uint8Array(payload.length + pulse.length);
  combined.set(payload, 0);
  combined.set(pulse, payload.length);
  return sendBytesToPrinter(combined);
}

function notifyPrinterChanged() {
  try { window.dispatchEvent(new CustomEvent("pospro-printer-changed")); } catch { /* ignore */ }
}

/** Desktop EXE: remember the Windows printer or COM port chosen in the connect window. */
export function connectElectronPrinter(opts: {
  path: string;
  label?: string;
  vendorId?: string;
  productId?: string;
}): boolean {
  if (!opts.path) return false;
  savePrinterConnection(opts.path);
  try {
    localStorage.setItem("pospro-printer-mode", "usb");
    localStorage.setItem("pospro-electron-printer-name", opts.label || opts.path);
    if (opts.vendorId) localStorage.setItem("pospro-printer-vid", String(parseInt(opts.vendorId, 16) || opts.vendorId));
    if (opts.productId) localStorage.setItem("pospro-printer-pid", String(parseInt(opts.productId, 16) || opts.productId));
    window.electronAPI?.persistSet?.("pospro-electron-printer-name", opts.label || opts.path);
  } catch { /* ignore */ }
  notifyPrinterChanged();
  return true;
}

/** True when a printer was already connected. Desktop only counts a saved EXE printer. */
export async function isPrinterPaired(): Promise<boolean> {
  return isPrinterConnected();
}

export type PrinterConnectionType = "usb" | "bt" | "none";

const BLE_SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
const BLE_SERVICE_UUID_ALT = "e7810a71-73ae-499d-8c15-faa9aef0c3f2";
const ALL_BLE_OPTIONAL = [BLE_SERVICE_UUID, BLE_SERVICE_UUID_ALT];

function readKey(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeKey(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
function removeKey(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function getPrinterConnectionType(): PrinterConnectionType {
  if (isElectronApp() && getSavedPrinterPort()) return "usb";
  const saved = readKey("pospro-printer-mode");
  if (saved === "bt" || saved === "usb") return saved;
  return "none";
}

export function getSavedPrinterLabel(): string {
  return readKey("pospro-electron-printer-name")
    || readKey("pospro-printer-bt-name")
    || (getPrinterConnectionType() === "usb" ? "USB printer" : "")
    || "";
}

/**
 * Pair a USB printer.
 * Desktop EXE opens the in-app printer window only. Epson printers are Windows
 * printers, not COM ports, so this never auto-picks a serial device.
 * Browser uses WebUSB (Epson and other receipt vendors). Cancelling that picker
 * does not open a second serial-port picker.
 */
export async function pairUsbPrinter(): Promise<boolean> {
  if (isElectronApp()) return openPrinterConnectDialog();

  const usb = (navigator as unknown as { usb?: { requestDevice: (opts: { filters: Record<string, number>[] }) => Promise<{ vendorId: number; productId: number }> } }).usb;
  if (usb?.requestDevice) {
    try {
      const device = await usb.requestDevice({
        filters: [
          { classCode: 7 },
          { vendorId: 0x04b8 }, // Epson
          { vendorId: 0x0519 }, // Star
          { vendorId: 0x1504 }, // Citizen
          { vendorId: 0x0dd4 }, // Bixolon
          { vendorId: 0x0483 }, // ST / many Chinese POS
          { vendorId: 0x1a86 }, // WCH CH340
          { vendorId: 0x0403 }, // FTDI
        ],
      });
      writeKey("pospro-printer-vid", String(device.vendorId));
      writeKey("pospro-printer-pid", String(device.productId));
      writeKey("pospro-printer-mode", "usb");
      removeKey("pospro-printer-bt-name");
      notifyPrinterChanged();
      return true;
    } catch {
      return false;
    }
  }

  const serial = (navigator as unknown as { serial?: { requestPort: () => Promise<{ getInfo: () => { usbVendorId?: number; usbProductId?: number } }> } }).serial;
  if (serial?.requestPort) {
    try {
      const port = await serial.requestPort();
      const info = port.getInfo();
      if (info.usbVendorId != null) writeKey("pospro-printer-vid", String(info.usbVendorId));
      if (info.usbProductId != null) writeKey("pospro-printer-pid", String(info.usbProductId));
      writeKey("pospro-printer-mode", "usb");
      removeKey("pospro-printer-bt-name");
      notifyPrinterChanged();
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Pair a Bluetooth printer. One picker only — cancelling does not open another.
 */
export async function pairBluetoothPrinter(): Promise<boolean> {
  const bt = (navigator as unknown as {
    bluetooth?: {
      requestDevice: (opts: { acceptAllDevices: boolean; optionalServices: string[] }) => Promise<{ name?: string } | null>;
    };
  }).bluetooth;
  if (!bt?.requestDevice) return false;
  try {
    const device = await bt.requestDevice({
      acceptAllDevices: true,
      optionalServices: ALL_BLE_OPTIONAL,
    });
    if (!device) return false;
    writeKey("pospro-printer-mode", "bt");
    writeKey("pospro-printer-bt-name", device.name || "Bluetooth printer");
    removeKey("pospro-printer-vid");
    removeKey("pospro-printer-pid");
    notifyPrinterChanged();
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("cancel") || msg.toLowerCase().includes("user cancelled") || msg.toLowerCase().includes("chooser")) {
      return false;
    }
    throw e;
  }
}

export async function pairPrinter(): Promise<boolean> {
  if (isElectronApp()) return openPrinterConnectDialog();
  if (getPrinterConnectionType() === "bt") return pairBluetoothPrinter();
  return pairUsbPrinter();
}

export function clearPrinterPairing() {
  try { localStorage.removeItem("pospro-electron-printer-name"); } catch { /* ignore */ }
  disconnectPrinter();
}

type ConnectDialogResolver = (ok: boolean) => void;
let connectDialogResolver: ConnectDialogResolver | null = null;

/** Open the in-app printer window. Resolves when the user connects or closes it. */
export function openPrinterConnectDialog(): Promise<boolean> {
  if (connectDialogResolver) {
    connectDialogResolver(false);
    connectDialogResolver = null;
  }
  return new Promise((resolve) => {
    connectDialogResolver = resolve;
    try {
      window.dispatchEvent(new Event("pospro-open-printer-connect"));
    } catch {
      connectDialogResolver = null;
      resolve(false);
    }
  });
}

export function resolvePrinterConnectDialog(ok: boolean) {
  const resolve = connectDialogResolver;
  connectDialogResolver = null;
  resolve?.(ok);
}
