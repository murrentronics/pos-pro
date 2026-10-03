import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Loader2, Printer, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { downloadPdf } from "@/lib/download";
import { listSupplierNames } from "@/lib/suppliers";
import { brandReceipt } from "@/lib/receiptSettings";
import {
  printReceipt,
  isPrinterPaired,
  pairPrinter,
  clearPrinterPairing,
  openPrinterConnectDialog,
  type ReceiptData,
} from "@/lib/receiptPrinter";

export type SupplierExpense = {
  id: string;
  amount: number;
  description: string | null;
  created_at: string;
  supplier_name?: string | null;
  is_paid?: boolean | null;
};

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function SupplierBills({
  ownerId,
  expenses,
  onMarkPaid,
}: {
  ownerId: string;
  expenses: SupplierExpense[];
  onMarkPaid: (e: SupplierExpense) => void;
}) {
  const { profile } = useAuth();
  const topRef = useRef<HTMLDivElement>(null);
  const [directory, setDirectory] = useState<string[]>([]);
  const [openSupplier, setOpenSupplier] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [showPrint, setShowPrint] = useState(false);
  const PAGE_SIZE = 50;

  useEffect(() => {
    if (!ownerId) return;
    listSupplierNames(ownerId).then(setDirectory);
  }, [ownerId, expenses]);

  const fromExpenses = expenses.map((e) => (e.supplier_name ?? "").trim()).filter(Boolean);
  const names = [...new Set([...directory, ...fromExpenses])].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  const supplierExpenses = openSupplier
    ? expenses.filter((e) => (e.supplier_name ?? "").trim().toLowerCase() === openSupplier.trim().toLowerCase())
    : [];

  const records = supplierExpenses.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const spent = records.reduce((s, e) => s + Number(e.amount), 0);
  const owed = Math.max(
    0,
    records.reduce((s, e) => (e.is_paid === false ? s + Number(e.amount) : s), 0),
  );
  const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const visible = records.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const goPage = (next: number) => {
    setPage(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const whenOf = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
      timeZone: "America/Port_of_Spain",
    });

  const statementRows = records.map((e) => ({
    when: whenOf(e.created_at),
    note: (e.description ?? "").split("\n").filter((line) => !line.startsWith("Supplier:")).join(" ").slice(0, 48),
    amount: Number(e.amount),
    paid: e.is_paid !== false,
    reverted: (e.description ?? "").startsWith("Reverted Stock Expense"),
  }));

  return (
    <div ref={topRef} className="space-y-2">
      {names.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">No suppliers yet.</p>
      ) : (
        names.map((name) => {
          const bills = expenses.filter(
            (e) => (e.supplier_name ?? "").trim().toLowerCase() === name.toLowerCase(),
          );
          const nameOwed = Math.max(
            0,
            bills.reduce((s, e) => (e.is_paid === false ? s + Number(e.amount) : s), 0),
          );
          const open = openSupplier?.toLowerCase() === name.toLowerCase();
          return (
            <div key={name} className="rounded-2xl border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setShowPrint(false);
                  setPage(0);
                  setOpenSupplier((cur) => (cur?.toLowerCase() === name.toLowerCase() ? null : name));
                }}
                className="w-full px-4 py-3 flex items-center justify-between text-left"
              >
                <span className="font-black text-sm">{name}</span>
                <span className={`text-xs font-black ${nameOwed > 0 ? "text-red-700" : "text-green-700"}`}>
                  {nameOwed > 0 ? `$${fmt(nameOwed)} owed` : "Paid up"}
                </span>
              </button>
              {open && (
                <div className="border-t border-border px-4 py-3 space-y-3">
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => setShowPrint(true)}
                      disabled={records.length === 0}
                      className="h-8 px-3 rounded-xl text-[11px] font-black uppercase flex items-center gap-1 disabled:opacity-40"
                      style={{ background: "var(--gradient-hero)", color: "var(--primary-foreground)" }}
                    >
                      <Printer className="h-3.5 w-3.5" /> Print
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-muted px-3 py-2">
                      <p className="text-[10px] font-black uppercase text-muted-foreground">Total spent</p>
                      <p className="text-lg font-black">${fmt(spent)}</p>
                    </div>
                    <div className="rounded-xl bg-muted px-3 py-2">
                      <p className="text-[10px] font-black uppercase text-muted-foreground">Total owed</p>
                      <p className="text-lg font-black text-red-700">${fmt(owed)}</p>
                    </div>
                  </div>
                  {records.length === 0 ? (
                    <p className="text-center text-sm text-muted-foreground py-4">No purchases for this supplier yet.</p>
                  ) : (
                    <div className="rounded-2xl border border-border divide-y divide-border/50">
                      {visible.map((e) => {
                        const reverted = (e.description ?? "").startsWith("Reverted Stock Expense");
                        const unpaid = e.is_paid === false && !reverted;
                        return (
                          <div key={e.id} className="px-4 py-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs text-muted-foreground">{whenOf(e.created_at)}</div>
                              <div className="text-sm font-black">${fmt(Number(e.amount))}</div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`h-8 px-3 rounded-xl text-[11px] font-black uppercase flex items-center ${reverted ? "bg-muted text-muted-foreground" : unpaid ? "bg-red-500/15 text-red-700" : "bg-green-500/15 text-green-700"}`}>
                                {reverted ? "Revert" : unpaid ? "Unpaid" : "Paid"}
                              </span>
                              {unpaid && Number(e.amount) > 0 && (
                                <button
                                  type="button"
                                  onClick={() => onMarkPaid(e)}
                                  className="h-8 px-3 rounded-xl text-[11px] font-black uppercase"
                                  style={{ background: "var(--gradient-hero)", color: "var(--primary-foreground)" }}
                                >
                                  Mark paid
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {records.length > PAGE_SIZE && (
                    <div className="flex items-center justify-between">
                      <button type="button" disabled={safePage === 0} onClick={() => goPage(safePage - 1)} className="h-9 px-3 rounded-xl text-xs font-black bg-muted disabled:opacity-40">Prev</button>
                      <span className="text-xs font-bold text-muted-foreground">{safePage + 1} / {pages}</span>
                      <button type="button" disabled={safePage >= pages - 1} onClick={() => goPage(safePage + 1)} className="h-9 px-3 rounded-xl text-xs font-black bg-muted disabled:opacity-40">Next</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      {showPrint && openSupplier && (
        <SupplierStatementModal
          storeName={profile?.username || "POS Pro"}
          supplier={openSupplier}
          yearLabel="All years"
          spent={spent}
          owed={owed}
          rows={statementRows}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  );
}

function SupplierStatementModal({
  storeName,
  supplier,
  yearLabel,
  spent,
  owed,
  rows,
  onClose,
}: {
  storeName: string;
  supplier: string;
  yearLabel: string;
  spent: number;
  owed: number;
  rows: { when: string; note: string; amount: number; paid: boolean; reverted?: boolean }[];
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"print" | "share" | null>(null);
  const [printerPaired, setPrinterPaired] = useState<boolean | null>(null);
  const [pairing, setPairing] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [brandedName, setBrandedName] = useState(storeName);

  useEffect(() => {
    let cancelled = false;
    brandReceipt({
      storeName,
      items: [],
      subtotal: spent,
      total: spent,
      paid: spent - owed,
      change: 0,
      payMode: "cash",
      supplierStatement: { supplier, spent, owed, rows },
    }).then((next) => {
      if (cancelled) return;
      setLogoUrl(next.logoUrl ?? null);
      if (next.storeName) setBrandedName(next.storeName);
    });
    return () => { cancelled = true; };
  }, [storeName, supplier, spent, owed, rows]);

  useEffect(() => {
    const refresh = () => { isPrinterPaired().then(setPrinterPaired); };
    refresh();
    window.addEventListener("pospro-printer-changed", refresh);
    return () => window.removeEventListener("pospro-printer-changed", refresh);
  }, []);

  const receiptData = (): ReceiptData => ({
    storeName,
    items: [],
    subtotal: spent,
    total: spent,
    paid: spent - owed,
    change: 0,
    payMode: "cash",
    date: new Date().toLocaleString("en-GB", { timeZone: "America/Port_of_Spain" }),
    supplierStatement: { supplier: yearLabel === "All years" ? supplier : `${supplier} · ${yearLabel}`, spent, owed, rows },
  });

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
      const result = await printReceipt(receiptData());
      if (result.error) toast.error(result.error);
      else toast.success("Statement sent to printer");
    } catch (e: unknown) {
      toast.error("Print failed: " + ((e as { message?: string })?.message ?? "unknown"));
    }
    setBusy(null);
  };

  const handleWhatsApp = async () => {
    setBusy("share");
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      let y = 18;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(storeName, 14, y);
      y += 8;
      doc.setFontSize(12);
      doc.text(`Supplier statement — ${supplier}`, 14, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(yearLabel, 14, y);
      y += 8;
      for (const row of rows) {
        if (y > 270) { doc.addPage(); y = 18; }
        doc.text(`${row.when}  ${row.reverted ? "REVERT" : row.paid ? "PAID" : "UNPAID"}  $${row.amount.toFixed(2)}`, 14, y);
        y += 5;
        if (row.note) { doc.text(row.note, 14, y); y += 5; }
      }
      y += 4;
      doc.setFont("helvetica", "bold");
      doc.text(`Total spent: $${spent.toFixed(2)}`, 14, y);
      y += 6;
      doc.text(`Balance owed: $${owed.toFixed(2)}`, 14, y);
      const filename = `supplier-${supplier.replace(/\s+/g, "-").toLowerCase()}.pdf`;
      await downloadPdf(filename, doc.output("datauristring"));
      if (!Capacitor.isNativePlatform()) {
        const text = [
          `${storeName} — ${supplier}`,
          yearLabel,
          ...rows.map((r) => `${r.when} ${r.reverted ? "REVERT" : r.paid ? "PAID" : "UNPAID"} $${r.amount.toFixed(2)}`),
          `Total spent: $${spent.toFixed(2)}`,
          `Balance owed: $${owed.toFixed(2)}`,
        ].join("\n");
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
      }
      toast.success("Opening WhatsApp share");
    } catch (e: unknown) {
      const message = (e as { message?: string })?.message ?? "unknown";
      if (!message.includes("cancel")) toast.error("Share failed: " + message);
    }
    setBusy(null);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-sm rounded-3xl overflow-hidden border border-border shadow-2xl flex flex-col max-h-[90dvh]"
        style={{ background: "var(--gradient-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-2 flex items-center justify-between shrink-0">
          <h2 className="font-black text-lg">Supplier statement</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-full flex items-center justify-center bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-2 overflow-y-auto">
          <div className="bg-white text-zinc-900 rounded-xl p-4 shadow-inner text-left font-mono text-xs leading-tight border border-zinc-300 select-none">
            {logoUrl && <img src={logoUrl} alt="" className="mx-auto mb-1 max-h-16 object-contain" />}
            <div className="text-center font-black text-zinc-950 text-base font-sans tracking-tight uppercase mb-0.5">{brandedName}</div>
            <div className="text-center text-[10px] text-zinc-600">SUPPLIER STATEMENT</div>
            <div className="text-center font-bold text-zinc-800 mt-1">{supplier}</div>
            <div className="text-center text-[10px] text-zinc-600">{yearLabel}</div>
            <div className="border-t border-dashed border-zinc-400 my-2" />
            <div className="space-y-1">
              {rows.map((row, idx) => (
                <div key={idx}>
                  <div className="flex justify-between gap-2">
                    <span className="text-zinc-700">{row.when}</span>
                    <span className="font-bold whitespace-nowrap">${row.amount.toFixed(2)}</span>
                  </div>
                  <div className="text-[10px] text-zinc-500">{row.reverted ? "REVERT" : row.paid ? "PAID" : "UNPAID"}{row.note ? ` · ${row.note}` : ""}</div>
                </div>
              ))}
            </div>
            <div className="border-t border-dashed border-zinc-400 my-2" />
            <div className="flex justify-between font-bold"><span>Total spent</span><span>${spent.toFixed(2)}</span></div>
            <div className="flex justify-between font-bold"><span>Balance owed</span><span>${owed.toFixed(2)}</span></div>
          </div>
        </div>
        <div className="px-5 pb-5 pt-2 flex flex-col gap-2 shrink-0">
          <div className="flex gap-2">
            <button
              onClick={() => void handlePrint()}
              disabled={busy === "print" || pairing}
              className="flex-1 h-12 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition active:scale-95 disabled:opacity-50 text-primary-foreground shadow-lg"
              style={{ background: "var(--gradient-hero)" }}
            >
              {busy === "print" || pairing
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : printerPaired === false ? "Connect Printer" : "Print"}
            </button>
            <button
              onClick={() => void handleWhatsApp()}
              disabled={busy === "share"}
              className="flex-1 h-12 rounded-2xl font-black text-sm border border-border hover:bg-muted/30 transition active:scale-95 text-foreground/80"
            >
              {busy === "share" ? <Loader2 className="h-4 w-4 animate-spin" /> : "WhatsApp"}
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
