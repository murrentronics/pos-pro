/**
 * Draws the Summary report body. The page header is drawn separately
 * so this file only places the figures the owner sees on screen.
 */
import type { jsPDF } from "jspdf";
import { CONTENT_BOTTOM, LM, RM } from "@/lib/pdfHelpers";

export type SummaryPdfItem = {
  name: string;
  qty: number;
  revenue: number;
  costTotal: number;
};

export type SummaryPdfOrderLine = {
  qty: number;
  name: string;
  sale: number;
  cost: number;
  profit: number;
};

export type SummaryPdfOrder = {
  when: string;
  total: number;
  discount: number;
  lines: SummaryPdfOrderLine[];
};

export type SummaryPdfExpense = {
  when: string;
  label: string;
  amount: number;
  refund: boolean;
};

export type SummaryPdfReport = {
  sessionCount: number;
  categoryLabel: string;
  sales: number;
  itemsCost: number;
  gross: number;
  expensesTotal: number;
  net: number;
  orderCount: number;
  items: SummaryPdfItem[];
  orders: SummaryPdfOrder[];
  expenses: SummaryPdfExpense[];
};

function pdfText(value: string): string {
  const cleaned = value.replace(/\u00d7/g, "x").replace(/[^\u0000-\u00ff]/g, "").trim();
  return cleaned || "-";
}

function money(n: number): string {
  const v = Math.abs(Number(n) || 0);
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signed(n: number): string {
  const v = Number(n) || 0;
  if (v === 0) return "$0.00";
  return (v > 0 ? "+" : "-") + money(v);
}

export function drawSummaryReport(doc: jsPDF, startY: number, report: SummaryPdfReport): void {
  let y = startY;

  const newPage = () => {
    doc.addPage();
    y = 16;
  };

  const need = (height: number) => {
    if (y + height > CONTENT_BOTTOM) newPage();
  };

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(
    pdfText(`${report.sessionCount} session${report.sessionCount === 1 ? "" : "s"}  ·  ${report.categoryLabel}`),
    LM,
    y,
  );
  y += 6;

  need(26);
  const boxW = RM - LM;
  const boxH = 22;
  doc.setFillColor(245, 240, 230);
  doc.roundedRect(LM, y, boxW, boxH, 2, 2, "F");
  doc.setDrawColor(232, 146, 42);
  doc.setLineWidth(0.4);
  doc.roundedRect(LM, y, boxW, boxH, 2, 2, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 70, 10);
  doc.text("PERIOD SUMMARY", LM + 3, y + 5);

  const stats = [
    { label: "Bar Sales", value: money(report.sales), color: [21, 128, 61] as const },
    { label: "Items Cost", value: money(report.itemsCost), color: [185, 28, 28] as const },
    { label: "Gross Profit", value: signed(report.gross), color: report.gross >= 0 ? [21, 128, 61] as const : [185, 28, 28] as const },
    { label: "Expenses", value: money(report.expensesTotal), color: [161, 98, 7] as const },
    { label: "Net Profit", value: signed(report.net), color: report.net >= 0 ? [21, 128, 61] as const : [185, 28, 28] as const },
  ];
  const colW = boxW / stats.length;
  stats.forEach((col, i) => {
    const cx = LM + i * colW + colW / 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(100, 100, 100);
    doc.text(col.label, cx, y + 12, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...col.color);
    doc.text(col.value, cx, y + 18, { align: "center" });
  });
  doc.setTextColor(0, 0, 0);
  doc.setLineWidth(0.2);
  y += boxH + 8;

  const section = (title: string, right?: string) => {
    need(12);
    doc.setFillColor(232, 146, 42);
    doc.rect(LM, y - 3.5, boxW, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text(pdfText(title), LM + 2, y);
    if (right) doc.text(pdfText(right), RM - 2, y, { align: "right" });
    y += 6;
  };

  section("Items Sold", `${report.orderCount} order${report.orderCount === 1 ? "" : "s"}`);

  if (report.items.length === 0) {
    need(8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text("No sales in this period", LM, y);
    y += 8;
  } else {
    need(8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(80, 80, 80);
    doc.text("Item", LM, y);
    doc.text("Qty", 108, y, { align: "right" });
    doc.text("Sales", 138, y, { align: "right" });
    doc.text("Cost", 166, y, { align: "right" });
    doc.text("Profit", RM, y, { align: "right" });
    y += 2;
    doc.setDrawColor(200, 200, 200);
    doc.line(LM, y, RM, y);
    y += 4;

    for (const it of report.items) {
      const nameLines = doc.splitTextToSize(pdfText(it.name), 70);
      const rowH = Math.max(5.5, nameLines.length * 3.6);
      need(rowH + 1);
      const profit = it.revenue - it.costTotal;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      doc.text(nameLines, LM, y);
      doc.text(String(it.qty), 108, y, { align: "right" });
      doc.setTextColor(21, 128, 61);
      doc.text(money(it.revenue), 138, y, { align: "right" });
      doc.setTextColor(185, 28, 28);
      doc.text(it.costTotal > 0 ? money(it.costTotal) : "-", 166, y, { align: "right" });
      doc.setTextColor(...(profit >= 0 ? [21, 128, 61] as const : [185, 28, 28] as const));
      doc.text(signed(profit), RM, y, { align: "right" });
      y += rowH;
    }
    y += 4;
  }

  if (report.orders.length > 0) {
    section("Orders", String(report.orders.length));
    for (const order of report.orders) {
      need(8);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      doc.text(pdfText(order.when), LM, y);
      doc.setTextColor(21, 128, 61);
      doc.text(money(order.total), RM, y, { align: "right" });
      y += 4.5;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      for (const line of order.lines) {
        const text = pdfText(
          `${line.qty}x ${line.name}    ${money(line.sale)}` +
            (line.cost > 0 ? `    cost ${money(line.cost)}    ${signed(line.profit)}` : ""),
        );
        const wrapped = doc.splitTextToSize(text, boxW);
        need(wrapped.length * 3.6 + 1);
        doc.setTextColor(60, 60, 60);
        doc.text(wrapped, LM, y);
        y += wrapped.length * 3.6;
      }

      if (order.discount > 0) {
        need(5);
        doc.setTextColor(161, 98, 7);
        doc.text(pdfText(`Discount -${money(order.discount)}`), LM, y);
        y += 4;
      }

      y += 1;
      doc.setDrawColor(220, 220, 220);
      doc.line(LM, y, RM, y);
      y += 4;
    }
  }

  if (report.expenses.length > 0) {
    section("Expenses", String(report.expenses.length));
    for (const expense of report.expenses) {
      const labelLines = doc.splitTextToSize(pdfText(expense.label), 140);
      need(labelLines.length * 3.8 + 6);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      doc.text(labelLines, LM, y);
      doc.setTextColor(...(expense.refund ? [21, 128, 61] as const : [185, 28, 28] as const));
      doc.text((expense.refund ? "+" : "") + money(expense.amount), RM, y, { align: "right" });
      y += labelLines.length * 3.8;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text(pdfText(expense.when), LM, y);
      y += 3;
      doc.setDrawColor(220, 220, 220);
      doc.line(LM, y, RM, y);
      y += 4;
    }
  }

  doc.setTextColor(0, 0, 0);
}
