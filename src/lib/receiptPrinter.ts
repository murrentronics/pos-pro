/**
 * receiptPrinter.ts — prints a sale receipt to an ESC/POS thermal printer.
 *
 * Sends raw ESC/POS commands over the Web Serial API or, when running inside
 * the Capacitor Android app, falls back to opening a browser print window
 * (the native USB host path for printers is not yet wired up here).
 *
 * Hardware overrides (optional — set via localStorage):
 *   pospro-receipt-vid -> decimal USB vendor id filter
 *   pospro-receipt-pid -> decimal USB product id filter
 */

const COL_WIDTH = 48;

function esc(b: number): string {
  return String.fromCharCode(b);
}

function buildReceiptEscPos(data: {
  storeName: string;
  items: { name: string; qty: number; price: number }[];
  subtotal: number;
  total: number;
  paid: number;
  change: number;
  payMode: string;
  customerName?: string;
  date: string;
}): string {
  const cmds: string[] = [];

  cmds.push(esc(0x1b) + esc(0x40));
  cmds.push(esc(0x1b) + esc(0x61) + esc(0x01));

  cmds.push(center(data.storeName, true));
  cmds.push(center("RECEIPT", true));
  cmds.push(center(data.date));
  cmds.push(hr());

  for (const it of data.items) {
    const line = `${padRight(it.qty + "x", 5)} ${padRight(it.name, 20)} ${padLeft("$" + it.price.toFixed(2), 12)}`;
    cmds.push(line);
    const total = it.qty * it.price;
    cmds.push(`${padRight("", 5)} ${padRight("", 20)} ${padLeft("$" + total.toFixed(2), 12)}`);
  }

  cmds.push(hr());
  cmds.push(`${padRight("SUBTOTAL", 26)} ${padLeft("$" + data.subtotal.toFixed(2), 12)}`);
  cmds.push(`${padRight("TOTAL", 26)} ${padLeft("$" + data.total.toFixed(2), 12)}`);

  cmds.push(hr());
  cmds.push(`${padRight("PAYMENT", 26)} ${padLeft(data.payMode.toUpperCase(), 12)}`);
  cmds.push(`${padRight("PAID", 26)} ${padLeft("$" + data.paid.toFixed(2), 12)}`);
  cmds.push(`${padRight("CHANGE", 26)} ${padLeft("$" + data.change.toFixed(2), 12)}`);

  if (data.customerName) {
    cmds.push(hr());
    cmds.push(`CUSTOMER: ${data.customerName}`);
  }

  cmds.push(hr());
  cmds.push(center("Thank you for your purchase!", false));
  cmds.push(esc(0x1b) + esc(0x64) + esc(0x03));
  cmds.push(esc(0x1d) + esc(0x56) + esc(0x42) + esc(0x00));

  return cmds.join("\n");
}

function center(text: string, bold = false): string {
  const tag = bold ? esc(0x1b) + esc(0x45) + esc(0x01) : "";
  const reset = bold ? esc(0x1b) + esc(0x45) + esc(0x00) : "";
  const padded = text.padStart(Math.floor((COL_WIDTH + text.length) / 2)).slice(0, COL_WIDTH);
  return `${tag}${padded}${reset}`;
}

function hr(): string {
  return "\u2500".repeat(COL_WIDTH);
}

function padLeft(s: string, w: number): string {
  return s.padStart(w).slice(-w);
}

function padRight(s: string, w: number): string {
  return s.padEnd(w).slice(0, w);
}

function readStorage(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

export interface ReceiptData {
  storeName: string;
  items: { name: string; qty: number; price: number }[];
  subtotal: number;
  total: number;
  paid: number;
  change: number;
  payMode: string;
  customerName?: string;
}

export async function printReceipt(
  data: ReceiptData,
): Promise<{ opened: boolean; method: string; error?: string }> {
  const date = new Date().toLocaleString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const payload = buildReceiptEscPos({ ...data, date });
  const vid = parseInt(readStorage("pospro-receipt-vid") ?? "", 10);
  const pid = parseInt(readStorage("pospro-receipt-pid") ?? "", 10);

  try {
    if (
      typeof navigator !== "undefined" &&
      (navigator as unknown as { serial?: { requestPort?: unknown } }).serial?.requestPort
    ) {
      return await printViaWebSerial(payload, vid, pid);
    }
  } catch {
    // fall through to browser fallback
  }

  return printViaBrowserWindow(payload);
}

interface WebSerialPort {
  open(options: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: string;
    bufferSize?: number;
  }): Promise<void>;
  close(): Promise<void>;
  forget?(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  writable: WritableStream<Uint8Array>;
}

interface WebSerialAPI {
  requestPort(options?: { filters?: { usbVendorId: number }[] }): Promise<WebSerialPort>;
  getPorts(): Promise<WebSerialPort[]>;
}

async function printViaWebSerial(
  payload: string,
  vid?: number,
  pid?: number,
): Promise<{ opened: boolean; method: string; error?: string }> {
  const serial = (navigator as unknown as { serial?: WebSerialAPI }).serial;
  if (!serial?.requestPort) {
    return printViaBrowserWindow(payload);
  }

  let port: WebSerialPort | undefined;
  try {
    const granted = await serial.getPorts();
    if (vid != null) {
      port = granted.find((p) => p.getInfo().usbVendorId === vid);
    }
    if (!port) port = granted[0];
  } catch {
    // ignore — fall through to requestPort
  }

  if (!port) {
    const filters = vid != null ? [{ usbVendorId: vid }] : undefined;
    port = await serial.requestPort(filters ? { filters } : undefined);
  }

  await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none", bufferSize: 4096 });

  try {
    const writer = await port.writable.getWriter();
    await writer.write(new Uint8Array([...payload].map((c) => c.charCodeAt(0))));
    writer.releaseLock();
  } finally {
    await new Promise((r) => setTimeout(r, 200));
    await port.close().catch(() => undefined);
  }

  return { opened: true, method: "webserial" };
}

function printViaBrowserWindow(payload: string): {
  opened: boolean;
  method: string;
  error?: string;
} {
  try {
    const win = window.open("", "_blank", "width=400,height=600");
    if (!win) {
      return {
        opened: false,
        method: "none",
        error: "Popup blocked — allow popups to print receipts",
      };
    }
    win.document.write(`<!DOCTYPE html><html><head><title>Receipt</title><style>
      body { font-family: monospace; font-size: 12px; margin: 0; padding: 10px; white-space: pre; }
    </style></head><body>${escapeHtml(payload)}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
    }, 300);
    return { opened: true, method: "browser" };
  } catch (e) {
    return {
      opened: false,
      method: "none",
      error: e instanceof Error ? e.message : "Failed to open print window",
    };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
