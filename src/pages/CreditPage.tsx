import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useChain } from "@/lib/ChainContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  UserPlus, X, ChevronDown, CheckCircle2,
  ClipboardList, Trash2, FileDown, Loader2, Pencil, Share2, Printer, Receipt,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { downloadPdf } from "@/lib/download";
import { useNumpadKeyboard } from "@/lib/useNumpadKeyboard";
import { drawHeader, addFootersToAllPages, LM, RM, CONTENT_BOTTOM } from "@/lib/pdfHelpers";
import { printReceipt, pairPrinter, isPrinterPaired, clearPrinterPairing, openPrinterConnectDialog, type CreditBill, type ReceiptData } from "@/lib/receiptPrinter";
import { brandReceipt, loadReceiptSettings } from "@/lib/receiptSettings";
import { ReceiptSettingsTab } from "@/components/ReceiptSettingsTab";
import { ReceiptPaper } from "@/components/ReceiptPaper";
import { useTranslation } from "@/lib/i18n";

// ── Types ──────────────────────────────────────────────────────────────────────
export type CreditAccount = {
  id: string;
  owner_id: string;
  full_name: string;
  contact_number: string | null;
  id_image_url: string | null;
  id_number: string | null;
  balance_owed: number;
  status: "open" | "closed";
  created_at: string;
  tx_count?: number;
};

type CreditTx = {
  id: string;
  credit_account_id: string;
  type: "charge" | "payment";
  amount: number;
  note: string | null;
  items?: any[] | null;
  cashier_id?: string | null;
  created_at: string;
  tab_status?: string | null;
};

type BillTx = {
  id?: string;
  type: string;
  amount: number;
  note: string | null;
  items: { name?: string; qty?: number; price?: number }[] | null;
  created_at: string;
};

function isCashCharge(note: string | null | undefined) {
  return (note ?? "").startsWith("[CASH]");
}

function formatTxWhen(iso: string) {
  const dt = new Date(iso);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "America/Port_of_Spain" })
    + " " + dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Port_of_Spain" });
}

/** Charges that were rung as credit, payments that reduced the tab, and cash sales kept separate so they do not change the balance. */
function summarizeBill(txs: BillTx[], balanceOwed: number): CreditBill {
  let charges = 0;
  let payments = 0;
  let cashSales = 0;
  const entries = txs.map((t) => {
    const isPayment = t.type === "payment";
    const isCash = !isPayment && isCashCharge(t.note);
    const amount = Number(t.amount);
    if (isPayment) payments += amount;
    else if (isCash) cashSales += amount;
    else charges += amount;
    const itemLines = t.items && Array.isArray(t.items) && t.items.length > 0
      ? t.items.map((it) => ({ name: it.name ?? "Item", qty: Number(it.qty ?? 1), price: Number(it.price) || 0 }))
      : [{ name: (t.note || "Charge").replace(/^\[CASH\]\s*/, "") || "Charge", qty: 1, price: amount }];
    return {
      when: formatTxWhen(t.created_at),
      kind: (isPayment ? "payment" : isCash ? "cash" : "charge") as CreditBill["entries"][number]["kind"],
      lines: isPayment ? [] : itemLines,
      amount,
      note: t.note,
    };
  });
  return { entries, charges, payments, cashSales, balanceOwed };
}

// ── Build bill PDF — returns base64 data URI ──────────────────────────────────
async function buildBillPdf(account: CreditAccount, ownerName: string): Promise<string | null> {
  const { data: txs, error } = await supabase
    .from("credit_transactions")
    .select("id, type, amount, note, items, created_at")
    .eq("credit_account_id", account.id)
    .order("created_at", { ascending: true });
  if (error) { toast.error("Failed to load transactions"); return null; }

  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const generated = new Date().toLocaleString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: true,
    day: "2-digit", month: "2-digit", year: "numeric",
  });

  let y = await drawHeader(doc, ownerName, "Credit Bill", "Full History", generated);

  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0,0,0);
  doc.text("Customer: " + account.full_name, LM, y); y += 5;
  if (account.contact_number) { doc.setFont("helvetica","normal"); doc.text("Contact: " + account.contact_number, LM, y); y += 5; }
  if (account.id_number)      { doc.setFont("helvetica","normal"); doc.text("ID: " + account.id_number, LM, y); y += 5; }

  const cashPurchases = (txs ?? []).filter(t => t.type === "charge").reduce((s,t) => s + Number(t.amount), 0);
  const creditBalance = Number(account.balance_owed);
  const ORANGE = [232, 146, 42] as const;

  doc.setFillColor(245,240,230);
  doc.roundedRect(LM, y, RM-LM, 22, 2, 2, "F");
  doc.setDrawColor(...ORANGE); doc.setLineWidth(0.4);
  doc.roundedRect(LM, y, RM-LM, 22, 2, 2, "S");
  const cols = [
    { label: "Cash Purchases", value: "$"+cashPurchases.toFixed(2), red: false },
    { label: "Credit Balance", value: "$"+creditBalance.toFixed(2), red: creditBalance > 0 },
  ];
  const colW = (RM-LM)/2;
  cols.forEach((col, i) => {
    const cx = LM + i*colW + colW/2;
    doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(100,100,100);
    doc.text(col.label, cx, y+7, { align:"center" });
    doc.setFont("helvetica","bold"); doc.setFontSize(9);
    doc.setTextColor(col.red ? 200 : 30, col.red ? 40 : 30, 40);
    doc.text(col.value, cx, y+17, { align:"center" });
  });
  doc.setTextColor(0,0,0); y += 27;

  doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(130,130,130);
  doc.text("DATE / DETAILS", LM, y); doc.text("AMOUNT", RM, y, { align:"right" });
  y += 3; doc.setDrawColor(200,200,200); doc.setLineWidth(0.2); doc.line(LM, y, RM, y); y += 5;

  doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(0,0,0);

  // Column x positions for item table
  for (const tx of txs ?? []) {
    if (y > CONTENT_BOTTOM) { doc.addPage(); y = 20; }
    const isCharge = tx.type === "charge";
    const isCash = isCharge && isCashCharge(tx.note);
    const dateStr = new Date(tx.created_at).toLocaleString("en-GB", { hour:"2-digit", minute:"2-digit", hour12:true, day:"2-digit", month:"short", year:"numeric" });
    const kindLabel = isCash ? "CASH" : isCharge ? "CHARGE" : "PAYMENT";
    const kindRgb: [number, number, number] = isCash ? [70, 70, 70] : isCharge ? [200, 60, 40] : [20, 120, 60];

    // Row header: CHARGE/PAYMENT/CASH label + date + total amount
    doc.setFont("helvetica","bold");
    doc.setTextColor(...kindRgb);
    doc.text(kindLabel, LM, y);
    doc.setTextColor(0,0,0); doc.setFont("helvetica","normal");
    doc.text(dateStr, LM+22, y);
    doc.setFont("helvetica","bold");
    doc.setTextColor(...kindRgb);
    doc.text((isCharge?"+":"-")+"$"+Number(tx.amount).toFixed(2), RM, y, { align:"right" });
    doc.setTextColor(0,0,0);
    y += 5;

    // Per-item breakdown for charges
    if (isCharge && tx.items && Array.isArray(tx.items) && (tx.items as any[]).length > 0) {
      if (y > CONTENT_BOTTOM - 8) { doc.addPage(); y = 20; }

      // Column x positions (LM=15, RM=195, width=180)
      const C_ITEM  = LM + 4;
      const C_QTY   = LM + 100;
      const C_PRICE = LM + 140;
      const C_TOTAL = RM;

      // Sub-header row
      doc.setFont("helvetica","bold"); doc.setFontSize(6.5); doc.setTextColor(150,150,150);
      doc.text("ITEM",  C_ITEM,  y);
      doc.text("QTY",   C_QTY,   y, { align:"right" });
      doc.text("PRICE", C_PRICE, y, { align:"right" });
      doc.text("TOTAL", C_TOTAL, y, { align:"right" });
      y += 3.5;
      doc.setDrawColor(210,210,210); doc.setLineWidth(0.15);
      doc.line(C_ITEM, y, RM, y); y += 3;

      let chargeTotalSP = 0;

      for (const it of tx.items as any[]) {
        if (y > CONTENT_BOTTOM - 6) { doc.addPage(); y = 20; }
        const qty  = Number(it.qty ?? 1);
        const sp   = Number(it.price ?? 0);
        const rowTotal = sp * qty;
        chargeTotalSP += rowTotal;

        doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(30,30,30);
        const nameStr = doc.splitTextToSize(it.name ?? "", 90)[0];
        doc.text(nameStr, C_ITEM, y);
        doc.text(String(qty), C_QTY, y, { align:"right" });

        doc.setTextColor(...ORANGE);
        doc.text("$"+sp.toFixed(2), C_PRICE, y, { align:"right" });
        doc.setFont("helvetica","bold");
        doc.text("$"+rowTotal.toFixed(2), C_TOTAL, y, { align:"right" });
        doc.setTextColor(0,0,0);
        y += 4.5;
      }

      // Subtotal row
      if (y > CONTENT_BOTTOM - 6) { doc.addPage(); y = 20; }
      doc.setDrawColor(210,210,210); doc.setLineWidth(0.15); doc.line(C_ITEM, y, RM, y); y += 3;
      doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(80,80,80);
      doc.text("Subtotal", C_ITEM, y);
      doc.setTextColor(...ORANGE);
      doc.text("$"+chargeTotalSP.toFixed(2), C_TOTAL, y, { align:"right" });
      doc.setTextColor(0,0,0); doc.setFontSize(8.5);
      y += 5;
    }

    // Note — only show if no items table (avoids duplicate text)
    if (tx.note && !(isCharge && Array.isArray(tx.items) && (tx.items as any[]).length > 0)) {
      doc.setFont("helvetica","italic"); doc.setFontSize(7.5); doc.setTextColor(120,120,120);
      const wrapped = doc.splitTextToSize("  "+tx.note, RM-LM-4);
      doc.text(wrapped, LM, y); y += wrapped.length*4+1;
      doc.setFontSize(8.5); doc.setTextColor(0,0,0);
    }

    doc.setDrawColor(220,220,220); doc.setLineWidth(0.1); doc.line(LM, y, RM, y); y += 4;
  }

  if (y > CONTENT_BOTTOM-10) { doc.addPage(); y = 20; }
  y += 4;
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...ORANGE);
  doc.text("Balance Remaining:", LM, y);
  doc.setTextColor(creditBalance<=0?40:200, creditBalance<=0?140:40, 40);
  doc.text("$"+creditBalance.toFixed(2), RM, y, { align:"right" });

  addFootersToAllPages(doc);
  return doc.output("datauristring");
}

// ── Build single-record PDF — returns base64 data URI ────────────────────────
async function buildSingleRecordPdf(
  tx: CreditTx,
  account: CreditAccount,
  ownerName: string
): Promise<string | null> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const ORANGE = [232, 146, 42] as const;
  const isCharge = tx.type === "charge";

  const dt = new Date(tx.created_at);
  const dateStr = dt.toLocaleString("en-GB", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
  const timeStr = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const generated = new Date().toLocaleString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: true,
    day: "2-digit", month: "2-digit", year: "numeric",
  });

  const docTitle = isCharge ? "Charge Receipt" : "Payment Receipt";
  let y = await drawHeader(doc, ownerName, docTitle, dateStr + " · " + timeStr, generated);

  // Customer info
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
  doc.text("Customer: " + account.full_name, LM, y); y += 5;
  if (account.contact_number) {
    doc.setFont("helvetica", "normal");
    doc.text("Contact: " + account.contact_number, LM, y); y += 5;
  }
  if (account.id_number) {
    doc.setFont("helvetica", "normal");
    doc.text("ID: " + account.id_number, LM, y); y += 5;
  }
  y += 3;

  // Date / time row
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...ORANGE);
  doc.text("Date", LM, y);
  doc.setFont("helvetica", "normal"); doc.setTextColor(0, 0, 0);
  doc.text(dateStr, LM + 28, y); y += 5;
  doc.setFont("helvetica", "bold"); doc.setTextColor(...ORANGE);
  doc.text("Time", LM, y);
  doc.setFont("helvetica", "normal"); doc.setTextColor(0, 0, 0);
  doc.text(timeStr, LM + 28, y); y += 8;

  // Type label
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.setTextColor(isCharge ? 200 : 40, isCharge ? 60 : 140, 40);
  doc.text(isCharge ? "CHARGE" : "PAYMENT", LM, y); y += 8;
  doc.setTextColor(0, 0, 0);

  // Itemized table (charges only)
  const C_ITEM = LM + 4;
  const C_QTY  = LM + 110;
  const C_SP   = RM;

  if (isCharge && tx.items && Array.isArray(tx.items) && tx.items.length > 0) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.5); doc.setTextColor(150, 150, 150);
    doc.text("ITEM", C_ITEM, y);
    doc.text("QTY",  C_QTY,  y, { align: "right" });
    doc.text("SALE", C_SP,   y, { align: "right" });
    y += 3.5;
    doc.setDrawColor(210, 210, 210); doc.setLineWidth(0.15);
    doc.line(C_ITEM, y, RM, y); y += 3;

    let totalSP = 0;

    for (const it of tx.items as any[]) {
      if (y > CONTENT_BOTTOM - 6) { doc.addPage(); y = 20; }
      const qty = Number(it.qty ?? 1);
      const sp  = Number(it.price ?? 0) * qty;
      totalSP += sp;

      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(30, 30, 30);
      doc.text(doc.splitTextToSize(it.name ?? "", 95)[0], C_ITEM, y);
      doc.text(String(qty), C_QTY, y, { align: "right" });

      doc.setFont("helvetica", "bold"); doc.setTextColor(...ORANGE);
      doc.text("$" + sp.toFixed(2), C_SP, y, { align: "right" });
      doc.setTextColor(0, 0, 0);
      y += 4.5;
    }

    // Subtotal
    if (y > CONTENT_BOTTOM - 6) { doc.addPage(); y = 20; }
    doc.setDrawColor(210, 210, 210); doc.setLineWidth(0.15); doc.line(C_ITEM, y, RM, y); y += 3;
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(80, 80, 80);
    doc.text("Subtotal", C_ITEM, y);
    doc.setTextColor(...ORANGE);
    doc.text("$" + totalSP.toFixed(2), C_SP, y, { align: "right" });
    doc.setTextColor(0, 0, 0);
    y += 8;
  } else if (tx.note) {
    // No items — show note
    doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
    const wrapped = doc.splitTextToSize(tx.note, RM - LM - 4);
    doc.text(wrapped, LM, y); y += wrapped.length * 4.5 + 5;
    doc.setTextColor(0, 0, 0);
  }

  // Total amount for this record
  doc.setDrawColor(...ORANGE); doc.setLineWidth(0.4);
  doc.line(LM, y, RM, y); y += 5;
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.setTextColor(isCharge ? 200 : 40, isCharge ? 60 : 140, 40);
  doc.text(isCharge ? "Amount Charged:" : "Amount Paid:", LM, y);
  doc.text((isCharge ? "+" : "-") + "$" + Number(tx.amount).toFixed(2), RM, y, { align: "right" });
  doc.setTextColor(0, 0, 0);
  y += 10;

  // Outstanding balance box
  const balance = Number(account.balance_owed);
  doc.setFillColor(245, 240, 230);
  doc.roundedRect(LM, y, RM - LM, 18, 2, 2, "F");
  doc.setDrawColor(...ORANGE); doc.setLineWidth(0.4);
  doc.roundedRect(LM, y, RM - LM, 18, 2, 2, "S");
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(100, 100, 100);
  doc.text("Outstanding Balance", LM + (RM - LM) / 2, y + 6, { align: "center" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.setTextColor(balance <= 0 ? 40 : 200, balance <= 0 ? 140 : 40, 40);
  doc.text(
    balance <= 0 ? "CLEARED — $0.00" : "$" + balance.toFixed(2) + " OUTSTANDING",
    LM + (RM - LM) / 2, y + 14, { align: "center" }
  );
  doc.setTextColor(0, 0, 0);

  addFootersToAllPages(doc);
  return doc.output("datauristring");
}

// ── Full Bill Receipt Preview ─────────────────────────────────────────────────
// Loads all transactions for an account and renders a scrollable receipt paper
function FullBillPreview({ account, ownerName }: { account: CreditAccount; ownerName: string }) {
  const [bill, setBill] = useState<CreditBill | null>(null);
  const [loading, setLoading] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [barName, setBarName] = useState(ownerName);
  const [tagline, setTagline] = useState("");

  useEffect(() => {
    supabase
      .from("credit_transactions")
      .select("id, type, amount, note, items, created_at")
      .eq("credit_account_id", account.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        setBill(summarizeBill((data ?? []) as BillTx[], Number(account.balance_owed ?? 0)));
        setLoading(false);
      });
    loadReceiptSettings(account.owner_id).then((saved) => {
      if (!saved) return;
      if (saved.barName) setBarName(saved.barName);
      if (saved.tagline) setTagline(saved.tagline);
      setLogoUrl(saved.logoData);
    });
  }, [account.id, account.balance_owed, account.owner_id]);

  return (
    <div className="px-5 py-2 flex-1 min-h-0 overflow-y-auto">
      <div className="bg-white text-zinc-900 rounded-xl p-4 shadow-inner text-left font-mono text-xs leading-tight border border-zinc-300 select-none">
        {/* Header */}
        {logoUrl && <img src={logoUrl} alt="" className="mx-auto mb-1 max-h-14 object-contain" />}
        <div className="text-center font-black text-zinc-950 text-sm font-sans tracking-tight uppercase mb-0.5">
          {barName}
        </div>
        <div className="text-center text-[10px] text-zinc-600 font-sans">
          {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </div>
        <div className="text-center text-[10px] text-zinc-600 font-sans">Customer: {account.full_name}</div>
        {account.contact_number && (
          <div className="text-center text-[10px] text-zinc-500 font-sans">{account.contact_number}</div>
        )}

        <div className="border-t border-dashed border-zinc-400 my-2" />

        {loading || !bill ? (
          <div className="text-center text-[10px] text-zinc-500 py-2">Loading…</div>
        ) : (
          <>
            {bill.entries.length === 0 ? (
              <div className="text-center text-[10px] text-zinc-500 py-2">No transactions</div>
            ) : bill.entries.map((entry, idx) => (
              <div key={idx} className="mb-2">
                <div className="flex justify-between items-baseline text-[9px] mb-0.5">
                  <span className="text-zinc-500">{entry.when}</span>
                  <span className={`font-black tracking-wide ${
                    entry.kind === "payment" ? "text-emerald-700" : entry.kind === "cash" ? "text-zinc-500" : "text-zinc-700"
                  }`}>
                    {entry.kind === "payment" ? "PAYMENT" : entry.kind === "cash" ? "CASH" : "CHARGE"}
                  </span>
                </div>
                {entry.kind === "payment" ? (
                  <div className="flex justify-between items-start">
                    <span className="font-semibold text-emerald-800 pr-2 break-all">{entry.note || "Payment received"}</span>
                    <span className="font-bold text-emerald-800 whitespace-nowrap">-${entry.amount.toFixed(2)}</span>
                  </div>
                ) : entry.lines.map((it, i) => (
                  <div key={i} className="flex justify-between items-start">
                    <span className={`font-semibold pr-2 break-all ${entry.kind === "cash" ? "text-zinc-600" : "text-zinc-900"}`}>{it.qty}× {it.name}</span>
                    <span className={`font-bold whitespace-nowrap ${entry.kind === "cash" ? "text-zinc-600" : "text-zinc-950"}`}>${(it.qty * Number(it.price)).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            ))}

            {/* Balance owed stays the database figure. Charges and payments are shown so a $0 balance is explained by the payment. */}
            <div className="border-t border-dashed border-zinc-400 my-2" />
            <div className="flex justify-between text-zinc-700">
              <span>Charges</span>
              <span>${bill.charges.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-emerald-800">
              <span>Payments</span>
              <span>-${bill.payments.toFixed(2)}</span>
            </div>
            {bill.cashSales > 0 && (
              <div className="flex justify-between text-zinc-500">
                <span>Cash sales</span>
                <span>${bill.cashSales.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-black text-zinc-950 mt-1">
              <span>Balance Owed</span>
              <span>${bill.balanceOwed.toFixed(2)}</span>
            </div>
            {tagline && (
              <div className="text-center text-[10px] text-zinc-500 mt-2">{tagline}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Bill Action Modal ─────────────────────────────────────────────────────────
function BillModal({ account, ownerName, onClose }: {
  account: CreditAccount;
  ownerName: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"share" | "print" | null>(null);
  const [printerPaired, setPrinterPaired] = useState<boolean | null>(null);
  const [pairing, setPairing] = useState(false);
  const safeName = account.full_name.replace(/\s+/g, "-").toLowerCase();
  const filename = `credit-bill-${safeName}.pdf`;

  useEffect(() => {
    const refresh = () => { isPrinterPaired().then(setPrinterPaired); };
    refresh();
    window.addEventListener("pospro-printer-changed", refresh);
    return () => window.removeEventListener("pospro-printer-changed", refresh);
  }, []);

  const buildReceiptData = async (): Promise<ReceiptData | null> => {
    const { data: txs } = await supabase
      .from("credit_transactions")
      .select("id, type, amount, items, note, created_at")
      .eq("credit_account_id", account.id)
      .order("created_at", { ascending: true });
    if (!txs) return null;

    const creditBill = summarizeBill(txs as BillTx[], Number(account.balance_owed));

    return {
      storeName: ownerName,
      customerName: account.full_name,
      items: [],
      subtotal: creditBill.charges,
      total: creditBill.balanceOwed,
      paid: creditBill.payments,
      change: 0,
      payMode: "credit",
      creditBill,
      date: new Date().toLocaleString("en-US", {
        month: "numeric", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
      }),
    };
  };

  const handlePrint = async () => {
    setBusy("print");
    try {
      if (printerPaired === false) {
        setPairing(true);
        const paired = await pairPrinter();
        setPairing(false);
        if (!paired) { setBusy(null); return; }
        setPrinterPaired(true);
      }
      const data = await buildReceiptData();
      if (!data) { setBusy(null); return; }
      const result = await printReceipt(data);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Receipt sent to printer");
      }
    } catch (e: any) {
      toast.error("Print failed: " + (e?.message ?? "unknown"));
    }
    setBusy(null);
  };

  const handleShare = async () => {
    setBusy("share");
    try {
      if (Capacitor.isNativePlatform()) {
        const b64 = await buildBillPdf(account, ownerName);
        if (!b64) { setBusy(null); return; }
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const { Share } = await import("@capacitor/share");
        const base64Data = b64.replace(/^data:[^;]+;base64,/, "");
        const writeResult = await Filesystem.writeFile({
          path: filename,
          data: base64Data,
          directory: Directory.Cache,
        });
        const shareText = `Hi ${account.full_name}, please find your credit bill attached.`;
        await Share.share({
          title: `Credit Bill — ${account.full_name}`,
          text: shareText,
          url: writeResult.uri,
          dialogTitle: "Send Bill",
        });
      } else {
        const text = `Credit Bill — ${account.full_name}\nBalance Owed: $${Number(account.balance_owed).toFixed(2)}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
        toast.success("Opening WhatsApp share");
      }
    } catch (e: any) {
      if (!String(e?.message ?? "").includes("cancel")) {
        toast.error("Share failed: " + (e?.message ?? "unknown"));
      }
    }
    setBusy(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-3xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]"
        style={{ background: "var(--gradient-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-2 shrink-0">
          <h3 className="font-black text-base">Bill — {account.full_name}</h3>
          <button onClick={onClose} className="h-8 w-8 rounded-full flex items-center justify-center bg-muted transition">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Receipt paper preview */}
        <FullBillPreview account={account} ownerName={ownerName} />

        <div className="px-5 pb-5 pt-3 flex flex-col gap-2 shrink-0">
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              disabled={busy === "print" || pairing}
              className="flex-1 h-12 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition active:scale-95 disabled:opacity-50 text-primary-foreground shadow-lg"
              style={{ background: "var(--gradient-hero)" }}
            >
              {busy === "print" || pairing
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : printerPaired === false ? "🔌 Connect Printer" : "Print"}
            </button>
            <button
              onClick={handleShare}
              disabled={busy === "share"}
              className="flex-1 h-12 rounded-2xl font-black text-sm border border-border hover:bg-muted/30 transition active:scale-95 text-foreground/80"
            >
              {busy === "share" ? <Loader2 className="h-4 w-4 animate-spin" /> : "PDF / WhatsApp"}
            </button>
          </div>
          {printerPaired && (
            <button
              onClick={async () => {
                setPrinterPaired(false);
                clearPrinterPairing();
                const ok = await openPrinterConnectDialog();
                setPrinterPaired(ok);
              }}
              className="text-[11px] text-muted-foreground underline text-center active:opacity-70"
            >
              Change printer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Single-record Receipt Modal ───────────────────────────────────────────────
// Shows the bill receipt UI (Connect Printer + PDF/WhatsApp) for one credit tx
function SingleReceiptModal({ tx, account, ownerName, onClose }: {
  tx: CreditTx;
  account: CreditAccount;
  ownerName: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"print" | "share" | null>(null);
  const [printerPaired, setPrinterPaired] = useState<boolean | null>(null);
  const [pairing, setPairing] = useState(false);
  const isCharge = tx.type === "charge";
  const dt = new Date(tx.created_at);
  const dateStr = dt.toLocaleString("en-US", {
    month: "numeric", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  });
  const items: { name: string; qty: number; price: number }[] =
    isCharge && tx.items && Array.isArray(tx.items) && tx.items.length > 0
      ? tx.items.map((i: any) => ({ name: i.name ?? "Item", qty: i.qty ?? 1, price: Number(i.price) || 0 }))
      : [{ name: tx.note || (isCharge ? "Charge" : "Payment"), qty: 1, price: Number(tx.amount) }];
  const lineDiscount = (tx.items ?? []).reduce((sum: number, it: any) => {
    const qty = Number(it?.qty ?? 1);
    const per = Number(it?.discount ?? 0);
    if (per > 0) return sum + per * qty;
    const orig = Number(it?.original_price ?? 0);
    const price = Number(it?.price ?? 0);
    if (orig > price) return sum + (orig - price) * qty;
    return sum;
  }, 0);
  const charged = Number(tx.amount);
  const [shown, setShown] = useState<ReceiptData | null>(null);

  useEffect(() => {
    const refresh = () => { isPrinterPaired().then(setPrinterPaired); };
    refresh();
    window.addEventListener("pospro-printer-changed", refresh);
    return () => window.removeEventListener("pospro-printer-changed", refresh);
  }, []);

  const receiptData = (): ReceiptData => ({
    storeName: ownerName,
    customerName: account.full_name,
    orderNumber: isCharge ? "CHARGE" : "PAYMENT",
    date: dateStr,
    items,
    subtotal: lineDiscount > 0 ? charged + lineDiscount : charged,
    discount: lineDiscount > 0 ? lineDiscount : undefined,
    originalTotal: lineDiscount > 0 ? charged + lineDiscount : undefined,
    total: charged,
    paid: isCharge ? 0 : charged,
    change: 0,
    payMode: "credit",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let serverName = "";
      if (tx.cashier_id) {
        const { data } = await supabase.from("profiles").select("username, first_name").eq("id", tx.cashier_id).maybeSingle();
        serverName = (data?.first_name ?? "").trim() || data?.username || "";
      }
      const branded = await brandReceipt({ ...receiptData(), serverName: serverName || undefined });
      if (!cancelled) setShown(branded);
    })();
    return () => { cancelled = true; };
  }, [tx, account.full_name]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrint = async () => {
    setBusy("print");
    try {
      if (printerPaired === false) {
        setPairing(true);
        const paired = await pairPrinter();
        setPairing(false);
        if (!paired) { setBusy(null); return; }
        setPrinterPaired(true);
      }
      const result = await printReceipt(shown ?? receiptData());
      if (result.error) toast.error(result.error);
      else toast.success("Receipt sent to printer");
    } catch (e: any) {
      toast.error("Print failed: " + (e?.message ?? "unknown"));
    }
    setBusy(null);
  };

  const handleShare = async () => {
    setBusy("share");
    try {
      const b64 = await buildSingleRecordPdf(tx, account, ownerName);
      if (!b64) { setBusy(null); return; }
      const safeName = account.full_name.replace(/\s+/g, "-").toLowerCase();
      const dateTag = dt.toISOString().slice(0, 10);
      const filename = `receipt-${safeName}-${dateTag}.pdf`;
      if (Capacitor.isNativePlatform()) {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const { Share } = await import("@capacitor/share");
        const base64Data = b64.replace(/^data:[^;]+;base64,/, "");
        const writeResult = await Filesystem.writeFile({ path: filename, data: base64Data, directory: Directory.Cache });
        await Share.share({ title: `Receipt — ${account.full_name}`, url: writeResult.uri, dialogTitle: "Send Receipt" });
      } else {
        await downloadPdf(filename, b64);
        toast.success("Receipt downloaded");
      }
    } catch (e: any) {
      if (!String(e?.message ?? "").includes("cancel")) toast.error("Share failed: " + (e?.message ?? "unknown"));
    }
    setBusy(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-sm rounded-3xl overflow-hidden border border-border shadow-2xl"
        style={{ background: "var(--gradient-card)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-2 flex items-center justify-between">
          <h2 className="font-black text-lg">{isCharge ? "Charge Receipt" : "Payment Receipt"}</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-full flex items-center justify-center bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-2">
          {shown ? <ReceiptPaper sale={shown} /> : (
            <div className="bg-white rounded-xl p-6 text-center text-xs text-zinc-500">Loading receipt…</div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 pt-2 flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              disabled={busy === "print" || pairing}
              className="flex-1 h-12 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition active:scale-95 disabled:opacity-50 text-primary-foreground shadow-lg"
              style={{ background: "var(--gradient-hero)" }}
            >
              {busy === "print" || pairing
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : printerPaired === false ? "🔌 Connect Printer" : "Print"}
            </button>
            <button
              onClick={handleShare}
              disabled={busy === "share"}
              className="flex-1 h-12 rounded-2xl font-black text-sm border border-border hover:bg-muted/30 transition active:scale-95 text-foreground/80"
            >
              {busy === "share" ? <Loader2 className="h-4 w-4 animate-spin" /> : "PDF / WhatsApp"}
            </button>
          </div>
          {printerPaired && (
            <button
              onClick={async () => {
                setPrinterPaired(false);
                clearPrinterPairing();
                const ok = await openPrinterConnectDialog();
                setPrinterPaired(ok);
              }}
              className="text-[11px] text-muted-foreground underline text-center active:opacity-70"
            >
              Change printer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CreditPage() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const { effectiveOwnerId, activeBar } = useChain();
  const ownerId = effectiveOwnerId(profile?.role === "owner" ? (profile?.id ?? "") : (profile?.parent_id ?? ""));
  const ownerIdRef = useRef(ownerId);
  useEffect(() => { ownerIdRef.current = ownerId; }, [ownerId]);

  const [tab, setTab]       = useState<"opened" | "closed" | "create" | "receipt">("opened");
  const canEditReceipt = profile?.role === "owner";
  const [opened, setOpened] = useState<CreditAccount[]>([]);
  const [closed, setClosed] = useState<CreditAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [editAccount, setEditAccount] = useState<CreditAccount | null>(null);

  const fetchAccounts = useCallback(async () => {
    const id = ownerIdRef.current;
    if (!id) return;
    setLoading(true);
    const { data } = await supabase
      .from("credit_accounts")
      .select("*, credit_transactions(count)")
      .eq("owner_id", id)
      .order("updated_at", { ascending: false });
    const all = ((data ?? []) as any[]).map((a) => ({
      ...a,
      tx_count: a.credit_transactions?.[0]?.count ?? 0,
    })) as CreditAccount[];
    setOpened(all.filter((a) => a.status === "open").sort((a, b) => a.full_name.localeCompare(b.full_name)));
    setClosed(all.filter((a) => a.status === "closed").sort((a, b) => a.full_name.localeCompare(b.full_name)));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ownerId) return;
    fetchAccounts();
  }, [ownerId, fetchAccounts]);

  const handleCreated = (account: CreditAccount) => {
    setClosed((prev) => [account, ...prev]);
    setTab("closed");
  };

  return (
    <div className="py-3 space-y-4">
      <h1 className="text-2xl font-black">{t("customers_title", "Customers")}</h1>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-2xl p-1" style={{ background: "var(--gradient-card)" }}>
        {(["opened", "closed", "create", "receipt"] as const).filter((tabKey) => tabKey !== "receipt" || canEditReceipt).map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            title={tabKey === "receipt" ? t("receipt_settings", "Receipt settings") : undefined}
            className={`flex-1 py-2.5 rounded-xl text-sm font-black capitalize transition flex items-center justify-center gap-1.5 ${
              tab === tabKey ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            style={tab === tabKey ? { background: "var(--gradient-hero)" } : {}}
          >
            {tabKey === "receipt" ? <><Receipt className="h-4 w-4" /> {t("receipt_tab", "Receipt")}</> : tabKey === "opened" ? t("opened_tab", "Opened") : tabKey === "closed" ? t("closed_tab", "Closed") : t("create_tab", "Create")}
            {tabKey === "opened" && opened.length > 0 && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-[11px] font-black leading-none"
                style={tab === "opened"
                  ? { background: "#7c2d12", color: "#ffffff" }
                  : { background: "#c2410c", color: "#7c2d12" }
                }>
                {opened.length}
              </span>
            )}
            {tabKey === "closed" && closed.length > 0 && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-[11px] font-black leading-none"
                style={tab === "closed"
                  ? { background: "#7c2d12", color: "#ffffff" }
                  : { background: "#c2410c", color: "#7c2d12" }
                }>
                {closed.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "opened" && (
        <OpenedTab
          accounts={opened}
          loading={loading}
          onRefresh={fetchAccounts}
          onEdit={setEditAccount}
        />
      )}
      {tab === "closed" && <ClosedTab accounts={closed} loading={loading} onRefresh={fetchAccounts} onEdit={setEditAccount} />}
      {tab === "create" && <CreateTab ownerId={ownerId!} onCreated={handleCreated} />}
      {tab === "receipt" && canEditReceipt && ownerId && (
        <ReceiptSettingsTab
          ownerId={ownerId}
          defaultBarName={activeBar?.bar_name || profile?.username || "Bar"}
        />
      )}

      {/* Edit customer modal */}
      {editAccount && (
        <EditCustomerModal
          account={editAccount}
          onClose={() => setEditAccount(null)}
          onSaved={(updated) => {
            setEditAccount(null);
            setOpened((prev) => prev.map((a) => a.id === updated.id ? updated : a).sort((a, b) => a.full_name.localeCompare(b.full_name)));
            setClosed((prev) => prev.map((a) => a.id === updated.id ? updated : a).sort((a, b) => a.full_name.localeCompare(b.full_name)));
          }}
        />
      )}
    </div>
  );
}

// ── Opened Tab ─────────────────────────────────────────────────────────────────
function OpenedTab({ accounts, loading, onRefresh, onEdit }: {
  accounts: CreditAccount[];
  loading: boolean;
  onRefresh: () => void;
  onEdit: (a: CreditAccount) => void;
}) {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const { effectiveOwnerId } = useChain();
  const ownerId = effectiveOwnerId(profile?.role === "owner" ? (profile?.id ?? "") : (profile?.parent_id ?? ""));
  const ownerName = profile?.username ?? "Bar";
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [txs, setTxs]               = useState<CreditTx[]>([]);
  const [txLoading, setTxLoading]   = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteTx, setConfirmDeleteTx] = useState<CreditTx | null>(null);
  const [billAccount, setBillAccount] = useState<CreditAccount | null>(null);
  const [receiptTx, setReceiptTx] = useState<{ tx: CreditTx; account: CreditAccount } | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [billingId, setBillingId] = useState<string | null>(null);

  // Open tab sessions — map of credit_account_id → tab_id
  const [openTabs, setOpenTabs] = useState<Record<string, string>>({});
  const [endingTabId, setEndingTabId] = useState<string | null>(null);

  // Load open tabs for all accounts whenever the accounts list changes
  useEffect(() => {
    if (!ownerId || accounts.length === 0) return;
    supabase
      .from("credit_transactions")
      .select("id, credit_account_id")
      .eq("owner_id", ownerId)
      .eq("tab_status", "open")
      .then(({ data }) => {
        const map: Record<string, string> = {};
        for (const row of (data ?? []) as { id: string; credit_account_id: string }[]) {
          map[row.credit_account_id] = row.id;
        }
        setOpenTabs(map);
      });
  }, [ownerId, accounts]);

  const endTab = async (account: CreditAccount) => {
    const tabTxId = openTabs[account.id];
    if (!tabTxId) return;
    setEndingTabId(account.id);

    // Check if any orders were added — fetch the tab row amount first
    const { data: tabRow } = await supabase
      .from("credit_transactions")
      .select("amount")
      .eq("id", tabTxId)
      .single();

    const { error } = await supabase.rpc("close_credit_tab", { p_tab_tx_id: tabTxId });
    setEndingTabId(null);
    if (error) { toast.error("Failed to close tab: " + error.message); return; }

    if (!tabRow || Number(tabRow.amount) === 0) {
      toast.success("Tab cancelled — no charges recorded");
    } else {
      toast.success(`Tab closed for ${account.full_name}`);
    }
    setOpenTabs((prev) => { const next = { ...prev }; delete next[account.id]; return next; });
    onRefresh();
  };
  const handleBillShare = async (account: CreditAccount) => {
    setBillingId(account.id);
    try {
      const safeName = account.full_name.replace(/\s+/g, "-").toLowerCase();
      const filename = `credit-bill-${safeName}.pdf`;
      if (Capacitor.isNativePlatform()) {
        const b64 = await buildBillPdf(account, ownerName);
        if (!b64) { setBillingId(null); return; }
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const { Share } = await import("@capacitor/share");
        const base64Data = b64.replace(/^data:[^;]+;base64,/, "");
        const writeResult = await Filesystem.writeFile({ path: filename, data: base64Data, directory: Directory.Cache });
        await Share.share({ title: `Credit Bill — ${account.full_name}`, text: `Hi ${account.full_name}, please find your credit bill attached.`, url: writeResult.uri, dialogTitle: "Send Bill" });
      } else {
        const b64 = await buildBillPdf(account, ownerName);
        if (b64) { await downloadPdf(filename, b64); toast.success("Bill downloaded"); }
      }
    } catch (e: any) {
      if (!String(e?.message ?? "").includes("cancel")) toast.error("Failed: " + (e?.message ?? "unknown"));
    }
    setBillingId(null);
  };
  // Inline payment
  const [payAmount, setPayAmount]   = useState("");
  const [padOpen, setPadOpen]       = useState(false);
  const [paying, setPaying]         = useState(false);

  // Desktop keyboard support for the inline payment numpad
  useEffect(() => {
    if (!padOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") { e.preventDefault(); setPayAmount(v => { const dotIdx = v.indexOf("."); if (dotIdx !== -1 && v.length - dotIdx > 2) return v; return v === "0" ? e.key : v + e.key; }); }
      else if (e.key === ".") { e.preventDefault(); setPayAmount(v => v.includes(".") ? v : v + "."); }
      else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); setPayAmount(v => v.slice(0, -1)); }
      else if (e.key === "Enter") { e.preventDefault(); setPadOpen(false); }
      else if (e.key === "Escape") { e.preventDefault(); setPadOpen(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [padOpen]);

  const loadTxs = async (accountId: string) => {
    setTxLoading(true);
    const { data } = await supabase
      .from("credit_transactions")
      .select("id, credit_account_id, type, amount, note, items, created_at, tab_status, cashier_id")
      .eq("credit_account_id", accountId)
      .order("created_at", { ascending: false });
    setTxs((data ?? []) as CreditTx[]);
    setTxLoading(false);
  };

  const toggleExpand = (accountId: string) => {
    if (expanded === accountId) {
      setExpanded(null);
      setTxs([]);
      setPayAmount("");
      setPadOpen(false);
    } else {
      setExpanded(accountId);
      loadTxs(accountId);
      setPayAmount("");
      setPadOpen(false);
    }
  };

  const submitPayment = async (account: CreditAccount) => {
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (amt > Number(account.balance_owed)) { toast.error(`Cannot exceed balance owed ($${Number(account.balance_owed).toFixed(2)})`); return; }
    if (!profile) return;
    setPaying(true);
    if (editingPaymentId) {
      const oldTx = txs.find((t) => t.id === editingPaymentId);
      if (oldTx) {
        await supabase.from("credit_transactions").delete().eq("id", oldTx.id);
        const ownerId = profile?.role === "owner" ? profile.id : (profile as any)?.parent_id;
        if (ownerId && profile?.id) {
          const t = new Date(oldTx.created_at);
          await (supabase as any).rpc("delete_credit_charge_wallet_rows", {
            p_owner_id:   ownerId,
            p_cashier_id: profile.id,
            p_from_time:  new Date(t.getTime() - 5000).toISOString(),
            p_to_time:    new Date(t.getTime() + 5000).toISOString(),
          });
        }
        await supabase.rpc("reduce_credit_balance", {
          p_credit_account_id: oldTx.credit_account_id,
          p_amount: -oldTx.amount,
        });
      }
      setEditingPaymentId(null);
    }
    const { error } = await supabase.rpc("record_credit_payment", {
      p_credit_account_id: account.id,
      p_cashier_id: profile.id,
      p_amount: amt,
    });
    setPaying(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editingPaymentId ? "Payment updated" : (amt >= Number(account.balance_owed) ? `${account.full_name}'s tab fully settled!` : `Payment of $${amt.toFixed(2)} recorded`));
    setPayAmount("");
    setEditingPaymentId(null);
    loadTxs(account.id);
    onRefresh();
  };

  const deleteCharge = async (tx: CreditTx) => {
    setDeletingId(tx.id);
    const ownerId = profile?.role === "owner" ? profile.id : (profile as any)?.parent_id;

    const { error } = await supabase
      .from("credit_transactions")
      .delete()
      .eq("id", tx.id);
    if (error) { toast.error(error.message); setDeletingId(null); return; }

    // Use SECURITY DEFINER RPC to delete both owner + cashier wallet rows
    // (client-side delete is blocked by RLS when cashier tries to delete owner's row)
    if (ownerId && profile?.id) {
      const t = new Date(tx.created_at);
      await (supabase as any).rpc("delete_credit_charge_wallet_rows", {
        p_owner_id:   ownerId,
        p_cashier_id: profile.id,
        p_from_time:  new Date(t.getTime() - 5000).toISOString(),
        p_to_time:    new Date(t.getTime() + 5000).toISOString(),
      });
    }

    const { error: balErr } = await supabase.rpc("reduce_credit_balance", {
      p_credit_account_id: tx.credit_account_id,
      p_amount: tx.amount,
    });
    if (balErr) { toast.error("Transaction deleted but balance update failed"); setDeletingId(null); return; }

    setDeletingId(null);
    toast.success("Record removed");

    // Check new balance — if zero, account moved to closed, collapse it
    const { data: acc } = await supabase
      .from("credit_accounts")
      .select("balance_owed, status")
      .eq("id", tx.credit_account_id)
      .single();

    if (acc && Number(acc.balance_owed) <= 0) {
      // Collapse — it will disappear from Opened after refresh
      setExpanded(null);
      setTxs([]);
      toast.success("Bill cleared — account moved to Closed tab");
    } else {
      loadTxs(tx.credit_account_id);
    }
    onRefresh();
  };

  const deletePayment = async (tx: CreditTx) => {
    setDeletingId(tx.id);
    const ownerId = profile?.role === "owner" ? profile.id : (profile as any)?.parent_id;

    const { error } = await supabase
      .from("credit_transactions")
      .delete()
      .eq("id", tx.id);
    if (error) { toast.error(error.message); setDeletingId(null); return; }

    if (ownerId && profile?.id) {
      const t = new Date(tx.created_at);
      await (supabase as any).rpc("delete_credit_charge_wallet_rows", {
        p_owner_id:   ownerId,
        p_cashier_id: profile.id,
        p_from_time:  new Date(t.getTime() - 5000).toISOString(),
        p_to_time:    new Date(t.getTime() + 5000).toISOString(),
      });
    }

    const { error: balErr } = await supabase.rpc("reduce_credit_balance", {
      p_credit_account_id: tx.credit_account_id,
      p_amount: -tx.amount,
    });
    if (balErr) { toast.error("Transaction deleted but balance update failed"); setDeletingId(null); return; }

    setDeletingId(null);
    toast.success("Payment removed — balance restored");
    loadTxs(tx.credit_account_id);
    onRefresh();
  };

  if (loading) return <Spinner />;
  if (accounts.length === 0)
    return (
      <div className="text-center py-16 text-muted-foreground">
        <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-semibold">No open tabs</p>
      </div>
    );

  return (
    <div className="space-y-2">
      {accounts.map((a) => {
        const hasOpenTab = !!openTabs[a.id];
        return (
        <div
          key={a.id}
          className="rounded-2xl border overflow-hidden"
          style={{
            background: "var(--gradient-card)",
            borderColor: hasOpenTab ? "rgba(251,146,60,0.5)" : "var(--border)",
          }}
        >
          {/* Tab running banner */}
          {hasOpenTab && (
            <div
              className="flex items-center justify-between px-4 py-2 border-b"
              style={{ background: "rgba(251,146,60,0.1)", borderColor: "rgba(251,146,60,0.3)" }}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">🍺</span>
                <span className="text-xs font-black" style={{ color: "var(--primary)" }}>Tab Running</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); endTab(a); }}
                disabled={endingTabId === a.id}
                className="flex items-center gap-1.5 px-3 h-8 rounded-xl text-xs font-black transition active:scale-95 disabled:opacity-50"
                style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "#b91c1c" }}
              >
                {endingTabId === a.id
                  ? <div className="h-3 w-3 rounded-full border-2 border-red-400 border-t-transparent animate-spin" />
                  : "🔴 End Tab"}
              </button>
            </div>
          )}

          {/* Account row */}
          <div
            className="p-4 cursor-pointer"
            onClick={() => toggleExpand(a.id)}
          >
            <div className="flex items-start justify-between gap-3">
              {/* Left: name + details */}
              <div className="flex-1 min-w-0">
                <p className="font-black text-base">{a.full_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{new Date(a.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                {a.contact_number && <p className="text-xs text-muted-foreground mt-0.5">{a.contact_number}</p>}
                {a.id_number && <p className="text-xs text-muted-foreground mt-0.5">{a.id_number}</p>}
              </div>

              {/* Right: amount box + Bill + Edit stacked */}
              <div className="flex items-start gap-2 shrink-0">
                {/* Amount owed box */}
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center border border-red-400/30"
                  style={{ background: "rgba(248,113,113,0.08)" }}>
                  <span className="text-sm font-black text-red-700 text-center leading-tight px-1">
                    ${Number(a.balance_owed).toFixed(2)}
                  </span>
                </div>

                {/* Bill + Edit stacked, same size as amount box */}
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); setBillAccount(a); }}
                    className="w-16 h-16 rounded-2xl flex flex-col items-center justify-center gap-1 active:scale-95 transition shrink-0"
                    style={{ background: "rgba(251,146,60,0.15)", border: "1px solid rgba(251,146,60,0.3)" }}
                  >
                    <FileDown className="h-5 w-5" style={{ color: "var(--primary)" }} />
                    <span className="text-xs font-black" style={{ color: "var(--primary)" }}>{t("bill", "Bill")}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit(a); }}
                    className="w-16 h-16 rounded-2xl flex flex-col items-center justify-center gap-1 active:scale-95 transition shrink-0"
                    style={{ background: "rgba(251,146,60,0.15)", border: "1px solid rgba(251,146,60,0.3)" }}
                  >
                    <Pencil className="h-5 w-5" style={{ color: "var(--primary)" }} />
                    <span className="text-xs font-black" style={{ color: "var(--primary)" }}>{t("edit", "Edit")}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Chevron centered at bottom */}
            <div className="flex justify-center mt-2">
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded === a.id ? "rotate-180" : ""}`} />
            </div>
          </div>

          {/* Expanded section */}
          {expanded === a.id && (
            <div className="border-t border-border/50 px-4 pb-3 space-y-1">

              {/* ── Inline payment input ── */}
              <div className="py-3 border-b border-border/40 mb-2">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
                  {editingPaymentId ? t("update_payment_lbl", "Update Payment") : t("record_payment_lbl", "Record Payment")}
                </p>
                 <div className="flex gap-2">
                   {/* Tappable amount display — opens numpad */}
                  <div className="flex items-center flex-1 min-w-0 h-14 rounded-xl border border-input bg-background px-3 gap-1 text-left">
                    <span className="text-base font-bold text-muted-foreground">$</span>
                    <input
                      type="text"
                      inputMode={Capacitor.isNativePlatform() ? "none" : "decimal"}
                      readOnly={Capacitor.isNativePlatform()}
                      value={payAmount}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "" || /^\d*\.?\d*$/.test(val)) {
                          setPayAmount(val);
                        }
                      }}
                      onFocus={() => setPadOpen(true)}
                      onClick={() => setPadOpen(true)}
                      placeholder="0.00"
                      className="flex-1 bg-transparent outline-none text-xl font-black min-w-0"
                    />
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">{t("max_lbl", "max")} ${Number(a.balance_owed).toFixed(2)}</span>
                  </div>
                  <Button
                    className="h-14 px-6 font-black text-base shrink-0 rounded-xl"
                    disabled={paying || !payAmount}
                    onClick={() => { setPadOpen(false); submitPayment(a); }}
                    style={{ background: "var(--gradient-hero)", color: "var(--primary-foreground)" }}
                  >
                    {paying ? <div className="h-5 w-5 rounded-full border-2 border-white border-t-transparent animate-spin" /> : (editingPaymentId ? t("update", "Update") : t("pay_btn", "Pay"))}
                  </Button>
                </div>

                {/* Numpad */}
                {padOpen && (
                  <div className="grid grid-cols-3 gap-1.5 mt-3">
                    {["1","2","3","4","5","6","7","8","9",".","0","⌫"].map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          if (k === "⌫") {
                            setPayAmount((v) => v.slice(0, -1));
                          } else if (k === ".") {
                            if (!payAmount.includes(".")) setPayAmount((v) => v + ".");
                          } else {
                            const dotIdx = payAmount.indexOf(".");
                            if (dotIdx !== -1 && payAmount.length - dotIdx > 2) return;
                            setPayAmount((v) => (v === "0" ? k : v + k));
                          }
                        }}
                        className={`h-12 rounded-xl font-black text-xl transition active:scale-95 ${
                          k === "⌫"
                            ? "bg-destructive/20 text-destructive"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Transaction records ── */}
              {txLoading ? (
                <div className="py-4 flex justify-center">
                  <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </div>
              ) : txs.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center">No records found</p>
              ) : (
                (() => {
                  // Find the index of the most recent payment (txs are newest-first).
                  // Only charge rows ABOVE (newer than) that index are deletable —
                  // they belong to the current open session.
                  const lastPaymentIdx = txs.findIndex((t) => t.type === "payment");
                  return txs.map((tx, idx) => {
                  const dt = new Date(tx.created_at);
                  const date = dt.toLocaleDateString("en-GB");
                  const time = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
                  const isCharge = tx.type === "charge";
                  const isPayment = tx.type === "payment";
                  // Charges deletable if newer than last payment; payments only if it's the latest one
                  const canDelete = (!isCharge && !isPayment) ? false : (isPayment ? idx === lastPaymentIdx : (lastPaymentIdx === -1 || idx < lastPaymentIdx));
                  const canEdit = isPayment && expanded === a.id;
                  // Highlight the single tab row when it's open
                  const isTabCharge = isCharge && tx.tab_status != null;
                  return (
                    <div
                      key={tx.id}
                      className="flex items-start justify-between py-2.5 border-b border-border/30 last:border-0"
                      style={isTabCharge ? { background: "rgba(251,146,60,0.06)", borderRadius: "8px", paddingLeft: "8px", paddingRight: "4px", marginBottom: "2px" } : {}}
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        {isTabCharge && (
                          <span
                            className="inline-block text-[9px] font-black px-1.5 py-0.5 rounded-full mb-0.5"
                            style={{ background: "rgba(251,146,60,0.2)", color: "var(--primary)" }}
                          >
                            🍺 TAB
                          </span>
                        )}
                        {isTabCharge && tx.items && tx.items.length > 0 ? (
                          <div className="space-y-0.5">
                            {tx.items.map((item: any, i: number) => (
                              <p key={i} className="text-xs font-bold leading-snug">
                                {item.qty}x {item.name}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs font-bold leading-snug">
                            {tx.note ?? (isCharge ? "Credit charge" : "Payment received")}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-0.5">{date} · {time}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 mt-0.5">
                        <span className={`text-sm font-black ${isCharge ? "text-red-700" : "text-green-700"}`}>
                          {isCharge ? "+" : "-"}${Number(tx.amount).toFixed(2)}
                        </span>
                        {/* Per-record receipt button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); setReceiptTx({ tx, account: a }); }}
                          className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-primary/10 transition"
                          style={{ color: "var(--primary)" }}
                          title="Print bill"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                        {canEdit && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingPaymentId(tx.id);
                              setPayAmount(String(tx.amount));
                            }}
                            className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-primary/10 transition"
                            style={{ color: "var(--primary)" }}
                            title="Edit payment"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => setConfirmDeleteTx(tx)}
                            disabled={deletingId === tx.id}
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-destructive hover:bg-destructive/10 transition disabled:opacity-40"
                          >
                            {deletingId === tx.id
                              ? <div className="h-3.5 w-3.5 rounded-full border-2 border-destructive border-t-transparent animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />
                            }
                          </button>
                        )}
                        {!canDelete && !canEdit && <div className="h-7 w-7" />}
                      </div>
                    </div>
                  );
                  });
                })()
              )}
            </div>
          )}
        </div>
        );
      })}

      {/* ── Confirm delete modal ── */}
      {confirmDeleteTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-3xl border border-border shadow-2xl overflow-hidden" style={{ background: "var(--gradient-card)" }}>
            <div className="px-6 pt-6 pb-2 text-center">
              <div className="h-12 w-12 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center mx-auto mb-3">
                <Trash2 className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="font-black text-base">Delete Record?</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                {confirmDeleteTx.note ?? (confirmDeleteTx.type === "payment" ? "This payment" : "This charge")}<br />
                <span className="font-bold text-red-700">${Number(confirmDeleteTx.amount).toFixed(2)}</span> {confirmDeleteTx.type === "payment" ? "will be added back to the balance" : "will be removed from the balance"}.
              </p>
            </div>
            <div className="px-6 pb-6 pt-4 flex gap-3">
              <Button variant="outline" className="flex-1 h-11" onClick={() => setConfirmDeleteTx(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1 h-11 font-black bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deletingId === confirmDeleteTx.id}
                onClick={() => {
                  const tx = confirmDeleteTx;
                  setConfirmDeleteTx(null);
                  if (tx.type === "payment") deletePayment(tx);
                  else deleteCharge(tx);
                }}
              >
                {deletingId === confirmDeleteTx.id
                  ? <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Single-record receipt modal */}
      {receiptTx && (
        <SingleReceiptModal tx={receiptTx.tx} account={receiptTx.account} ownerName={ownerName} onClose={() => setReceiptTx(null)} />
      )}

      {/* Bill modal */}
      {billAccount && (
        <BillModal account={billAccount} ownerName={ownerName} onClose={() => setBillAccount(null)} />
      )}
    </div>
  );
}

// ── Closed Tab ─────────────────────────────────────────────────────────────────
function ClosedTab({ accounts, loading, onRefresh, onEdit }: { accounts: CreditAccount[]; loading: boolean; onRefresh: () => void; onEdit: (a: CreditAccount) => void }) {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const ownerName = profile?.username ?? "Bar";
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [txs, setTxs]             = useState<CreditTx[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CreditAccount | null>(null);
  const [deleting, setDeleting]   = useState(false);
  const [billAccount, setBillAccount] = useState<CreditAccount | null>(null);
  const [receiptTx, setReceiptTx] = useState<{ tx: CreditTx; account: CreditAccount } | null>(null);
  const [billingId, setBillingId] = useState<string | null>(null);

  const handleBillShare = async (account: CreditAccount) => {
    setBillingId(account.id);
    try {
      const safeName = account.full_name.replace(/\s+/g, "-").toLowerCase();
      const filename = `credit-bill-${safeName}.pdf`;
      if (Capacitor.isNativePlatform()) {
        const b64 = await buildBillPdf(account, ownerName);
        if (!b64) { setBillingId(null); return; }
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const { Share } = await import("@capacitor/share");
        const base64Data = b64.replace(/^data:[^;]+;base64,/, "");
        const writeResult = await Filesystem.writeFile({ path: filename, data: base64Data, directory: Directory.Cache });
        await Share.share({ title: `Credit Bill — ${account.full_name}`, text: `Hi ${account.full_name}, please find your credit bill attached.`, url: writeResult.uri, dialogTitle: "Send Bill" });
      } else {
        const b64 = await buildBillPdf(account, ownerName);
        if (b64) { await downloadPdf(filename, b64); toast.success("Bill downloaded"); }
      }
    } catch (e: any) {
      if (!String(e?.message ?? "").includes("cancel")) toast.error("Failed: " + (e?.message ?? "unknown"));
    }
    setBillingId(null);
  };

  const toggleExpand = async (accountId: string) => {
    if (expanded === accountId) { setExpanded(null); setTxs([]); return; }
    setExpanded(accountId);
    setTxLoading(true);
    const { data } = await supabase
      .from("credit_transactions")
      .select("id, credit_account_id, type, amount, note, items, created_at, cashier_id")
      .eq("credit_account_id", accountId)
      .order("created_at", { ascending: false });
    setTxs((data ?? []) as CreditTx[]);
    setTxLoading(false);
  };

  const deleteAccount = async (account: CreditAccount) => {
    setDeleting(true);
    const { error } = await supabase
      .from("credit_accounts")
      .delete()
      .eq("id", account.id);
    setDeleting(false);
    setConfirmDelete(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${account.full_name} removed`);
    onRefresh();
  };

  if (loading) return <Spinner />;
  if (accounts.length === 0)
    return (
      <div className="text-center py-16 text-muted-foreground">
        <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-semibold">No closed accounts yet</p>
      </div>
    );
  return (
    <div className="space-y-2">
      {accounts.map((a) => (
        <div
          key={a.id}
          className="rounded-2xl border border-border overflow-hidden"
          style={{ background: "var(--gradient-card)" }}
        >
          <div
            className="p-4 cursor-pointer"
            onClick={() => toggleExpand(a.id)}
          >
            <div className="flex items-start justify-between gap-3">
              {/* Left: name + details */}
              <div className="flex-1 min-w-0">
                <p className="font-black text-base">{a.full_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{new Date(a.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                {a.contact_number && <p className="text-xs text-muted-foreground mt-0.5">{a.contact_number}</p>}
                {a.id_number && <p className="text-xs text-muted-foreground mt-0.5">{a.id_number}</p>}
              </div>

              {/* Right: Bill + Delete + Edit stacked */}
              <div className="flex items-stretch gap-2 shrink-0">
                {/* Bill button — only when account has records */}
                {(a.tx_count ?? 0) > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setBillAccount(a); }}
                    className="w-16 h-16 rounded-2xl flex flex-col items-center justify-center gap-1 active:scale-95 transition"
                    style={{ background: "rgba(251,146,60,0.15)", border: "1px solid rgba(251,146,60,0.3)" }}
                  >
                    <FileDown className="h-5 w-5" style={{ color: "var(--primary)" }} />
                    <span className="text-xs font-black" style={{ color: "var(--primary)" }}>{t("bill", "Bill")}</span>
                  </button>
                )}

                {/* Delete + Edit stacked */}
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(a); }}
                    className="w-16 h-[2.9rem] rounded-2xl flex flex-col items-center justify-center gap-0.5 active:scale-95 transition"
                    style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                    <span className="text-[11px] font-black text-destructive">{t("delete", "Delete")}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit(a); }}
                    className="w-16 h-[2.9rem] rounded-2xl flex flex-col items-center justify-center gap-0.5 active:scale-95 transition"
                    style={{ background: "rgba(251,146,60,0.15)", border: "1px solid rgba(251,146,60,0.3)" }}
                  >
                    <Pencil className="h-4 w-4" style={{ color: "var(--primary)" }} />
                    <span className="text-[11px] font-black" style={{ color: "var(--primary)" }}>{t("edit", "Edit")}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Chevron centered at bottom */}
            <div className="flex justify-center mt-2">
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded === a.id ? "rotate-180" : ""}`} />
            </div>
          </div>

          {expanded === a.id && (
            <div className="border-t border-border/50 px-4 pb-3 space-y-1">
              {txLoading ? (
                <div className="py-4 flex justify-center">
                  <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </div>
              ) : txs.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center">No records</p>
              ) : (
                txs.map((tx) => {
                  const dt   = new Date(tx.created_at);
                  const date = dt.toLocaleDateString("en-GB");
                  const time = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
                  const isCharge = tx.type === "charge";
                  const isTabCharge = isCharge && tx.tab_status != null;
                  return (
                    <div key={tx.id} className="flex items-start justify-between py-2.5 border-b border-border/30 last:border-0">
                      <div className="flex-1 min-w-0 pr-2">
                        {isTabCharge && (
                          <span
                            className="inline-block text-[9px] font-black px-1.5 py-0.5 rounded-full mb-0.5"
                            style={{ background: "rgba(251,146,60,0.2)", color: "var(--primary)" }}
                          >
                            🍺 TAB
                          </span>
                        )}
                        {isTabCharge && tx.items && tx.items.length > 0 ? (
                          <div className="space-y-0.5">
                            {tx.items.map((item: any, i: number) => (
                              <p key={i} className="text-xs font-bold leading-snug">
                                {item.qty}x {item.name}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs font-bold leading-snug">
                            {tx.note ?? (isCharge ? "Credit charge" : "Payment received")}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-0.5">{date} · {time}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 mt-0.5">
                        <span className={`text-sm font-black ${isCharge ? "text-red-700" : "text-green-700"}`}>
                          {isCharge ? "+" : "-"}${Number(tx.amount).toFixed(2)}
                        </span>
                        {/* Per-record receipt button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); setReceiptTx({ tx, account: a }); }}
                          className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-primary/10 transition"
                          style={{ color: "var(--primary)" }}
                          title="Print bill"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      ))}

      {/* ── Confirm delete customer modal ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-3xl border border-border shadow-2xl overflow-hidden" style={{ background: "var(--gradient-card)" }}>
            <div className="px-6 pt-6 pb-2 text-center">
              <div className="h-12 w-12 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center mx-auto mb-3">
                <Trash2 className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="font-black text-base">Delete Customer?</h3>
              <p className="text-sm text-muted-foreground mt-1">
                <span className="font-bold text-foreground">{confirmDelete.full_name}</span> and all their records will be permanently removed.
              </p>
            </div>
            <div className="px-6 pb-6 pt-4 flex gap-3">
              <Button variant="outline" className="flex-1 h-11" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1 h-11 font-black bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleting}
                onClick={() => deleteAccount(confirmDelete)}
              >
                {deleting
                  ? <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Single-record receipt modal */}
      {receiptTx && (
        <SingleReceiptModal tx={receiptTx.tx} account={receiptTx.account} ownerName={ownerName} onClose={() => setReceiptTx(null)} />
      )}

      {/* Bill modal */}
      {billAccount && (
        <BillModal account={billAccount} ownerName={ownerName} onClose={() => setBillAccount(null)} />
      )}
    </div>
  );
}

// ── Create Tab ─────────────────────────────────────────────────────────────────
type ActiveField = null | "name" | "idNumber" | "contact";

function CreateTab({ ownerId, onCreated }: { ownerId: string; onCreated: (a: CreditAccount) => void }) {
  const [name, setName]         = useState("");
  const [contact, setContact]   = useState("");
  const [idType, setIdType]     = useState<"drivers_permit" | "national_id">("national_id");
  const [idNumber, setIdNumber] = useState("");
  const [busy, setBusy]         = useState(false);
  const [done, setDone]         = useState(false);
  const [activeField, setActiveField] = useState<ActiveField>(null);

  const toggle = (f: ActiveField) => setActiveField((cur) => cur === f ? null : f);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setActiveField(null);
    setBusy(true);
    const { data, error } = await supabase
      .from("credit_accounts")
      .insert({
        owner_id: ownerId,
        full_name: name.trim(),
        contact_number: contact.trim() ? "868-" + contact.trim() : null,
        id_number: idNumber.trim() ? `${idType === "drivers_permit" ? "DP" : "NID"}: ${idNumber.trim()}` : null,
        status: "closed",
      })
      .select()
      .single();
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setDone(true);
    onCreated(data as CreditAccount);
    setName(""); setContact(""); setIdNumber(""); setIdType("national_id");
  };

  return (
    <div className="rounded-2xl p-5 space-y-4" style={{ background: "var(--gradient-card)" }}>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--gradient-hero)" }}>
          <UserPlus className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h2 className="font-black text-base">New Credit Account</h2>
          <p className="text-xs text-muted-foreground">Customer will be added to the Closed tab</p>
        </div>
      </div>

      {done && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/30 text-sm text-green-700 font-semibold">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Customer created. View in Closed tab.
        </div>
      )}

       <form onSubmit={submit} className="space-y-3">
         {/* Full Name */}
         <div>
           <Label>Full Name *</Label>
           <input
             type="text"
             value={name}
             onChange={(e) => { setDone(false); setName(e.target.value); }}
             onFocus={() => setActiveField("name")}
             readOnly={Capacitor.isNativePlatform()}
             placeholder="e.g. John Smith"
             className="w-full h-10 rounded-md border border-input px-3 text-left mt-1"
             style={{ background: "#ffffff" }}
           />
           {activeField === "name" && <AlphaKeyboard value={name} onChange={setName} onDone={() => setActiveField(null)} />}
         </div>

         {/* ID Type */}
         <div>
           <Label htmlFor="credit-idtype">ID Type</Label>
           <select id="credit-idtype" value={idType}
             onChange={(e) => setIdType(e.target.value as "drivers_permit" | "national_id")}
             className="w-full h-10 rounded-md border border-input px-3 text-sm font-semibold mt-1"
             style={{ background: "#ffffff", color: "#000000" }}>
             <option value="drivers_permit">Driver's Permit</option>
             <option value="national_id">National ID</option>
           </select>
         </div>

          {/* ID Number */}
          <div>
            <Label>ID Number</Label>
             <input
               type="text"
               inputMode={Capacitor.isNativePlatform() ? "none" : "numeric"}
               readOnly={Capacitor.isNativePlatform()}
               value={idNumber}
               onChange={(e) => {
                 const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 7);
                 setIdNumber(v);
               }}
               onFocus={() => setActiveField("idNumber")}
               placeholder="e.g. 00000000"
               maxLength={7}
               className="w-full h-10 rounded-md border border-input px-3 text-left mt-1"
               style={{ background: "#ffffff" }}
             />
            {activeField === "idNumber" && (
              <NumPad value={idNumber} onChange={setIdNumber} maxLen={20} onDone={() => setActiveField(null)} />
            )}
          </div>

          {/* Contact Number */}
          <div>
            <Label>Contact Number</Label>
            <div className="flex items-center mt-1">
              <span className="h-10 px-3 flex items-center rounded-l-md border border-r-0 border-input bg-muted text-sm font-bold text-muted-foreground select-none">868</span>
               <input
                 type="text"
                 inputMode={Capacitor.isNativePlatform() ? "none" : "tel"}
                 readOnly={Capacitor.isNativePlatform()}
                 value={contact}
                 onChange={(e) => {
                   const digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 7);
                   const formatted = digits.length > 3 ? digits.slice(0, 3) + "-" + digits.slice(3) : digits;
                   setContact(formatted);
                 }}
                 onFocus={() => setActiveField("contact")}
                 placeholder="XXX-XXXX"
                 maxLength={8}
                 className="flex-1 h-10 rounded-r-md border border-input px-3 text-left"
                 style={{ background: "#ffffff" }}
               />
            </div>
            {activeField === "contact" && (
              <ContactNumPad value={contact} onChange={setContact} onDone={() => setActiveField(null)} />
            )}
          </div>

         <Button type="submit" disabled={busy || !name.trim() || (contact.replace("-","").length > 0 && contact.replace("-","").length < 7)} className="w-full h-12 font-black text-base"
           style={{ background: "var(--gradient-hero)", color: "var(--primary-foreground)" }}>
           {busy ? "Creating…" : "Create Account"}
         </Button>
       </form>
    </div>
  );
}

// ── Shared keyboard helpers ────────────────────────────────────────────────────
function NumPad({ value, onChange, maxLen = 20, onDone }: {
  value: string; onChange: (v: string) => void; maxLen?: number; onDone: () => void;
}) {
  useNumpadKeyboard({
    enabled: true,
    allowDecimal: false,
    onKey: (k) => {
      if (k === "⌫") onChange(value.slice(0, -1));
      else if (value.length < maxLen) onChange(value + k);
    },
    onEnter: onDone,
  });

  return (
    <div className="mt-2">
      <div className="grid grid-cols-3 gap-1.5">
        {["1","2","3","4","5","6","7","8","9","done","0","⌫"].map((k, i) =>
          k === "done"
            ? <button key="done" type="button" onClick={onDone}
                className="h-12 rounded-xl font-black text-sm active:scale-95 transition text-primary-foreground"
                style={{ background: "var(--gradient-hero)" }}>Done</button>
            : <button key={k + i} type="button"
                onClick={() => {
                  if (k === "⌫") onChange(value.slice(0, -1));
                  else if (value.length < maxLen) onChange(value + k);
                }}
                className={`h-12 rounded-xl font-black text-xl transition active:scale-95 ${k === "⌫" ? "bg-destructive/20 text-destructive" : "bg-muted text-foreground"}`}
              >{k}</button>
        )}
      </div>
    </div>
  );
}

function ContactNumPad({ value, onChange, onDone }: {
  value: string; onChange: (v: string) => void; onDone: () => void;
}) {
  const digits = value.replace("-", "");
  const complete = digits.length === 7;
  const handle = (k: string) => {
    if (k === "⌫") {
      const d = value.replace("-", "").slice(0, -1);
      onChange(d.length > 3 ? d.slice(0, 3) + "-" + d.slice(3) : d);
    } else {
      const d = (value.replace("-", "") + k).slice(0, 7);
      onChange(d.length > 3 ? d.slice(0, 3) + "-" + d.slice(3) : d);
    }
  };

  useNumpadKeyboard({
    enabled: true,
    allowDecimal: false,
    onKey: handle,
    onEnter: () => { if (complete) onDone(); },
  });

  return (
    <div className="mt-2">
      {!complete && digits.length > 0 && (
        <p className="text-xs font-semibold text-amber-400 mb-1.5 text-center">
          {7 - digits.length} digit{7 - digits.length !== 1 ? "s" : ""} remaining
        </p>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        {["1","2","3","4","5","6","7","8","9","done","0","⌫"].map((k, i) =>
          k === "done"
            ? <button key="done" type="button"
                onClick={() => { if (complete) onDone(); }}
                className={`h-12 rounded-xl font-black text-sm transition text-primary-foreground ${complete ? "active:scale-95" : "opacity-30 cursor-not-allowed"}`}
                style={{ background: "var(--gradient-hero)" }}>Done</button>
            : <button key={k + i} type="button" onClick={() => handle(k)}
                className={`h-12 rounded-xl font-black text-xl transition active:scale-95 ${k === "⌫" ? "bg-destructive/20 text-destructive" : "bg-muted text-foreground"}`}
              >{k}</button>
        )}
      </div>
    </div>
  );
}

const ALPHA_ROWS = [
  ["Q","W","E","R","T","Y","U","I","O","P"],
  ["A","S","D","F","G","H","J","K","L"],
  ["Z","X","C","V","B","N","M","⌫"],
];

function AlphaKeyboard({ value, onChange, onDone }: {
  value: string; onChange: (v: string) => void; onDone: () => void;
}) {
  return (
    <div className="mt-2 space-y-1.5">
      {ALPHA_ROWS.map((row, ri) => (
        <div key={ri} className="flex gap-1 justify-center">
          {row.map((k) => (
            <button key={k} type="button"
              onClick={() => {
                if (k === "⌫") onChange(value.slice(0, -1));
                else onChange(value + k);
              }}
              className={`flex-1 h-10 rounded-lg font-bold text-sm transition active:scale-95 max-w-[38px] ${
                k === "⌫" ? "bg-destructive/20 text-destructive" : "bg-muted text-foreground"
              }`}
            >{k}</button>
          ))}
        </div>
      ))}
      <div className="flex gap-1.5">
        <button type="button" onClick={() => onChange(value + " ")}
          className="flex-1 h-10 rounded-lg bg-muted text-foreground font-bold text-sm active:scale-95 transition">
          SPACE
        </button>
        <button type="button" onClick={onDone}
          className="w-20 h-10 rounded-lg bg-primary text-primary-foreground font-bold text-sm active:scale-95 transition">
          Done
        </button>
      </div>
    </div>
  );
}

// ── Edit Customer Modal ────────────────────────────────────────────────────────
function EditCustomerModal({ account, onClose, onSaved }: {
  account: CreditAccount;
  onClose: () => void;
  onSaved: (updated: CreditAccount) => void;
}) {
  const parseContact = (c: string | null) => c ? c.replace(/^868-?/, "") : "";
  const parseIdType = (n: string | null): "drivers_permit" | "national_id" =>
    n?.startsWith("DP:") ? "drivers_permit" : "national_id";
  const parseIdNumber = (n: string | null) => n ? n.replace(/^(DP|NID):\s*/, "") : "";

  const [name, setName] = useState(account.full_name);
  const [contact, setContact] = useState(parseContact(account.contact_number));
  const [idType, setIdType] = useState<"drivers_permit" | "national_id">(parseIdType(account.id_number));
  const [idNumber, setIdNumber] = useState(parseIdNumber(account.id_number));
  const [busy, setBusy] = useState(false);
  const [activeField, setActiveField] = useState<null | "name" | "idNumber" | "contact">(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("credit_accounts")
      .update({
        full_name: name.trim(),
        contact_number: contact.trim() ? "868-" + contact.trim() : null,
        id_number: idNumber.trim() ? `${idType === "drivers_permit" ? "DP" : "NID"}: ${idNumber.trim()}` : null,
      })
      .eq("id", account.id)
      .select()
      .single();
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Customer updated");
    onSaved(data as CreditAccount);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-border shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        style={{ background: "var(--gradient-card)" }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--gradient-hero)" }}>
              <Pencil className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-black text-base">Edit Customer</h2>
              <p className="text-xs text-muted-foreground">Update account details</p>
            </div>
          </div>
          <button onClick={onClose} className="h-9 w-9 rounded-full flex items-center justify-center bg-muted transition">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto flex-1">
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label>Full Name *</Label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onFocus={() => setActiveField("name")}
                readOnly={Capacitor.isNativePlatform()}
                placeholder="e.g. John Smith"
                className="w-full h-10 rounded-md border border-input px-3 text-left mt-1"
                style={{ background: "#ffffff" }}
              />
              {activeField === "name" && <AlphaKeyboard value={name} onChange={setName} onDone={() => setActiveField(null)} />}
            </div>
            <div>
              <Label>ID Type</Label>
              <select value={idType} onChange={(e) => setIdType(e.target.value as "drivers_permit" | "national_id")}
                className="w-full h-10 rounded-md border border-input px-3 text-sm font-semibold mt-1"
                style={{ background: "#ffffff", color: "#000000" }}>
                <option value="drivers_permit">Driver's Permit</option>
                <option value="national_id">National ID</option>
              </select>
            </div>
             <div>
                <Label>ID Number</Label>
                <input
                  type="text"
                  inputMode={Capacitor.isNativePlatform() ? "none" : "numeric"}
                  readOnly={Capacitor.isNativePlatform()}
                  value={idNumber}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 7);
                    setIdNumber(v);
                  }}
                  onFocus={() => setActiveField("idNumber")}
                  placeholder="e.g. 00000000"
                  maxLength={7}
                  className="w-full h-10 rounded-md border border-input px-3 text-left mt-1"
                  style={{ background: "#ffffff" }}
                />
                {activeField === "idNumber" && <NumPad value={idNumber} onChange={setIdNumber} maxLen={20} onDone={() => setActiveField(null)} />}
              </div>
              <div>
                <Label>Contact Number</Label>
                <div className="flex items-center mt-1">
                  <span className="h-10 px-3 flex items-center rounded-l-md border border-r-0 border-input bg-muted text-sm font-bold text-muted-foreground select-none">868</span>
                  <input
                    type="text"
                    inputMode={Capacitor.isNativePlatform() ? "none" : "tel"}
                    readOnly={Capacitor.isNativePlatform()}
                    value={contact}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 7);
                      const formatted = digits.length > 3 ? digits.slice(0, 3) + "-" + digits.slice(3) : digits;
                      setContact(formatted);
                    }}
                    onFocus={() => setActiveField("contact")}
                    placeholder="XXX-XXXX"
                    maxLength={8}
                    className="flex-1 h-10 rounded-r-md border border-input px-3 text-left"
                    style={{ background: "#ffffff" }}
                  />
                </div>
                {activeField === "contact" && <ContactNumPad value={contact} onChange={setContact} onDone={() => setActiveField(null)} />}
              </div>
            <Button type="submit" disabled={busy || !name.trim() || (contact.replace("-","").length > 0 && contact.replace("-","").length < 7)}
              className="w-full h-12 font-black text-base"
              style={{ background: "var(--gradient-hero)", color: "var(--primary-foreground)" }}>
              {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : "Save Changes"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Payment Overlay ────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="h-7 w-7 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}