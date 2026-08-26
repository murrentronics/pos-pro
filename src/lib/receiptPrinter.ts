/**
 * receiptPrinter.ts — builds an ESC/POS receipt payload and sends it
 * through the active printer connection (USB or Bluetooth).
 *
 * Connection management lives in printerConnection.ts.
 * This file only handles ESC/POS command building + the public printReceipt() call.
 */

import { sendBytesToPrinter, type PrintResult } from "@/lib/printerConnection";

export type { PrintResult };

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

// ─── ESC/POS builder ──────────────────────────────────────────────────────────

export function buildReceiptEscPos(data: ReceiptData): Uint8Array {
  const lines: string[] = [];

  lines.push(esc(0x1b) + esc(0x40)); // reset
  lines.push(esc(0x1b) + esc(0x61) + esc(0x01)); // center

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
  if (data.tax != null && data.tax > 0) lines.push(row("Tax", `$${data.tax.toFixed(2)}`));
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

export async function printReceipt(data: ReceiptData): Promise<PrintResult> {
  const dateStr = data.date || new Date().toLocaleString("en-US", {
    month: "numeric", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  });
  const payload = buildReceiptEscPos({ ...data, date: dateStr });
  return sendBytesToPrinter(payload);
}
