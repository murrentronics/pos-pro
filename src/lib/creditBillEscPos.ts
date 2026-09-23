import type { ReceiptData } from "./receiptPrinter";

const COL_WIDTH = 48;

function esc(b: number): string {
  return String.fromCharCode(b);
}

function center(text: string, bold = false): string {
  const on  = bold ? esc(0x1b) + esc(0x45) + esc(0x01) : "";
  const off = bold ? esc(0x1b) + esc(0x45) + esc(0x00) : "";
  // Alignment is already ESC center. Padding here as well shifts the line right.
  return `${on}${text}${off}`;
}

function hr(): string { return "\u2500".repeat(COL_WIDTH); }

function padRight(s: string, w: number): string { return s.padEnd(w).slice(0, w); }

function moneyRow(label: string, value: string): string {
  return `${padRight(label, Math.max(1, COL_WIDTH - value.length))}${value}`;
}

/** Customer credit bill: every charge, cash sale, and payment, then the balance owed. */
export function buildCreditBillEscPos(data: ReceiptData): Uint8Array {
  const bill = data.creditBill!;
  const cmds: string[] = [];

  cmds.push(esc(0x1b) + esc(0x40));
  cmds.push(esc(0x1b) + esc(0x61) + esc(0x01));
  if (data.logoEscPos) cmds.push(data.logoEscPos);
  cmds.push(center(data.storeName || "My Business", true));
  if (data.locationName) cmds.push(center(data.locationName));

  const dateStr =
    data.date ||
    new Date().toLocaleString("en-US", {
      month: "numeric", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
    });
  cmds.push(center(dateStr));
  if (data.serverName && data.serverName !== "Staff") cmds.push(center(`Served by ${data.serverName}`));
  if (data.customerName) cmds.push(center(`Customer: ${data.customerName}`));
  cmds.push(esc(0x1b) + esc(0x61) + esc(0x00));
  cmds.push(hr());

  for (const entry of bill.entries) {
    cmds.push(entry.when);
    const tag = entry.kind === "payment" ? "PAYMENT" : entry.kind === "cash" ? "CASH" : "CHARGE";
    cmds.push(tag);
    if (entry.kind === "payment") {
      const amt = `-$${entry.amount.toFixed(2)}`;
      const label = (entry.note || "Payment received").replace(/\s+/g, " ");
      cmds.push(moneyRow(label, amt));
    } else {
      for (const it of entry.lines) {
        const qtyPrefix = `${it.qty}x `;
        const priceStr = `$${(it.qty * it.price).toFixed(2)}`;
        const maxName = COL_WIDTH - qtyPrefix.length - priceStr.length;
        cmds.push(`${qtyPrefix}${padRight(it.name, Math.max(1, maxName))}${priceStr}`);
      }
    }
    cmds.push("");
  }

  cmds.push(hr());
  cmds.push(moneyRow("Charges", `$${bill.charges.toFixed(2)}`));
  cmds.push(moneyRow("Payments", `-$${bill.payments.toFixed(2)}`));
  if (bill.cashSales > 0) cmds.push(moneyRow("Cash sales", `$${bill.cashSales.toFixed(2)}`));
  cmds.push(esc(0x1b) + esc(0x45) + esc(0x01));
  cmds.push(moneyRow("Balance Owed", `$${bill.balanceOwed.toFixed(2)}`));
  cmds.push(esc(0x1b) + esc(0x45) + esc(0x00));
  cmds.push(hr());
  cmds.push(esc(0x1b) + esc(0x61) + esc(0x01));
  cmds.push(center((data.footerTagline || "").trim() || "Thank you!"));
  cmds.push(esc(0x1b) + esc(0x64) + esc(0x03));
  cmds.push(esc(0x1d) + esc(0x56) + esc(0x42) + esc(0x00));

  const raw = cmds.join("\n");
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}
