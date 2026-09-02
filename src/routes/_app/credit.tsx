import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useChain } from "@/lib/ChainContext";
import { useTranslation } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  UserPlus, X, ChevronRight, Camera, CheckCircle2,
  DollarSign, ClipboardList, FileDown, Loader2, Trash2, Pencil, Share2,
} from "lucide-react";
import { downloadPdf } from "@/lib/download";
import { drawHeader, addFootersToAllPages, LM, RM, CONTENT_BOTTOM } from "@/lib/pdfHelpers";
import { printReceipt, type ReceiptData } from "@/lib/receiptPrinter";
import { Capacitor } from "@capacitor/core";

export const Route = createFileRoute("/_app/credit")({
  component: CreditPage,
});

// ── Types ──────────────────────────────────────────────────────────────────────
type CreditAccount = {
  id: string;
  owner_id: string;
  full_name: string;
  contact_number: string | null;
  id_image_url: string | null;
  id_number: string | null;
  balance_owed: number;
  status: "open" | "closed";
  created_at: string;
};

// ── Print Bill ─────────────────────────────────────────────────────────────────
async function printBill(account: CreditAccount, ownerName: string, cashierName = "Staff") {
  await printThermalBill(account, ownerName, cashierName);
}

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

  for (const tx of txs ?? []) {
    if (y > CONTENT_BOTTOM) { doc.addPage(); y = 20; }
    const isCharge = tx.type === "charge";
    const dateStr = new Date(tx.created_at).toLocaleString("en-GB", { hour:"2-digit", minute:"2-digit", hour12:true, day:"2-digit", month:"short", year:"numeric" });

    doc.setFont("helvetica","bold");
    doc.setTextColor(isCharge?200:40, isCharge?60:140, 40);
    doc.text(isCharge?"CHARGE":"PAYMENT", LM, y);
    doc.setTextColor(0,0,0); doc.setFont("helvetica","normal");
    doc.text(dateStr, LM+22, y);
    doc.setFont("helvetica","bold");
    doc.setTextColor(isCharge?200:40, isCharge?60:140, 40);
    doc.text((isCharge?"+":"-")+"$"+Number(tx.amount).toFixed(2), RM, y, { align:"right" });
    doc.setTextColor(0,0,0);
    y += 5;

    if (isCharge && tx.items && Array.isArray(tx.items) && (tx.items as any[]).length > 0) {
      if (y > CONTENT_BOTTOM - 8) { doc.addPage(); y = 20; }
      const C_ITEM  = LM + 4;
      const C_QTY   = LM + 100;
      const C_PRICE = LM + 140;
      const C_TOTAL = RM;

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

      if (y > CONTENT_BOTTOM - 6) { doc.addPage(); y = 20; }
      doc.setDrawColor(210,210,210); doc.setLineWidth(0.15); doc.line(C_ITEM, y, RM, y); y += 3;
      doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(80,80,80);
      doc.text("Subtotal", C_ITEM, y);
      doc.setTextColor(...ORANGE);
      doc.text("$"+chargeTotalSP.toFixed(2), C_TOTAL, y, { align:"right" });
      doc.setTextColor(0,0,0); doc.setFontSize(8.5);
      y += 5;
    }

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

async function printThermalBill(account: CreditAccount, ownerName: string, cashierName?: string) {
  const { data: txs, error } = await supabase
    .from("credit_transactions")
    .select("id, type, amount, note, items, created_at")
    .eq("credit_account_id", account.id)
    .order("created_at", { ascending: true });

  if (error) {
    toast.error("Failed to load transactions");
    return;
  }

  const items: { name: string; qty: number; price: number }[] = [];
  let subtotal = 0;

  for (const tx of txs ?? []) {
    if (tx.type === "charge") {
      if (tx.items && Array.isArray(tx.items) && (tx.items as any[]).length > 0) {
        for (const it of (tx.items as any[])) {
          const qty = Number(it?.qty ?? 1);
          const price = Number(it?.price ?? 0);
          items.push({
            name: it?.name || "Item",
            qty,
            price,
          });
          subtotal += qty * price;
        }
      } else {
        const itemTitle = tx.note ? tx.note.replace(/^\[CASH\]\s*/, "") : "Charge";
        items.push({
          name: itemTitle,
          qty: 1,
          price: Number(tx.amount),
        });
        subtotal += Number(tx.amount);
      }
    }
  }

  const payments = (txs ?? []).filter((t) => t.type === "payment").reduce((s, t) => s + Number(t.amount), 0);

  const receiptData: ReceiptData = {
    storeName: ownerName || "Store",
    locationName: "Main location",
    orderNumber: "BILL",
    serverName: cashierName || "Staff",
    customerName: account.full_name,
    items: items.length > 0 ? items : [{ name: "Account Balance", qty: 1, price: Number(account.balance_owed) }],
    subtotal: subtotal > 0 ? subtotal : Number(account.balance_owed),
    total: Number(account.balance_owed),
    paid: payments,
    change: 0,
    payMode: "credit",
    date: new Date().toLocaleString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }),
  };

  const res = await printReceipt(receiptData);
  if (res.printed) {
    toast.success("Sent to printer");
  } else if (res.error) {
    toast.error(res.error);
  }
}

// ── Bill Action Modal ─────────────────────────────────────────────────────────
type CreditTx = {
  id: string;
  type: string;
  amount: number;
  note: string | null;
  items: { name: string; price: number; qty: number }[] | null;
  created_at: string;
};

function BillModal({ account, ownerName, onClose }: {
  account: CreditAccount;
  ownerName: string;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const [txs, setTxs] = useState<CreditTx[]>([]);
  const [loadingTxs, setLoadingTxs] = useState(true);
  const [busy, setBusy] = useState<"download" | "print" | "share" | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [printed, setPrinted] = useState(false);
  const safeName = account.full_name.replace(/\s+/g, "-").toLowerCase();
  const filename = `credit-bill-${safeName}.pdf`;

  // Fetch all transactions for this account on mount
  useEffect(() => {
    supabase
      .from("credit_transactions")
      .select("id, type, amount, note, items, created_at")
      .eq("credit_account_id", account.id)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setTxs(data as CreditTx[]);
        setLoadingTxs(false);
      });
  }, [account.id]);

  const handleDownload = async () => {
    setBusy("download");
    try {
      const b64 = await buildBillPdf(account, ownerName);
      if (b64) {
        await downloadPdf(filename, b64);
        setDownloaded(true);
        toast.success(Capacitor.isNativePlatform() ? "Saved to Documents folder" : "PDF downloaded");
        setTimeout(() => setDownloaded(false), 5000);
      }
    } catch (e: any) {
      if (!String(e?.message ?? "").includes("cancel")) {
        toast.error("Download failed: " + (e?.message ?? "unknown"));
      }
    }
    setBusy(null);
  };

  const handlePrintThermal = async () => {
    setBusy("print");
    try {
      const cashierName = profile?.username || "Staff";
      await printThermalBill(account, ownerName, cashierName);
      setPrinted(true);
      setTimeout(() => setPrinted(false), 5000);
    } catch (e: any) {
      toast.error("Print failed: " + (e?.message ?? "unknown"));
    }
    setBusy(null);
  };

  const handleShare = async () => {
    setBusy("share");
    try {
      const b64 = await buildBillPdf(account, ownerName);
      if (!b64) { setBusy(null); return; }

      if (Capacitor.isNativePlatform()) {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const { Share } = await import("@capacitor/share");
        const base64Data = b64.replace(/^data:[^;]+;base64,/, "");
        const writeResult = await Filesystem.writeFile({
          path: filename,
          data: base64Data,
          directory: Directory.Cache,
        });
        await Share.share({
          title: `Credit Bill — ${account.full_name}`,
          text: `Hi ${account.full_name}, please find your credit bill attached.`,
          url: writeResult.uri,
          dialogTitle: "Send Bill",
        });
      } else {
        await downloadPdf(filename, b64);
        toast.success("Bill saved");
      }
    } catch (e: any) {
      if (!String(e?.message ?? "").includes("cancel")) {
        toast.error("Share failed: " + (e?.message ?? "unknown"));
      }
    }
    setBusy(null);
    onClose();
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl border border-border shadow-2xl flex flex-col overflow-hidden"
        style={{ background: "var(--gradient-card)", maxHeight: "90dvh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border/40 shrink-0">
          <div className="text-left">
            <h3 className="font-black text-lg leading-tight">Bill — {account.full_name}</h3>
            <p className="text-xs text-muted-foreground">{ownerName}</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center bg-muted hover:bg-muted/80 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable receipt body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0" style={{ scrollbarWidth: "thin" }}>
          {loadingTxs ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : txs.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">No transactions yet</p>
          ) : (
            txs.map((tx) => {
              const isCharge = tx.type === "charge";
              const hasItems = Array.isArray(tx.items) && (tx.items as any[]).length > 0;
              const sessionSubtotal = hasItems
                ? (tx.items as any[]).reduce((s: number, it: any) => s + Number(it.price ?? 0) * Number(it.qty ?? 1), 0)
                : Number(tx.amount);

              return (
                <div
                  key={tx.id}
                  className="rounded-xl border border-border/50 overflow-hidden"
                  style={{ background: isCharge ? "rgba(255,255,255,0.04)" : "rgba(34,197,94,0.06)" }}
                >
                  {/* Session date row */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                      {isCharge ? "Charge" : "Payment"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{fmtDate(tx.created_at)}</span>
                  </div>

                  <div className="px-3 py-2 space-y-1">
                    {isCharge && hasItems ? (
                      <>
                        {/* Item rows */}
                        {(tx.items as any[]).map((it: any, i: number) => {
                          const qty = Number(it.qty ?? 1);
                          const price = Number(it.price ?? 0);
                          const lineTotal = qty * price;
                          return (
                            <div key={i} className="flex items-center justify-between gap-2">
                              <span className="text-xs text-foreground flex-1 leading-snug">
                                {qty > 1 && <span className="font-black text-primary mr-1">{qty}x</span>}
                                {it.name}
                              </span>
                              <span className="text-xs font-black shrink-0" style={{ color: "var(--primary)" }}>
                                ${lineTotal.toFixed(2)}
                              </span>
                            </div>
                          );
                        })}
                        {/* Subtotal */}
                        <div className="flex items-center justify-between pt-1 border-t border-border/30 mt-1">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase">Subtotal</span>
                          <span className="text-xs font-black text-foreground">${sessionSubtotal.toFixed(2)}</span>
                        </div>
                      </>
                    ) : isCharge ? (
                      /* Fallback: note-only charge (legacy) */
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-foreground flex-1 leading-snug">
                          {tx.note ? tx.note.replace(/^\[CASH\]\s*/, "") : "Charge"}
                        </span>
                        <span className="text-xs font-black" style={{ color: "var(--primary)" }}>
                          ${Number(tx.amount).toFixed(2)}
                        </span>
                      </div>
                    ) : (
                      /* Payment row */
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-green-400">Payment received</span>
                        <span className="text-xs font-black text-green-400">
                          −${Number(tx.amount).toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Balance owed — pinned above buttons */}
        <div className="shrink-0 mx-4 mb-3 rounded-xl px-4 py-3 flex items-center justify-between border" style={{ background: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.3)" }}>
          <span className="text-sm font-black text-red-400 uppercase tracking-wide">Balance Owed</span>
          <span className="text-2xl font-black text-red-400">${Number(account.balance_owed).toFixed(2)}</span>
        </div>

        {/* Action buttons */}
        <div className="shrink-0 px-4 pb-5 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handlePrintThermal}
              disabled={!!busy}
              className="h-14 rounded-2xl font-black text-sm flex flex-col items-center justify-center gap-1 transition active:scale-95 disabled:opacity-50 text-white shadow-lg"
              style={{ background: "var(--gradient-hero)" }}
            >
              {busy === "print" ? <Loader2 className="h-5 w-5 animate-spin" /> : printed ? <CheckCircle2 className="h-5 w-5" /> : <span className="text-lg leading-none">🖨️</span>}
              <span className="text-[11px] font-black">{printed ? "Printed!" : "Print (Thermal)"}</span>
            </button>
            <button
              onClick={handleDownload}
              disabled={!!busy}
              className="h-14 rounded-2xl font-black text-sm flex flex-col items-center justify-center gap-1 transition active:scale-95 disabled:opacity-50 text-foreground border border-border/80"
              style={{ background: "rgba(255,255,255,0.06)" }}
            >
              {busy === "download" ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : downloaded ? <CheckCircle2 className="h-5 w-5 text-green-400" /> : <FileDown className="h-5 w-5 text-primary" />}
              <span className="text-[11px] font-black">{downloaded ? "Downloaded!" : "Download PDF"}</span>
            </button>
          </div>
          <button
            onClick={handleShare}
            disabled={!!busy}
            className="w-full h-11 rounded-2xl font-black text-xs flex items-center justify-center gap-2 transition active:scale-95 disabled:opacity-50 border border-green-500/40"
            style={{ background: "rgba(37,211,102,0.12)", color: "#25D366" }}
          >
            {busy === "share" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            Share via WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
function CreditPage() {
  const { profile } = useAuth();
  const { effectiveOwnerId } = useChain();
  const { t } = useTranslation();
  const rawOwnerId = profile?.role === "owner" ? profile.id : profile?.parent_id;
  const ownerId = profile?.role === "owner" ? effectiveOwnerId(profile.id) : rawOwnerId;
  const ownerName = profile?.username ?? "Store";
  const ownerIdRef = useRef(ownerId);
  useEffect(() => { ownerIdRef.current = ownerId; }, [ownerId]);

  const [tab, setTab] = useState<"credit" | "cleared" | "create">("credit");
  const [opened, setOpened] = useState<CreditAccount[]>([]);
  const [closed, setClosed] = useState<CreditAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Payment card state
  const [payAccount, setPayAccount] = useState<CreditAccount | null>(null);
  // Edit customer modal state
  const [editAccount, setEditAccount] = useState<CreditAccount | null>(null);
  // Bill action modal state
  const [billAccount, setBillAccount] = useState<CreditAccount | null>(null);

  const fetchAccounts = useCallback(async () => {
    const id = ownerIdRef.current;
    if (!id) return;
    setLoading(true);
    const { data } = await supabase
      .from("credit_accounts")
      .select("*")
      .eq("owner_id", id)
      .order("updated_at", { ascending: false });
    const all = (data ?? []) as CreditAccount[];
    setOpened(all.filter((a) => Number(a.balance_owed) > 0).sort((a, b) => a.full_name.localeCompare(b.full_name)));
    setClosed(all.filter((a) => Number(a.balance_owed) <= 0).sort((a, b) => a.full_name.localeCompare(b.full_name)));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ownerId) return;
    fetchAccounts();
  }, [ownerId, fetchAccounts]);

  // Realtime — refresh when credit_accounts or credit_transactions change
  useEffect(() => {
    if (!ownerId) return;
    const ch = supabase
      .channel(`credit-page-${ownerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_accounts", filter: `owner_id=eq.${ownerId}` }, () => fetchAccounts())
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_transactions", filter: `owner_id=eq.${ownerId}` }, () => fetchAccounts())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ownerId, fetchAccounts]);

  const handleCreated = (account: CreditAccount) => {
    setClosed((prev) => [account, ...prev]);
    setTab("cleared");
  };

  const handlePaymentDone = () => {
    setPayAccount(null);
    fetchAccounts();
  };

  return (
    <div className="py-3 space-y-4">
      <h1 className="text-2xl font-black">Customers</h1>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-2xl p-1" style={{ background: "var(--gradient-card)" }}>
        {(["credit", "cleared", ...(profile?.role !== "manager" && profile?.job_title !== "manager" ? ["create"] : [])] as ("credit" | "cleared" | "create")[]).map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-black capitalize transition ${
              tab === tabKey
                ? "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={tab === tabKey ? { background: "var(--gradient-hero)" } : {}}
          >
            {tabKey === "credit" ? `Abiertos${opened.length ? ` (${opened.length})` : ""}` : tabKey === "cleared" ? "Cerrados" : "Crear"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "credit" && (
        <OpenedTab
          accounts={opened}
          loading={loading}
          ownerName={ownerName}
          onSelect={setPayAccount}
          onEdit={setEditAccount}
          onBill={setBillAccount}
        />
      )}
      {tab === "cleared" && (
        <ClosedTab accounts={closed} loading={loading} ownerName={ownerName} onEdit={setEditAccount} onBill={setBillAccount} ownerId={ownerId!} />
      )}
      {tab === "create" && (
        <CreateTab ownerId={ownerId!} onCreated={handleCreated} />
      )}

      {/* Payment overlay */}
      {payAccount && (
        <PaymentOverlay
          account={payAccount}
          ownerId={ownerId!}
          onClose={() => setPayAccount(null)}
          onDone={handlePaymentDone}
        />
      )}

      {/* Bill action modal */}
      {billAccount && (
        <BillModal
          account={billAccount}
          ownerName={ownerName}
          onClose={() => setBillAccount(null)}
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
function OpenedTab({
  accounts, loading, ownerName, onSelect, onEdit, onBill,
}: {
  accounts: CreditAccount[];
  loading: boolean;
  ownerName: string;
  onSelect: (a: CreditAccount) => void;
  onEdit: (a: CreditAccount) => void;
  onBill: (a: CreditAccount) => void;
}) {
  const [printing, setPrinting] = useState<string | null>(null);
  const [printed, setPrinted] = useState<string | null>(null);

  if (loading) return <Spinner />;
  if (accounts.length === 0)
    return (
      <div className="text-center py-16 text-muted-foreground">
        <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-semibold">No hay cuentas abiertas</p>
      </div>
    );

  return (
    <div className="space-y-2">
      {accounts.map((a) => (
        <div
          key={a.id}
          className="w-full rounded-2xl border border-border text-left overflow-hidden"
          style={{ background: "var(--gradient-card)" }}
        >
          {/* Card header — name info */}
          <div className="px-4 pt-3 pb-2 border-b border-border/40">
            <button className="w-full text-left active:scale-[0.98] transition" onClick={() => onSelect(a)}>
              <p className="font-black text-base truncate">{a.full_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{new Date(a.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
              {a.contact_number && <p className="text-xs text-muted-foreground mt-0.5">{a.contact_number}</p>}
              {a.id_number && <p className="text-xs text-muted-foreground mt-0.5">{a.id_number}</p>}
            </button>
          </div>

          {/* Footer row — balance on left, Bill + Edit stacked on right */}
          <div className="flex items-center justify-between px-4 py-2.5">
            <button className="flex items-center gap-1.5 active:scale-95 transition" onClick={() => onSelect(a)}>
              <span className="text-lg font-black text-red-400">${Number(a.balance_owed).toFixed(2)}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onBill(a)}
                className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 active:scale-90 transition"
                style={{ background: "rgba(251,146,60,0.15)", border: "1px solid rgba(251,146,60,0.35)" }}
                title="Bill / Print Options"
              >
                <FileDown className="h-4 w-4" style={{ color: "var(--primary)" }} />
              </button>
              <button
                onClick={() => onEdit(a)}
                className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 active:scale-90 transition"
                style={{ background: "rgba(251,146,60,0.15)", border: "1px solid rgba(251,146,60,0.35)" }}
                title="Edit customer"
              >
                <Pencil className="h-4 w-4" style={{ color: "var(--primary)" }} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Closed Tab ─────────────────────────────────────────────────────────────────
function ClosedTab({ accounts, loading, ownerName, onEdit, onBill, ownerId }: { accounts: CreditAccount[]; loading: boolean; ownerName: string; onEdit: (a: CreditAccount) => void; onBill: (a: CreditAccount) => void; ownerId: string }) {
  const [printing, setPrinting] = useState<string | null>(null);
  const [printed, setPrinted] = useState<string | null>(null);
  // Track which accounts have cash purchase records (charge txs with "[CASH]" note)
  const [cashAccounts, setCashAccounts] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!ownerId || accounts.length === 0) return;
    supabase
      .from("credit_transactions")
      .select("credit_account_id, note")
      .eq("owner_id", ownerId)
      .eq("type", "charge")
      .then(({ data }) => {
        const ids = new Set<string>(
          (data ?? [])
            .filter((tx: { credit_account_id: string; note: string | null }) => tx.note?.startsWith("[CASH]"))
            .map((tx: { credit_account_id: string }) => tx.credit_account_id)
        );
        setCashAccounts(ids);
      });
  }, [ownerId, accounts]);

  if (loading) return <Spinner />;
  if (accounts.length === 0)
    return (
      <div className="text-center py-16 text-muted-foreground">
        <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-semibold">Sin clientes pagados aún</p>
      </div>
    );

  return (
    <div className="space-y-2">
      {accounts.map((a) => {
        const hasCashPurchase = cashAccounts.has(a.id);
        return (
        <div
          key={a.id}
          className="rounded-2xl border border-border overflow-hidden"
          style={{ background: "var(--gradient-card)" }}
        >
          {/* Card header — name + edit pencil button */}
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border/40">
            <div className="flex-1 min-w-0">
              <p className="font-black text-base truncate">{a.full_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{new Date(a.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
              {a.contact_number && <p className="text-xs text-muted-foreground mt-0.5">{a.contact_number}</p>}
              {a.id_number && <p className="text-xs text-muted-foreground mt-0.5">{a.id_number}</p>}
            </div>
            <button
              onClick={() => onEdit(a)}
              className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ml-2 active:scale-90 transition"
              style={{ background: "rgba(251,146,60,0.15)", border: "1px solid rgba(251,146,60,0.35)" }}
              title="Edit customer"
            >
              <Pencil className="h-4 w-4" style={{ color: "var(--primary)" }} />
            </button>
          </div>

          {/* Footer row — cleared badge + conditional Bill + Edit */}
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-xs font-bold text-green-500 px-2 py-1 rounded-lg bg-green-500/10">Pagado</span>
            <div className="flex items-center gap-2">
              {hasCashPurchase && (
                <button
                  onClick={() => onBill(a)}
                  className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 active:scale-90 transition"
                  style={{ background: "rgba(251,146,60,0.15)", border: "1px solid rgba(251,146,60,0.35)" }}
                  title="Bill / Print Options"
                >
                  <FileDown className="h-4 w-4" style={{ color: "var(--primary)" }} />
                </button>
              )}
              <button
                onClick={() => onEdit(a)}
                className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 active:scale-90 transition"
                style={{ background: "rgba(251,146,60,0.15)", border: "1px solid rgba(251,146,60,0.35)" }}
                title="Edit customer"
              >
                <Pencil className="h-4 w-4" style={{ color: "var(--primary)" }} />
              </button>
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}

// ── Edit Customer Modal ────────────────────────────────────────────────────────
function EditCustomerModal({
  account,
  onClose,
  onSaved,
}: {
  account: CreditAccount;
  onClose: () => void;
  onSaved: (updated: CreditAccount) => void;
}) {
  // Parse existing data back to form fields
  const parseContact = (c: string | null) => {
    if (!c) return "";
    // Strip "868-" prefix
    const stripped = c.replace(/^868-?/, "");
    return stripped;
  };
  const parseIdType = (n: string | null): "drivers_permit" | "national_id" => {
    if (!n) return "national_id";
    return n.startsWith("DP:") ? "drivers_permit" : "national_id";
  };
  const parseIdNumber = (n: string | null) => {
    if (!n) return "";
    // Strip "DP: " or "NID: " prefix
    return n.replace(/^(DP|NID):\s*/, "");
  };

  const [name, setName] = useState(account.full_name);
  const [contact, setContact] = useState(parseContact(account.contact_number));
  const [idType, setIdType] = useState<"drivers_permit" | "national_id">(parseIdType(account.id_number));
  const [idNumber, setIdNumber] = useState(parseIdNumber(account.id_number));
  const [busy, setBusy] = useState(false);
  const [activeField, setActiveField] = useState<null | "idNumber" | "contact">(null);

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
      <div
        className="w-full max-w-md rounded-3xl border border-border shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        style={{ background: "var(--gradient-card)" }}
      >
        {/* Header */}
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
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-full flex items-center justify-center bg-muted hover:bg-muted/80 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-5 overflow-y-auto flex-1">
          <form onSubmit={submit} className="space-y-3">
            {/* Full Name */}
            <div>
              <Label htmlFor="edit-credit-name">Full Name *</Label>
              <Input
                id="edit-credit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. John Smith"
                required
                className="mt-1"
                style={{ background: "#ffffff", color: "#000000" }}
              />
            </div>

            {/* ID Type */}
            <div>
              <Label htmlFor="edit-credit-idtype">ID Type</Label>
              <select
                id="edit-credit-idtype"
                value={idType}
                onChange={(e) => setIdType(e.target.value as "drivers_permit" | "national_id")}
                className="w-full h-10 rounded-md border border-input px-3 text-sm font-semibold mt-1"
                style={{ background: "#ffffff", color: "#000000" }}
              >
                <option value="drivers_permit">Driver's Permit</option>
                <option value="national_id">National ID</option>
              </select>
            </div>

            {/* ID Number — tap to open numpad */}
            <div>
              <Label>ID Number</Label>
              <button type="button" onClick={() => setActiveField(f => f === "idNumber" ? null : "idNumber")}
                className="w-full h-10 rounded-md border border-input px-3 text-sm text-left mt-1 font-semibold"
                style={{ background: "#ffffff", color: idNumber ? "#000000" : "#9ca3af" }}>
                {idNumber || "e.g. 00000000"}
              </button>
              {activeField === "idNumber" && (
                <CreditNumPad value={idNumber} onChange={setIdNumber} maxLen={20} onDone={() => setActiveField(null)} />
              )}
            </div>

            {/* Contact Number — tap to open numpad */}
            <div>
              <Label>Contact Number</Label>
              <div className="flex items-center gap-0 mt-1">
                <span className="h-10 px-3 flex items-center rounded-l-md border border-r-0 border-input bg-muted text-sm font-bold text-muted-foreground select-none">868</span>
                <button type="button" onClick={() => setActiveField(f => f === "contact" ? null : "contact")}
                  className="flex-1 h-10 rounded-r-md border border-input px-3 text-sm text-left font-semibold"
                  style={{ background: "#ffffff", color: contact ? "#000000" : "#9ca3af" }}>
                  {contact || "XXX-XXXX"}
                </button>
              </div>
              {activeField === "contact" && (
                <CreditContactPad value={contact} onChange={setContact} onDone={() => setActiveField(null)} />
              )}
            </div>

            <Button
              type="submit"
              disabled={busy || !name.trim()}
              className="w-full h-12 font-black text-base"
              style={{ background: "var(--gradient-hero)", color: "var(--primary-foreground)" }}
            >
              {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : "Save Changes"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Create Tab ─────────────────────────────────────────────────────────────────
function CreateTab({
  ownerId,
  onCreated,
}: {
  ownerId: string;
  onCreated: (a: CreditAccount) => void;
}) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [idType, setIdType] = useState<"drivers_permit" | "national_id">("national_id");
  const [idNumber, setIdNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [activeField, setActiveField] = useState<null | "idNumber" | "contact">(null);
  const toggle = (f: "idNumber" | "contact") => setActiveField(cur => cur === f ? null : f);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
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
    setName("");
    setContact("");
    setIdNumber("");
    setIdType("national_id");
    setActiveField(null);
  };

  return (
    <div
      className="rounded-2xl p-5 space-y-4"
      style={{ background: "var(--gradient-card)" }}
    >
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
        <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/30 text-sm text-green-400 font-semibold">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Customer created. View in Closed tab.
        </div>
      )}

      <form onSubmit={submit} className="space-y-3">
        {/* Full Name */}
        <div>
          <Label htmlFor="credit-name">Full Name *</Label>
          <Input
            id="credit-name"
            value={name}
            onChange={(e) => { setName(e.target.value); setDone(false); }}
            placeholder="e.g. John Smith"
            required
            className="mt-1"
            style={{ background: "#ffffff", color: "#000000" }}
          />
        </div>

        {/* ID Type */}
        <div>
          <Label htmlFor="credit-idtype">ID Type</Label>
          <select
            id="credit-idtype"
            value={idType}
            onChange={(e) => setIdType(e.target.value as "drivers_permit" | "national_id")}
            className="w-full h-10 rounded-md border border-input px-3 text-sm font-semibold mt-1"
            style={{ background: "#ffffff", color: "#000000" }}
          >
            <option value="drivers_permit">Driver's Permit</option>
            <option value="national_id">National ID</option>
          </select>
        </div>

        {/* ID Number — tap to open numpad */}
        <div>
          <Label>ID Number</Label>
          <button type="button" onClick={() => toggle("idNumber")}
            className="w-full h-10 rounded-md border border-input px-3 text-sm text-left mt-1 font-semibold"
            style={{ background: "#ffffff", color: idNumber ? "#000000" : "#9ca3af" }}>
            {idNumber || "e.g. 00000000"}
          </button>
          {activeField === "idNumber" && (
            <CreditNumPad value={idNumber} onChange={setIdNumber} maxLen={20} onDone={() => setActiveField(null)} />
          )}
        </div>

        {/* Contact Number — tap to open numpad */}
        <div>
          <Label>Contact Number</Label>
          <div className="flex items-center gap-0 mt-1">
            <span className="h-10 px-3 flex items-center rounded-l-md border border-r-0 border-input bg-muted text-sm font-bold text-muted-foreground select-none">868</span>
            <button type="button" onClick={() => toggle("contact")}
              className="flex-1 h-10 rounded-r-md border border-input px-3 text-sm text-left font-semibold"
              style={{ background: "#ffffff", color: contact ? "#000000" : "#9ca3af" }}>
              {contact || "XXX-XXXX"}
            </button>
          </div>
          {contact.replace("-", "").length > 0 && contact.replace("-", "").length < 7 && (
            <p className="text-xs font-semibold text-amber-400 mt-1">
              {7 - contact.replace("-", "").length} more digit{7 - contact.replace("-", "").length !== 1 ? "s" : ""} needed
            </p>
          )}
          {activeField === "contact" && (
            <CreditContactPad value={contact} onChange={setContact} onDone={() => setActiveField(null)} />
          )}
        </div>

        <Button
          type="submit"
          disabled={busy || !name.trim() || (contact.replace("-", "").length > 0 && contact.replace("-", "").length < 7)}
          className="w-full h-12 font-black text-base"
          style={{ background: "var(--gradient-hero)", color: "var(--primary-foreground)" }}
        >
          {busy ? "Creating…" : "Create Account"}
        </Button>
      </form>
    </div>
  );
}

// ── Payment Overlay ────────────────────────────────────────────────────────────
function PaymentOverlay({
  account,
  ownerId,
  onClose,
  onDone,
}: {
  account: CreditAccount;
  ownerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { profile } = useAuth();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printed, setPrinted] = useState(false);
  const [charges, setCharges] = useState<{ id: string; amount: number; items: { id: string; name: string; qty: number; price?: number; cost_price?: number }[] | null; created_at: string; cashier_id: string | null }[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const ownerName = profile?.username ?? "Store";
  const amountNum = parseFloat(amount) || 0;
  const owed = Number(account.balance_owed);
  const tooMuch = amountNum > owed;
  const valid = amountNum > 0 && !tooMuch;

  const loadCharges = useCallback(async () => {
    const { data } = await supabase
      .from("credit_transactions")
      .select("id, amount, items, created_at, cashier_id")
      .eq("credit_account_id", account.id)
      .eq("type", "charge")
      .order("created_at", { ascending: false });
    setCharges((data ?? []) as any);
  }, [account.id]);

  useEffect(() => { loadCharges(); }, [loadCharges]);

  // Realtime — refresh charge list when credit_transactions change for this account
  useEffect(() => {
    const ch = supabase
      .channel(`credit-charges-${account.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_transactions", filter: `credit_account_id=eq.${account.id}` }, () => loadCharges())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [account.id, loadCharges]);

  const deleteCharge = async (chargeId: string) => {
    if (!profile) return;
    const ownerId = profile.role === "owner" ? profile.id : (profile as any).parent_id;
    setDeletingId(chargeId);

    // Read charge timestamp BEFORE deleting so we can match wallet rows
    const { data: chargeTx } = await supabase
      .from("credit_transactions")
      .select("created_at")
      .eq("id", chargeId)
      .single();

    const { error } = await (supabase.rpc as any)("delete_credit_charge", {
      p_credit_tx_id: chargeId,
      p_cashier_id: profile.id,
    });
    setDeletingId(null);
    if (error) { toast.error(error.message); return; }

    // Call SECURITY DEFINER RPC to delete both owner + cashier wallet rows
    if (chargeTx?.created_at && ownerId) {
      const t = new Date(chargeTx.created_at);
      await (supabase.rpc as any)("delete_credit_charge_wallet_rows", {
        p_owner_id:   ownerId,
        p_cashier_id: profile.id,
        p_from_time:  new Date(t.getTime() - 5000).toISOString(),
        p_to_time:    new Date(t.getTime() + 5000).toISOString(),
      });
    }

    toast.success("Charge removed — stock restored");
    await loadCharges();
    onDone();
  };

  const submit = async () => {
    if (!valid || !profile) return;
    setBusy(true);
    const { error } = await supabase.rpc("record_credit_payment", {
      p_credit_account_id: account.id,
      p_cashier_id: profile.id,
      p_amount: amountNum,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (amountNum >= owed) {
      toast.success(`${account.full_name}'s tab is fully settled!`);
    } else {
      toast.success(`Payment of $${amountNum.toFixed(2)} recorded`);
    }
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        className="w-full max-w-md rounded-3xl border border-border shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        style={{ background: "var(--gradient-card)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
          <div>
            <h2 className="text-xl font-black">{account.full_name}</h2>
            <p className="text-sm text-muted-foreground">Record payment toward balance</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => { setPrinting(true); await printBill(account, ownerName, profile?.username || "Staff"); setPrinting(false); setPrinted(true); setTimeout(() => setPrinted(false), 5000); }}
              disabled={printing}
              className="flex items-center gap-1.5 px-3 h-9 rounded-xl font-bold text-xs transition active:scale-95 disabled:opacity-50"
              style={printed ? { background: "#16a34a", color: "#fff", border: "1px solid #16a34a" } : { background: "rgba(251,146,60,0.15)", color: "var(--primary)", border: "1px solid rgba(251,146,60,0.3)" }}
            >
              {printing
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : printed
                ? <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                : <FileDown className="h-3.5 w-3.5" />}
              {printed ? "Done" : "Bill"}
            </button>
            <button
              onClick={onClose}
              className="h-9 w-9 rounded-full flex items-center justify-center bg-muted hover:bg-muted/80 transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-5 space-y-4 overflow-y-auto flex-1">
          {/* Balance owed */}
          <div
            className="rounded-2xl p-4 text-center"
            style={{ background: "var(--gradient-hero)" }}
          >
            <p className="text-xs font-semibold text-primary-foreground/70 uppercase tracking-widest">Balance Owed</p>
            <p className="text-4xl font-black text-primary-foreground">${owed.toFixed(2)}</p>
          </div>

          {/* Charge history with delete */}
          {charges.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-black text-muted-foreground uppercase tracking-wider">Charges</p>
              {charges.map((c) => {
                const itemsArr = Array.isArray(c.items) ? c.items : [];
                const isNewest = c.id === charges[0].id;
                // Per-charge totals for cost/profit (only if cost_price stored)
                const hasCostData = itemsArr.some((i: any) => (i.cost_price ?? 0) > 0);
                const chargeCost   = itemsArr.reduce((s: number, i: any) => s + (i.cost_price ?? 0) * (i.qty ?? 1), 0);
                const chargeProfit = Number(c.amount) - chargeCost;
                return (
                  <div key={c.id} className="rounded-xl border border-border overflow-hidden"
                    style={{ background: "oklch(0.20 0.04 45 / 0.30)" }}>
                    {/* Charge header row */}
                    <div className="flex items-start gap-2 px-3 pt-2.5 pb-1.5">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-muted-foreground">
                          {new Date(c.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-sm font-black" style={{ color: "var(--primary)" }}>+${Number(c.amount).toFixed(2)}</span>
                          {hasCostData && (
                            <>
                              <span className="text-xs text-muted-foreground">cost ${chargeCost.toFixed(2)}</span>
                              <span className="text-xs font-bold" style={{ color: chargeProfit >= 0 ? "#86efac" : "#f87171" }}>
                                profit ${chargeProfit.toFixed(2)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {isNewest && (
                        <button
                          onClick={() => deleteCharge(c.id)}
                          disabled={!!deletingId}
                          className="h-8 w-8 rounded-full flex items-center justify-center bg-red-600 active:scale-95 transition shrink-0 disabled:opacity-50 mt-0.5"
                        >
                          {deletingId === c.id
                            ? <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5 text-white" />}
                        </button>
                      )}
                    </div>
                    {/* Per-item rows */}
                    {itemsArr.length > 0 && (
                      <div className="border-t border-border/40 px-3 pb-2 pt-1.5 space-y-1">
                        {/* Header labels */}
                        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[10px] font-black text-muted-foreground uppercase tracking-wide mb-1">
                          <span>Item</span>
                          <span className="text-right">SP</span>
                          <span className="text-right">CP</span>
                          <span className="text-right">Profit</span>
                        </div>
                        {itemsArr.map((it: any, idx: number) => {
                          const sp     = Number(it.price ?? 0) * (it.qty ?? 1);
                          const cp     = Number(it.cost_price ?? 0) * (it.qty ?? 1);
                          const profit = sp - cp;
                          const hasCP  = (it.cost_price ?? 0) > 0;
                          return (
                            <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-baseline">
                              <span className="text-xs text-foreground font-semibold truncate">
                                {it.qty > 1 ? `${it.qty}× ` : ""}{it.name}
                              </span>
                              <span className="text-xs font-black text-right" style={{ color: "var(--primary)" }}>
                                ${sp.toFixed(2)}
                              </span>
                              <span className="text-xs text-right text-muted-foreground">
                                {hasCP ? `$${cp.toFixed(2)}` : "—"}
                              </span>
                              <span className="text-xs font-bold text-right" style={{ color: hasCP ? (profit >= 0 ? "#86efac" : "#f87171") : "var(--muted-foreground)" }}>
                                {hasCP ? `$${profit.toFixed(2)}` : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Amount input */}
          <div>
            <Label htmlFor="pay-amount">Amount Paying</Label>
            <div className="relative mt-1">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="pay-amount"
                type="number"
                min="0.01"
                step="0.01"
                className="pl-8 text-xl font-black h-14"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            {tooMuch && (
              <p className="text-destructive text-sm font-semibold mt-1.5">
                Cannot exceed balance owed (${owed.toFixed(2)})
              </p>
            )}
            {valid && amountNum < owed && (
              <p className="text-muted-foreground text-xs mt-1.5">
                Remaining after payment: ${(owed - amountNum).toFixed(2)}
              </p>
            )}
            {valid && amountNum >= owed && (
              <p className="text-green-500 text-sm font-semibold mt-1.5 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> Fully settles this account
              </p>
            )}
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 h-12" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="flex-1 h-12 font-black text-base"
              disabled={!valid || busy}
              onClick={submit}
              style={{ background: "var(--gradient-hero)", color: "var(--primary-foreground)" }}
            >
              {busy ? "Saving…" : "Confirm Payment"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="h-7 w-7 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

// ── Credit Numpads ─────────────────────────────────────────────────────────────
function CreditNumPad({ value, onChange, maxLen = 20, onDone }: {
  value: string; onChange: (v: string) => void; maxLen?: number; onDone: () => void;
}) {
  return (
    <div className="mt-2">
      <div className="grid grid-cols-3 gap-1.5">
        {["1","2","3","4","5","6","7","8","9","done","0","⌫"].map((k, i) =>
          k === "done"
            ? <button key="done" type="button" onClick={onDone}
                className="h-12 rounded-xl font-black text-sm active:scale-95 transition text-primary-foreground"
                style={{ background: "var(--gradient-hero)" }}>Done</button>
            : <button key={k} type="button"
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

function CreditContactPad({ value, onChange, onDone }: {
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
  return (
    <div className="mt-2">
      {!complete && (
        <p className="text-xs font-semibold text-amber-400 mb-1.5 text-center">
          {7 - digits.length} digit{7 - digits.length !== 1 ? "s" : ""} remaining
        </p>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        {["1","2","3","4","5","6","7","8","9","done","0","⌫"].map((k) =>
          k === "done"
            ? <button key="done" type="button"
                onClick={() => { if (complete) onDone(); }}
                className={`h-12 rounded-xl font-black text-sm transition text-primary-foreground ${complete ? "active:scale-95" : "opacity-30 cursor-not-allowed"}`}
                style={{ background: "var(--gradient-hero)" }}>Done</button>
            : <button key={k} type="button" onClick={() => handle(k)}
                className={`h-12 rounded-xl font-black text-xl transition active:scale-95 ${k === "⌫" ? "bg-destructive/20 text-destructive" : "bg-muted text-foreground"}`}
              >{k}</button>
        )}
      </div>
    </div>
  );
}

// ── Export types for use in register ──────────────────────────────────────────
export type { CreditAccount };
