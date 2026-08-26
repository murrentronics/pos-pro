/**
 * receiptPrinter.ts — prints a sale receipt to an ESC/POS thermal printer.
 *
 * Strategy (mirrors cashDrawer.ts):
 *  1. Capacitor/native — no native print plugin yet, fall straight to WebSerial.
 *  2. WebSerial — check getPorts() for an already-granted port first so the
 *     OS device-picker is only shown ONCE (on first use). After that the port
 *     is reused silently.
 *  3. Neither available — return an error; the caller shows a fallback UI.
 *
 * Hardware overrides (optional — set via localStorage):
 *   pospro-receipt-vid -> decimal USB vendor id filter
 *   pospro-receipt-pid -> decimal USB product id filter
 *
 * NOTE: All ESC/POS divider lines use ASCII "-" (0x2D) instead of the
 * Unicode box-drawing character "\u2500" which would get truncated to 0x00
 * when cast to a Uint8Array byte.
 */

const COL_WIDTH = 48;

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
  tax?: number;
  total: number;
  paid: number;
  change: number;
  payMode: string;
  customerName?: string;
  date?: string;
}

export interface PrintResult {
  printed: boolean;
  method: "webserial" | "none";
  device?: string;
  error?: string;
}

// ─── ESC/POS builder ──────────────────────────────────────────────────────────

function buildReceiptEscPos(data: ReceiptData): Uint8Array {
  const lines: string[] = [];

  // Reset printer
  lines.push(esc(0x1b) + esc(0x40));
  // Align center
  lines.push(esc(0x1b) + esc(0x61) + esc(0x01));

  // Store name (bold, uppercase)
  lines.push(bold((data.storeName || "My Business").toUpperCase()));

  // Location
  if (data.locationName) lines.push(data.locationName);

  // Date timestamp
  const dateStr =
    data.date ||
    new Date().toLocaleString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  lines.push(dateStr);

  // Server line
  lines.push(`Served by ${data.serverName || "Staff"}`);

  lines.push(hr());

  // ORDER #X — centered, double-size, bold
  lines.push(esc(0x1b) + esc(0x61) + esc(0x01)); // center
  lines.push(esc(0x1d) + esc(0x21) + esc(0x11)); // double width & height
  lines.push(esc(0x1b) + esc(0x45) + esc(0x01)); // bold ON
  lines.push(`ORDER #${data.orderNumber ?? 1}`);
  lines.push(esc(0x1d) + esc(0x21) + esc(0x00)); // reset size
  lines.push(esc(0x1b) + esc(0x45) + esc(0x00)); // bold OFF

  lines.push(hr());

  // Items — left align
  lines.push(esc(0x1b) + esc(0x61) + esc(0x00));
  for (const it of data.items) {
    const qtyPrefix = `${it.qty}x `;
    const priceStr = `$${(it.qty * it.price).toFixed(2)}`;
    const maxNameLen = COL_WIDTH - qtyPrefix.length - priceStr.length;
    const nameStr = (it.name || "").padEnd(Math.max(1, maxNameLen)).slice(0, Math.max(1, maxNameLen));
    lines.push(`${qtyPrefix}${nameStr}${priceStr}`);
  }

  lines.push(hr());

  // Totals
  lines.push(row("Subtotal", `$${data.subtotal.toFixed(2)}`));
  if (data.tax != null && data.tax > 0) {
    lines.push(row("Tax", `$${data.tax.toFixed(2)}`));
  }
  lines.push(bold(row("Total", `$${data.total.toFixed(2)}`)));

  lines.push(hr());

  const payLabel = data.payMode === "credit" ? "Credit" : "Cash Tendered";
  lines.push(row(payLabel, `$${data.paid.toFixed(2)}`));
  lines.push(row("Change", `$${data.change.toFixed(2)}`));

  if (data.customerName) {
    lines.push(hr());
    lines.push(`Customer: ${data.customerName}`);
  }

  lines.push(hr());
  lines.push(center("Thank you for your purchase!"));
  // Feed and cut
  lines.push(esc(0x1b) + esc(0x64) + esc(0x05)); // feed 5 lines
  lines.push(esc(0x1d) + esc(0x56) + esc(0x42) + esc(0x00)); // partial cut

  // Convert to bytes — all chars must be single-byte latin1
  const payload = lines.join("\n");
  const bytes = new Uint8Array(payload.length);
  for (let i = 0; i < payload.length; i++) {
    bytes[i] = payload.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function center(text: string): string {
  return text.padStart(Math.floor((COL_WIDTH + text.length) / 2)).slice(0, COL_WIDTH);
}

function bold(text: string): string {
  return esc(0x1b) + esc(0x45) + esc(0x01) + text + esc(0x1b) + esc(0x45) + esc(0x00);
}

/** ASCII dash divider — safe single-byte char */
function hr(): string {
  return "-".repeat(COL_WIDTH);
}

function row(label: string, value: string): string {
  const gap = COL_WIDTH - label.length - value.length;
  return label + " ".repeat(Math.max(1, gap)) + value;
}

// ─── Web Serial ───────────────────────────────────────────────────────────────

interface SerialPort {
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
  requestPort(options?: { filters?: { usbVendorId: number }[] }): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

function getSerial(): WebSerialAPI | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as unknown as { serial?: WebSerialAPI }).serial ?? null;
}

function readStorage(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Print a receipt to an ESC/POS USB thermal printer via Web Serial.
 *
 * Reuses a previously-granted port (no OS picker shown) when one is available.
 * Only calls requestPort() — which shows the browser's device picker — when
 * no port has been granted yet. This is identical to the cash drawer pattern.
 *
 * Never throws. Returns a PrintResult describing the outcome.
 */
export async function printReceipt(data: ReceiptData): Promise<PrintResult> {
  const serial = getSerial();
  if (!serial) {
    return {
      printed: false,
      method: "none",
      error: "Web Serial API not available — open in Chrome/Edge or install the app",
    };
  }

  const vid = parseInt(readStorage("pospro-receipt-vid") ?? "", 10);
  const pid = parseInt(readStorage("pospro-receipt-pid") ?? "", 10);
  const vidFilter = Number.isFinite(vid) && vid > 0 ? vid : undefined;

  const dateStr =
    data.date ||
    new Date().toLocaleString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

  const payload = buildReceiptEscPos({ ...data, date: dateStr });

  try {
    // ── 1. Try to reuse an already-granted port (no OS picker) ──────────────
    let port: SerialPort | undefined;
    try {
      const granted = await serial.getPorts();
      if (vidFilter != null) {
        port = granted.find((p) => p.getInfo().usbVendorId === vidFilter);
      }
      if (!port) port = granted[0];
    } catch {
      /* ignore — fall through to requestPort */
    }

    // ── 2. If no port yet, prompt user once ─────────────────────────────────
    if (!port) {
      const filters = vidFilter != null ? [{ usbVendorId: vidFilter }] : undefined;
      port = await serial.requestPort(filters ? { filters } : undefined);
    }

    // ── 3. Open, write, close ────────────────────────────────────────────────
    await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none", bufferSize: 4096 });

    let device: string | undefined;
    try {
      const info = port.getInfo();
      if (info.usbVendorId != null && info.usbProductId != null) {
        device = `VID ${info.usbVendorId} PID ${info.usbProductId}`;
      }
    } catch { /* best-effort */ }

    const writer = port.writable.getWriter();
    try {
      await writer.write(payload);
    } finally {
      writer.releaseLock();
    }

    // Hold briefly so the printer fully receives the data
    await new Promise((r) => setTimeout(r, 250));
    await port.close().catch(() => undefined);

    return { printed: true, method: "webserial", device };

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { printed: false, method: "none", error: message };
  }
}
