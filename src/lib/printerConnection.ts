/**
 * printerConnection.ts — Manages a persistent printer connection for P.O.S. Pro.
 *
 * Supports three connection modes:
 *   USB     — Web Serial API (Chrome/Edge on desktop; Chrome Android via USB-C/OTG)
 *   BT      — Web Bluetooth API (wireless thermal printers)
 *   Native  — Capacitor Android plugin (USB Host on POS terminals)
 *
 * The cash drawer is always wired through the printer, so once the printer is
 * connected, openDrawer() reuses the same port/device.
 *
 * Connection state is persisted to localStorage so it survives page reloads.
 * The actual port/device handle is re-acquired from getPorts()/getDevices() on
 * load — no stale handles are stored.
 *
 * localStorage keys:
 *   pospro-printer-mode    -> "usb" | "bt" | "none"
 *   pospro-printer-vid     -> decimal USB vendor id (USB mode only)
 *   pospro-printer-pid     -> decimal USB product id (USB mode only)
 *   pospro-printer-bt-name -> Bluetooth device name (BT mode only)
 *   pospro-drawer-pulse    -> hex ESC/POS pulse bytes (default: 1b70001919)
 */

import { Capacitor } from "@capacitor/core";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PrinterMode = "usb" | "bt" | "none";

export interface PrinterInfo {
  mode: PrinterMode;
  /** Human-readable device label, e.g. "VID 0x6868 PID 0x0200" or BT name */
  label?: string;
}

export interface ConnectResult {
  connected: boolean;
  mode: PrinterMode;
  label?: string;
  error?: string;
}

export interface PrintResult {
  printed: boolean;
  mode: PrinterMode;
  label?: string;
  error?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function clear(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// ─── Serial (USB) types ───────────────────────────────────────────────────────

interface SerialPort {
  open(opts: { baudRate: number; dataBits?: number; stopBits?: number; parity?: string; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  forget?(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  writable: WritableStream<Uint8Array>;
}
interface WebSerialAPI {
  requestPort(opts?: { filters?: { usbVendorId: number }[] }): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}
function getSerial(): WebSerialAPI | null {
  return (navigator as any).serial ?? null;
}

// ─── Bluetooth types ──────────────────────────────────────────────────────────

interface BtCharacteristic {
  writeValueWithoutResponse(data: BufferSource): Promise<void>;
  writeValue(data: BufferSource): Promise<void>;
}
interface BtService {
  getCharacteristic(uuid: string): Promise<BtCharacteristic>;
}
interface BtServer {
  connect(): Promise<BtServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BtService>;
  connected: boolean;
}
interface BtDevice {
  name?: string;
  gatt?: BtServer;
  forget?(): Promise<void>;
}
interface WebBluetoothAPI {
  requestDevice(opts: { filters?: { services?: string[] }[]; optionalServices?: string[]; acceptAllDevices?: boolean }): Promise<BtDevice>;
  getDevices?(): Promise<BtDevice[]>;
}
function getBluetooth(): WebBluetoothAPI | null {
  return (navigator as any).bluetooth ?? null;
}

// Standard BLE Serial Port Profile service/characteristic UUIDs
const SPP_SERVICE = "000018f0-0000-1000-8000-00805f9b34fb";
const SPP_CHAR    = "00002af1-0000-1000-8000-00805f9b34fb";
// Fallback: Nordic UART Service
const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_TX_CHAR = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

// ─── Native Capacitor drawer types ───────────────────────────────────────────

interface NativePrinterApi {
  print: (opts: { bytes: number[] }) => Promise<{ printed: boolean; error?: string }>;
  openDrawer: (opts: { pulseHex: string }) => Promise<{ opened: boolean; error?: string }>;
}

function getNativeApi(): NativePrinterApi | null {
  const plugins = (Capacitor as any).Plugins as Record<string, any> | undefined;
  return plugins?.CashDrawer ?? null;
}

// ─── ESC/POS drawer pulse ─────────────────────────────────────────────────────

const DEFAULT_PULSE_HEX = "1b70001919";
function getDrawerPulse(): Uint8Array {
  const hex = (read("pospro-drawer-pulse") ?? DEFAULT_PULSE_HEX).replace(/\s+/g, "");
  const pairs = hex.match(/[0-9a-fA-F]{2}/g) ?? [];
  return new Uint8Array(pairs.map((h) => parseInt(h, 16)));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns the persisted connection info (no I/O — instant). */
export function getConnectionInfo(): PrinterInfo {
  const mode = (read("pospro-printer-mode") ?? "none") as PrinterMode;
  if (mode === "usb") {
    const vid = read("pospro-printer-vid");
    const pid = read("pospro-printer-pid");
    const label = vid && pid ? `USB · VID ${vid} PID ${pid}` : "USB printer";
    return { mode: "usb", label };
  }
  if (mode === "bt") {
    const name = read("pospro-printer-bt-name");
    return { mode: "bt", label: name ? `BT · ${name}` : "Bluetooth printer" };
  }
  return { mode: "none" };
}

/** Returns true if a printer was previously connected (mode ≠ "none"). */
export function isPrinterConnected(): boolean {
  return (read("pospro-printer-mode") ?? "none") !== "none";
}

/**
 * Connect to a USB serial printer.
 * Shows the OS device picker (user gesture required).
 * Persists the VID/PID so future calls reuse the port silently.
 */
export async function connectUSB(): Promise<ConnectResult> {
  const serial = getSerial();
  if (!serial) {
    return { connected: false, mode: "usb", error: "Web Serial not available — use Chrome/Edge or install the app" };
  }
  try {
    const port = await serial.requestPort();
    const info = port.getInfo();
    const vid = info.usbVendorId;
    const pid = info.usbProductId;
    if (vid != null) store("pospro-printer-vid", String(vid));
    if (pid != null) store("pospro-printer-pid", String(pid));
    store("pospro-printer-mode", "usb");
    const label = vid != null && pid != null ? `USB · VID ${vid} PID ${pid}` : "USB printer";
    return { connected: true, mode: "usb", label };
  } catch (e: unknown) {
    return { connected: false, mode: "usb", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Connect to a Bluetooth thermal printer.
 * Shows the OS Bluetooth picker (user gesture required).
 * Persists the device name.
 */
export async function connectBluetooth(): Promise<ConnectResult> {
  const bt = getBluetooth();
  if (!bt) {
    return { connected: false, mode: "bt", error: "Web Bluetooth not available — use Chrome on Android" };
  }
  try {
    const device = await bt.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SPP_SERVICE, NUS_SERVICE],
    });
    const name = device.name ?? "Bluetooth printer";
    store("pospro-printer-mode", "bt");
    store("pospro-printer-bt-name", name);
    return { connected: true, mode: "bt", label: `BT · ${name}` };
  } catch (e: unknown) {
    return { connected: false, mode: "bt", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Clears stored printer connection. */
export function disconnectPrinter(): void {
  store("pospro-printer-mode", "none");
  clear("pospro-printer-vid");
  clear("pospro-printer-pid");
  clear("pospro-printer-bt-name");
}

/**
 * Send raw bytes to the printer (USB or Bluetooth).
 * Reuses a previously-granted port/device — no OS picker shown.
 * Opens, writes, then closes the connection.
 */
export async function sendBytesToPrinter(bytes: Uint8Array): Promise<PrintResult> {
  const mode = (read("pospro-printer-mode") ?? "none") as PrinterMode;

  // ── Capacitor native path ────────────────────────────────────────────────
  if (Capacitor.isNativePlatform()) {
    const api = getNativeApi();
    if (api?.print) {
      try {
        const r = await api.print({ bytes: Array.from(bytes) });
        if (r.printed) return { printed: true, mode: "usb", label: "Native USB" };
      } catch { /* fall through */ }
    }
  }

  // ── USB / Web Serial ─────────────────────────────────────────────────────
  if (mode === "usb") {
    const serial = getSerial();
    if (!serial) return { printed: false, mode: "none", error: "Web Serial not available" };

    const vidStr = read("pospro-printer-vid");
    const vid = vidStr ? parseInt(vidStr, 10) : undefined;

    let port: SerialPort | undefined;
    try {
      const granted = await serial.getPorts();
      if (vid != null) port = granted.find((p) => p.getInfo().usbVendorId === vid);
      if (!port) port = granted[0];
    } catch { /* fall through */ }

    if (!port) return { printed: false, mode: "usb", error: "Printer not found — reconnect via USB" };

    try {
      await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none", bufferSize: 4096 });
      const info = port.getInfo();
      const label = info.usbVendorId != null ? `USB · VID ${info.usbVendorId} PID ${info.usbProductId}` : "USB printer";
      const writer = port.writable.getWriter();
      try { await writer.write(bytes); } finally { writer.releaseLock(); }
      await new Promise((r) => setTimeout(r, 250));
      await port.close().catch(() => {});
      return { printed: true, mode: "usb", label };
    } catch (e: unknown) {
      return { printed: false, mode: "usb", error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── Bluetooth ────────────────────────────────────────────────────────────
  if (mode === "bt") {
    const bt = getBluetooth();
    if (!bt) return { printed: false, mode: "none", error: "Web Bluetooth not available" };

    const btName = read("pospro-printer-bt-name") ?? "Bluetooth printer";

    try {
      // Try to get a previously-paired device without re-prompting
      let device: BtDevice | undefined;
      if (bt.getDevices) {
        const devices = await bt.getDevices();
        device = devices[0];
      }
      if (!device) return { printed: false, mode: "bt", error: "Bluetooth printer not found — reconnect" };

      const server = await device.gatt!.connect();
      let char: BtCharacteristic | undefined;

      // Try SPP service first, fall back to NUS
      try {
        const svc = await server.getPrimaryService(SPP_SERVICE);
        char = await svc.getCharacteristic(SPP_CHAR);
      } catch {
        try {
          const svc = await server.getPrimaryService(NUS_SERVICE);
          char = await svc.getCharacteristic(NUS_TX_CHAR);
        } catch { /* char stays undefined */ }
      }

      if (!char) {
        server.disconnect();
        return { printed: false, mode: "bt", error: "Could not find print characteristic on device" };
      }

      // Send in 512-byte chunks (BLE MTU limit)
      const CHUNK = 512;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const chunk = bytes.slice(i, i + CHUNK);
        try { await char.writeValueWithoutResponse(chunk); }
        catch { await char.writeValue(chunk); }
        await new Promise((r) => setTimeout(r, 20));
      }

      server.disconnect();
      return { printed: true, mode: "bt", label: `BT · ${btName}` };
    } catch (e: unknown) {
      return { printed: false, mode: "bt", error: e instanceof Error ? e.message : String(e) };
    }
  }

  return { printed: false, mode: "none", error: "No printer connected" };
}

/**
 * Open the cash drawer through the active printer connection.
 * Sends ESC/POS pulse via USB or Bluetooth — same device as the printer.
 */
export async function openDrawerViaPrinter(): Promise<{ opened: boolean; error?: string }> {
  const pulse = getDrawerPulse();
  const result = await sendBytesToPrinter(pulse);
  return { opened: result.printed, error: result.error };
}
