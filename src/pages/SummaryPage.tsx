import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useChain } from "@/lib/ChainContext";
import { supabase } from "@/integrations/supabase/client";
import {
  TrendingDown, ShoppingBag, Loader2, Download, CalendarIcon, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { drawHeader, addFootersToAllPages } from "@/lib/pdfHelpers";
import { downloadPdf } from "@/lib/download";
import { CATEGORIES } from "@/lib/categories";
import { useTranslation } from "@/lib/i18n";

// ─── Types ────────────────────────────────────────────────────────────────────
type OrderItem = { id?: string; name: string; qty: number; price: number; units_consumed?: number | null };
type Order = {
  id: string; total: number; paid: number; change_given: number;
  discount_amount?: number | null; original_total?: number | null;
  items: OrderItem[]; created_at: string; cashier_id?: string;
};
type Expense = { id: string; amount: number; description: string | null; expense_date: string; created_at: string };
type ProductCost = { id: string; name: string; cost_price: number; units_per_item: number; category: string | null };
type FilterType = "session" | "week" | "month" | "year" | "period";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const TZ = "America/Port_of_Spain";
function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function toISO(d: Date) { return d.toISOString().slice(0, 10); }
function isoToDate(iso: string) { return new Date(iso + "T00:00:00"); }

function fmtTs(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ })
    + " · " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: TZ });
}

// Convert a local Trinidad YYYY-MM-DD date to a UTC ISO range [start, end]
// Start = midnight Trinidad = 04:00 UTC
// End   = 23:59:59 Trinidad = next day 03:59:59 UTC
function ttDateToUtcRange(localDate: string): { start: string; end: string } {
  // Trinidad is UTC-4 (no DST)
  const [y, m, d] = localDate.split("-").map(Number);
  const startUtc = new Date(Date.UTC(y, m - 1, d, 4, 0, 0, 0));   // 00:00 TT → 04:00 UTC
  const endUtc   = new Date(Date.UTC(y, m - 1, d + 1, 3, 59, 59, 999)); // 23:59:59 TT → next day 03:59:59 UTC
  return { start: startUtc.toISOString(), end: endUtc.toISOString() };
}

// Convert fromDate..toDate (both local Trinidad) to a UTC range
function ttRangeToUtc(fromDate: string, toDate: string): { start: string; end: string } {
  const { start } = ttDateToUtcRange(fromDate);
  const { end }   = ttDateToUtcRange(toDate);
  return { start, end };
}

function filterLabel(filter: FilterType, from: string, to: string): string {
  const f2 = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (filter === "session") return f2(from);
  if (filter === "week")    return `${f2(from)} – ${f2(to)}`;
  if (filter === "month")   return new Date(from + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  if (filter === "year")    return from.slice(0, 4);
  return `${f2(from)} – ${f2(to)}`;
}

// ─── CalendarPopover ──────────────────────────────────────────────────────────
function CalendarPopover({ value, onChange, minDate, maxDate, label }: {
  value: string; onChange: (iso: string) => void; minDate?: string; maxDate?: string; label: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = isoToDate(value);
  return (
    <div className="w-full">
      <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest block mb-1">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm font-bold outline-none focus:ring-1 focus:ring-primary flex items-center justify-between gap-2 hover:bg-accent/40 transition-colors">
            <span>{selected.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
            <CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 z-50" align="start" sideOffset={4}>
          <Calendar mode="single" selected={selected}
            onSelect={(day) => { if (day) { onChange(toISO(day)); setOpen(false); } }}
            defaultMonth={selected}
            startMonth={minDate ? isoToDate(minDate) : undefined}
            endMonth={maxDate ? isoToDate(maxDate) : undefined}
            disabled={[
              ...(minDate ? [{ before: isoToDate(minDate) }] : []),
              ...(maxDate ? [{ after:  isoToDate(maxDate) }] : []),
            ]}
            captionLayout="dropdown" className="rounded-xl border-0" />
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function SummaryPage() {
  const { profile } = useAuth();
  const { effectiveOwnerId } = useChain();
  const { t } = useTranslation();
  const tzNow = () => new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });

  const [filter,   setFilter]   = useState<FilterType>("session");
  const [fromDate, setFromDate] = useState(today);
  const [toDate,   setToDate]   = useState(today);
  const [selMonth, setSelMonth] = useState(() => tzNow().getMonth());
  const [selYear,  setSelYear]  = useState(() => tzNow().getFullYear());
  const [earliestDate,   setEarliestDate]   = useState<string>("2020-01-01");
  const [availableYears, setAvailableYears] = useState<number[]>([new Date().getFullYear()]);

  const [orders,   setOrders]   = useState<Order[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [products, setProducts] = useState<ProductCost[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [downloading, setDownloading] = useState(false);
  const [downloaded,  setDownloaded]  = useState(false);
  // cashier name cache
  const [cashierNames, setCashierNames] = useState<Record<string, string>>({});

  const ownerId = profile ? effectiveOwnerId(profile.id) : "";

  // Load products + earliest record once
  useEffect(() => {
    if (!ownerId) return;
    Promise.all([
      supabase.from("products").select("id, name, cost_price, units_per_item, category").eq("owner_id", ownerId),
      supabase.from("orders").select("created_at").eq("owner_id", ownerId).order("created_at", { ascending: true }).limit(1).maybeSingle(),
      supabase.from("owner_expenses").select("expense_date").eq("owner_id", ownerId).order("expense_date", { ascending: true }).limit(1).maybeSingle(),
    ]).then(([prodRes, ordRes, expRes]) => {
      setProducts((prodRes.data ?? []) as ProductCost[]);
      const candidates: string[] = [];
      if (ordRes.data?.created_at) candidates.push(ordRes.data.created_at.slice(0, 10));
      if (expRes.data?.expense_date) candidates.push(expRes.data.expense_date);
      const earliest = candidates.sort()[0] ?? "2020-01-01";
      setEarliestDate(earliest);
      const startYr = parseInt(earliest.slice(0, 4));
      const endYr   = new Date().getFullYear();
      const yrs: number[] = [];
      for (let y = endYr; y >= startYr; y--) yrs.push(y);
      setAvailableYears(yrs);
    });
  }, [ownerId]);

  // Fetch orders + expenses whenever the date range changes
  const loadRecords = useCallback(async () => {
    if (!ownerId) return;
    setLoading(true);
    const { start, end } = ttRangeToUtc(fromDate, toDate);

    const [ordRes, expRes] = await Promise.all([
      supabase.from("orders")
        .select("id, total, paid, change_given, discount_amount, original_total, items, created_at, cashier_id")
        .eq("owner_id", ownerId)
        .gte("created_at", start)
        .lte("created_at", end)
        .order("created_at", { ascending: false }),
      supabase.from("owner_expenses")
        .select("id, amount, description, expense_date, created_at")
        .eq("owner_id", ownerId)
        .gte("created_at", start)
        .lte("created_at", end)
        .order("created_at", { ascending: false }),
    ]);

    const loadedOrders = (ordRes.data ?? []) as Order[];
    setOrders(loadedOrders);
    setExpenses((expRes.data ?? []) as Expense[]);

    // Resolve unique cashier IDs to names
    const ids = [...new Set(loadedOrders.map(o => o.cashier_id).filter(Boolean))] as string[];
    if (ids.length > 0) {
      const { data } = await supabase.from("profiles").select("id, username").in("id", ids);
      const nameMap: Record<string, string> = {};
      (data ?? []).forEach((p: { id: string; username: string }) => { nameMap[p.id] = p.username; });
      setCashierNames(nameMap);
    }

    setLoading(false);
  }, [ownerId, fromDate, toDate]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  // Sync date range when filter changes
  useEffect(() => {
    const nowTZ = tzNow();
    const nowDay = nowTZ.toLocaleDateString("en-CA");
    if (filter === "session") { setFromDate(nowDay); setToDate(nowDay); }
    else if (filter === "week") {
      setFromDate(nowDay);
      const end = new Date(nowTZ); end.setDate(end.getDate() + 6);
      setToDate(end.toLocaleDateString("en-CA"));
    } else if (filter === "month") {
      setSelMonth(nowTZ.getMonth()); setSelYear(nowTZ.getFullYear());
      const first = new Date(nowTZ.getFullYear(), nowTZ.getMonth(), 1);
      const last  = new Date(nowTZ.getFullYear(), nowTZ.getMonth() + 1, 0);
      setFromDate(first.toLocaleDateString("en-CA")); setToDate(last.toLocaleDateString("en-CA"));
    } else if (filter === "year") {
      setSelYear(nowTZ.getFullYear());
      setFromDate(`${nowTZ.getFullYear()}-01-01`); setToDate(`${nowTZ.getFullYear()}-12-31`);
    } else { setFromDate(nowDay); setToDate(nowDay); }
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (filter !== "month") return;
    const first = new Date(selYear, selMonth, 1);
    const last  = new Date(selYear, selMonth + 1, 0);
    setFromDate(first.toLocaleDateString("en-CA")); setToDate(last.toLocaleDateString("en-CA"));
  }, [selMonth, selYear]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (filter !== "year") return; setFromDate(`${selYear}-01-01`); setToDate(`${selYear}-12-31`); }, [selYear]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (filter !== "week") return; const end = new Date(fromDate + "T00:00:00"); end.setDate(end.getDate() + 6); setToDate(end.toLocaleDateString("en-CA")); }, [fromDate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile || profile.role !== "owner") return <div className="text-center text-muted-foreground py-20">Owners only.</div>;

  // Build cost/category maps
  const costMap      = new Map<string, number>(products.map(p => [p.id, p.units_per_item > 0 ? p.cost_price / p.units_per_item : p.cost_price]));
  const nameMap      = new Map<string, number>(products.map(p => [p.name, p.units_per_item > 0 ? p.cost_price / p.units_per_item : p.cost_price]));
  const categoryMap  = new Map<string, string>(products.map(p => [p.name, p.category ?? "miscellaneous"]));

  // Aggregate item totals across all orders
  const itemMap = new Map<string, { qty: number; revenue: number; costTotal: number; category: string }>();
  for (const o of orders) {
    for (const it of o.items) {
      const cat = categoryMap.get(it.name) ?? "miscellaneous";
      if (categoryFilter !== "all" && cat !== categoryFilter) continue;
      const baseId = it.id && it.id.includes("__") ? it.id.split("__")[0] : it.id;
      let costEach = 0;
      if (baseId && costMap.has(baseId)) costEach = costMap.get(baseId)!;
      else if (it.id && costMap.has(it.id)) costEach = costMap.get(it.id)!;
      else if (nameMap.has(it.name)) costEach = nameMap.get(it.name)!;
      const existing = itemMap.get(it.name) ?? { qty: 0, revenue: 0, costTotal: 0, category: cat };
      const costUnits = (it.units_consumed != null && it.units_consumed > 0) ? it.units_consumed : it.qty;
      itemMap.set(it.name, {
        qty:       existing.qty       + it.qty,
        revenue:   existing.revenue   + it.qty * it.price,
        costTotal: existing.costTotal + costUnits * costEach,
        category: cat,
      });
    }
  }
  const aggregatedItems = Array.from(itemMap.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue);

  const nonStockExpenses = expenses.filter(e => {
    const d = e.description ?? "";
    return d.startsWith("Non-Stock Expense") || d.startsWith("Reverted Stock Expense");
  });

  const totalRevenue   = aggregatedItems.reduce((s, it) => s + it.revenue, 0);
  const totalItemsCost = aggregatedItems.reduce((s, it) => s + it.costTotal, 0);
  const totalExpenses  = nonStockExpenses.filter(e => Number(e.amount) > 0).reduce((s, e) => s + Number(e.amount), 0);
  const grossProfit    = totalRevenue - totalItemsCost;
  const netProfit      = grossProfit - totalExpenses;

  // Filter orders for display when category filter is active
  const displayOrders = categoryFilter === "all"
    ? orders
    : orders.filter(o => o.items.some(it => (categoryMap.get(it.name) ?? "miscellaneous") === categoryFilter));

  const FILTERS: { key: FilterType; label: string }[] = [
    { key: "session", label: t("filter_session", "Session") },
    { key: "week",    label: t("filter_week",    "Week")    },
    { key: "month",   label: t("filter_month",   "Month")   },
    { key: "year",    label: t("filter_year",    "Year")    },
    { key: "period",  label: t("filter_period",  "Period")  },
  ];

  const handleDownloadPdf = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const periodLabel = filterLabel(filter, fromDate, toDate);
      const generated   = new Date().toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true, day: "numeric", month: "short", year: "numeric" });
      let y = await drawHeader(doc, profile.username ?? "Owner", "Summary Report", periodLabel, generated);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
      doc.text(`${displayOrders.length} order${displayOrders.length !== 1 ? "s" : ""} · Total: $${fmt(totalRevenue)}`, 14, y); y += 8;
      addFootersToAllPages(doc);
      await downloadPdf(`summary-${periodLabel.replace(/[^a-zA-Z0-9]/g, "-")}.pdf`, doc.output("datauristring"));
      toast.success("PDF saved to Downloads folder");
      setDownloaded(true); setTimeout(() => setDownloaded(false), 5000);
    } catch (err: any) { toast.error("Download failed: " + (err?.message ?? "unknown error")); }
    finally { setDownloading(false); }
  };

  return (
    <div className="space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black">Summary</h1>
          <p className="text-xs text-slate-500 mt-0.5">{filterLabel(filter, fromDate, toDate)}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="h-7 rounded-lg border border-border bg-background px-1.5 text-[10px] font-bold outline-none focus:ring-1 focus:ring-primary max-w-[90px]"
            style={{ color: "var(--foreground)" }}>
            <option value="all">All</option>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 font-black"
            disabled={downloading || loading} onClick={handleDownloadPdf}
            style={downloaded ? { background: "#16a34a", color: "#fff", borderColor: "#16a34a" } : {}}>
            {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : downloaded ? <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> : <Download className="h-3 w-3" />}
            {downloading ? "…" : downloaded ? "Done" : "PDF"}
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 rounded-2xl p-1" style={{ background: "#ffffff", border: "1px solid #e2e8f0" }}>
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className="flex-1 h-9 rounded-xl text-xs font-black transition active:scale-[0.97]"
            style={filter === f.key ? { background: "var(--gradient-hero)", color: "var(--primary-foreground)" } : { color: "#64748b" }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Date pickers */}
      {filter === "session" && (
        <div className="rounded-2xl border border-slate-200 p-4 space-y-2" style={{ background: "#ffffff" }}>
          <CalendarPopover label={t("select_day", "Select Day")} value={fromDate} maxDate={today} minDate={earliestDate} onChange={v => { setFromDate(v); setToDate(v); }} />
          {!loading && (
            <p className="text-xs text-slate-400 pt-1">
              {displayOrders.length === 0 ? t("no_orders_day", "No orders this day.") : `${displayOrders.length} order${displayOrders.length !== 1 ? "s" : ""} · until 11:59 pm`}
            </p>
          )}
        </div>
      )}
      {filter === "week" && (
        <div className="rounded-2xl border border-slate-200 p-4 space-y-2" style={{ background: "#ffffff" }}>
          <CalendarPopover label={t("week_start", "Week Start")} value={fromDate} maxDate={today} minDate={earliestDate} onChange={v => setFromDate(v)} />
          <p className="text-xs text-slate-400">Period: <span className="font-black text-slate-800">{new Date(fromDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })} → {new Date(toDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span></p>
        </div>
      )}
      {filter === "month" && (
        <div className="rounded-2xl border border-slate-200 p-4 space-y-3" style={{ background: "#ffffff" }}>
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("select_month", "Select Month")}</label>
          <div className="flex gap-3">
            <select value={selMonth} onChange={e => setSelMonth(Number(e.target.value))} className="flex-1 h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none text-slate-800">
              {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <select value={selYear} onChange={e => setSelYear(Number(e.target.value))} className="w-28 h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none text-slate-800">
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      )}
      {filter === "year" && (
        <div className="rounded-2xl border border-slate-200 p-4 space-y-2" style={{ background: "#ffffff" }}>
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t("select_year", "Select Year")}</label>
          <div className="relative">
            <select value={selYear} onChange={e => setSelYear(Number(e.target.value))} className="w-full h-11 rounded-xl border border-slate-200 bg-white pl-4 pr-10 text-sm font-black outline-none appearance-none cursor-pointer" style={{ color: "#15803d" }}>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><ChevronDown className="h-4 w-4" style={{ color: "#15803d" }} /></div>
          </div>
        </div>
      )}
      {filter === "period" && (
        <div className="rounded-2xl border border-slate-200 p-4 space-y-3" style={{ background: "#ffffff" }}>
          <div className="grid grid-cols-2 gap-3">
            <CalendarPopover label={t("from_date", "From")} value={fromDate} minDate={earliestDate} maxDate={toDate} onChange={v => setFromDate(v)} />
            <CalendarPopover label={t("to_date", "To")}     value={toDate}   minDate={fromDate}     maxDate={today}  onChange={v => setToDate(v)}   />
          </div>
          <p className="text-xs text-slate-400">Oldest record: <span className="font-black text-slate-800">{new Date(earliestDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span></p>
        </div>
      )}

      {/* Summary stats */}
      {!loading && displayOrders.length > 0 && (
        <div className="rounded-2xl border border-border overflow-hidden" style={{ background: "#ffffff" }}>
          <div className="grid grid-cols-2 divide-x divide-slate-200">
            {[
              { label: "Sales",      value: totalRevenue,   color: "#15803d" },
              { label: "Items Cost", value: totalItemsCost, color: "#b91c1c" },
            ].map((s, i) => (
              <div key={i} className="px-3 py-3 text-center">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-0.5">{s.label}</p>
                <p className="font-black text-sm" style={{ color: s.value > 0 ? s.color : "#9ca3af" }}>
                  {s.value > 0 ? `$${fmt(s.value)}` : "—"}
                </p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 divide-x divide-slate-200 border-t border-slate-200">
            {[
              { label: "Gross Profit", value: grossProfit,  color: grossProfit >= 0 ? "#15803d" : "#b91c1c", sign: true },
              { label: "Expenses",     value: totalExpenses, color: "#92400e", sign: false },
              { label: "Net Profit",   value: netProfit,    color: netProfit >= 0 ? "#15803d" : "#b91c1c",   sign: true },
            ].map((s, i) => (
              <div key={i} className="px-2 py-3 text-center">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-0.5">{s.label}</p>
                <p className="font-black text-xs" style={{ color: s.value !== 0 ? s.color : "#9ca3af" }}>
                  {s.sign && s.value > 0 ? "+" : ""}{s.value !== 0 ? `$${fmt(Math.abs(s.value))}` : "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
      ) : displayOrders.length === 0 && nonStockExpenses.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 p-8 text-center" style={{ background: "#ffffff" }}>
          <div className="text-3xl mb-3">📊</div>
          <p className="font-black text-sm text-slate-800">No records found</p>
          <p className="text-xs text-slate-400 mt-1">
            {filter === "session" ? "No orders on this day." : `No orders in this ${filter === "week" ? "week" : filter === "month" ? "month" : filter === "year" ? "year" : "period"}.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Aggregated items breakdown */}
          {aggregatedItems.length > 0 && (
            <div className="rounded-2xl border border-border overflow-hidden" style={{ background: "#ffffff" }}>
              <div className="px-4 py-2.5 flex items-center gap-2 border-b border-slate-200">
                <ShoppingBag className="h-3.5 w-3.5 text-slate-500" />
                <span className="text-xs font-black text-slate-800">Items Sold</span>
                <span className="text-[10px] text-slate-400 ml-auto">{displayOrders.length} orders</span>
              </div>
              <div className="divide-y divide-slate-100">
                {aggregatedItems.map(it => {
                  const rp = it.revenue - it.costTotal;
                  return (
                    <div key={it.name} className="px-4 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-sm flex-1 truncate text-slate-800">{it.name}</p>
                        <p className="text-[11px] text-slate-500 shrink-0">{it.qty} sold</p>
                      </div>
                      <div className="flex gap-4 mt-0.5">
                        <span className="text-xs font-black" style={{ color: "#15803d" }}>${fmt(it.revenue)}</span>
                        {it.costTotal > 0 && <span className="text-xs font-semibold" style={{ color: "#b91c1c" }}>${fmt(it.costTotal)}</span>}
                        {it.costTotal > 0 && <span className="text-xs font-black" style={{ color: rp >= 0 ? "#15803d" : "#b91c1c" }}>{rp >= 0 ? "+" : ""}${fmt(rp)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Flat order records */}
          <div className="rounded-2xl border border-border overflow-hidden" style={{ background: "#ffffff" }}>
            <div className="px-4 py-2.5 flex items-center justify-between border-b border-border/50">
              <span className="text-xs font-black text-slate-800">Orders</span>
              <span className="text-[10px] text-slate-500">{displayOrders.length}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {displayOrders.map(o => {
                const cashierName = o.cashier_id ? (cashierNames[o.cashier_id] ?? "Staff") : undefined;
                return (
                  <div key={o.id} className="px-4 py-3 flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-slate-500">
                          {new Date(o.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: TZ })}
                        </span>
                        {cashierName && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                            {cashierName}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {o.items.map((item, idx) => {
                          const cat = categoryMap.get(item.name) ?? "miscellaneous";
                          if (categoryFilter !== "all" && cat !== categoryFilter) return null;
                          return (
                            <span key={idx} className="text-xs text-slate-800 block">
                              {item.qty}× {item.name}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <span className="font-black text-sm shrink-0" style={{ color: "#15803d" }}>
                      ${fmt(Number(o.total))}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Expenses */}
          {nonStockExpenses.length > 0 && (
            <div className="rounded-2xl border border-border overflow-hidden" style={{ background: "#ffffff" }}>
              <div className="px-4 py-2.5 flex items-center gap-2 border-b border-slate-200">
                <TrendingDown className="h-3.5 w-3.5" style={{ color: "#92400e" }} />
                <span className="text-xs font-black text-slate-800">Expenses</span>
              </div>
              <div className="divide-y divide-slate-100">
                {nonStockExpenses.map(e => {
                  const lines = (e.description ?? "").split("\n").filter(Boolean).slice(1)
                    .filter(l => !l.startsWith("[Cashier:") && !l.startsWith("[Manager:"));
                  const isRefund = Number(e.amount) < 0;
                  const dateTime = new Date(e.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: TZ });
                  return (
                    <div key={e.id} className="px-4 py-3 flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {lines.length > 0
                          ? lines.map((l, i) => <p key={i} className="text-sm font-semibold text-slate-800">{l.split(" = ")[0]}</p>)
                          : <p className="text-sm font-semibold text-slate-800">Expense</p>}
                        <p className="text-[10px] text-slate-400 mt-0.5">{dateTime}</p>
                      </div>
                      <p className="font-black text-sm shrink-0" style={{ color: isRefund ? "#15803d" : "#92400e" }}>
                        {isRefund ? `+$${fmt(Math.abs(Number(e.amount)))}` : `$${fmt(Number(e.amount))}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
