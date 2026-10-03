import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useChain } from "@/lib/ChainContext";
import { supabase } from "@/integrations/supabase/client";
import { TrendingDown, ShoppingBag, Loader2, Download, CalendarIcon, Clock, ChevronDown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { drawHeader, addFootersToAllPages } from "@/lib/pdfHelpers";
import { downloadPdf } from "@/lib/download";
import { drawSummaryReport } from "@/lib/summaryPdf";
import { CATEGORIES } from "@/lib/categories";
import { useTranslation } from "@/lib/i18n";
import { barPeriodSummary, fetchAllPaged, isNonStockExpense, lineStockCost, orderItemCollected, ttCalendarDayBounds, type SummaryProductCost } from "@/lib/salesSummary";

// ─── Types ────────────────────────────────────────────────────────────────────
type OrderItem = { id?: string; name: string; qty: number; price: number; units_consumed?: number | null; discount?: number; original_price?: number };
type Order = { id: string; total: number; paid: number; change_given: number; discount_amount?: number | null; original_total?: number | null; items: OrderItem[]; created_at: string; cashier_id?: string | null };
type Expense = { id: string; amount: number; description: string | null; expense_date: string; created_at: string };
type ProductCost = { id: string; name: string; cost_price: number; units_per_item: number; category: string | null };
type FilterType = "day" | "week" | "month" | "year" | "period";

// Parent bar session (Open Bar → Close Bar)
type BarSession = { id: string; opened_at: string; closed_at: string | null };
// Sub-session (cashier shift within a bar session)
type SubSession = { id: string; store_session_id: string; opened_at: string; closed_at: string | null; cashier_float: number };
// Lazy-loaded data per session or sub-session
type SessionData = { orders: Order[]; expenses: Expense[]; walletIncome: number; loaded: boolean; loading: boolean };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function toISO(d: Date) { return d.toISOString().slice(0, 10); }
const TZ = "America/Port_of_Spain";

function fmtTs(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ })
    + " · " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: TZ });
}
function isoDateTT(iso: string) { return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }); }

function filterLabel(filter: FilterType, from: string, to: string): string {
  const f2 = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (filter === "day") return f2(from);
  if (filter === "week")    return `${f2(from)} – ${f2(to)}`;
  if (filter === "month")   return new Date(from + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  if (filter === "year")    return from.slice(0, 4);
  return `${f2(from)} – ${f2(to)}`;
}

function isoToDate(iso: string) { return new Date(iso + "T00:00:00"); }
function dateToIso(d: Date) { return toISO(d); }

// ─── CalendarPopover ──────────────────────────────────────────────────────────
function CalendarPopover({ value, onChange, minDate, maxDate, label }: {
  value: string; onChange: (iso: string) => void; minDate?: string; maxDate?: string; label: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = isoToDate(value);
  return (
    <div className="w-full">
      <label className="text-[10px] font-black text-slate-800 uppercase tracking-widest block mb-1">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm font-bold outline-none focus:ring-1 focus:ring-primary flex items-center justify-between gap-2 hover:bg-accent/40 transition-colors">
            <span>{selected.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
            <CalendarIcon className="h-4 w-4 text-slate-800 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 z-50" align="start" sideOffset={4}>
          <Calendar mode="single" selected={selected}
            onSelect={(day) => { if (day) { onChange(dateToIso(day)); setOpen(false); } }}
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

// ─── SubSessionAccordion ──────────────────────────────────────────────────────
// Shows one cashier shift (sub-session) inside a bar session accordion
function SubSessionAccordion({ sub, products, categoryFilter, isActive, ownerId }: {
  sub: SubSession; products: ProductCost[]; categoryFilter: string; isActive: boolean; ownerId: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SessionData>({ orders: [], expenses: [], walletIncome: 0, loaded: false, loading: false });
  const loadedRef = useRef(false);

  const startIso = sub.opened_at;
  const endIso   = sub.closed_at ?? new Date().toISOString();

  const loadData = useCallback(async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setData(d => ({ ...d, loading: true }));

    const orders = await fetchAllPaged<Order>((from, to) => {
      let q = supabase.from("orders").select("id, total, paid, change_given, discount_amount, original_total, items, created_at, cashier_id")
        .eq("owner_id", ownerId)
        .gte("created_at", startIso);
      if (sub.closed_at) q = q.lte("created_at", sub.closed_at);
      return q.order("created_at", { ascending: false }).range(from, to);
    });
    const expenses = await fetchAllPaged<Expense>((from, to) => {
      let q = supabase.from("owner_expenses").select("id, amount, description, expense_date, created_at")
        .eq("owner_id", ownerId)
        .gte("created_at", startIso);
      if (sub.closed_at) q = q.lte("created_at", sub.closed_at);
      return q.order("created_at", { ascending: false }).range(from, to);
    });

    // Sales come from orders. A till clear is not added on top of those sales.
    setData({
      orders,
      expenses,
      walletIncome: 0,
      loaded: true, loading: false,
    });
  }, [startIso, sub.closed_at, ownerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = () => { const next = !open; setOpen(next); if (next && !loadedRef.current) loadData(); };

  const costProducts = products as SummaryProductCost[];
  const period = barPeriodSummary(data.orders, data.expenses, products as SummaryProductCost[]);
  const items = categoryFilter === "all" ? period.items : period.items.filter(it => it.category === categoryFilter);
  const nonStockExpenses = data.expenses.filter(e => isNonStockExpense(e.description));
  const totalNonStockExpenses = categoryFilter === "all" ? period.expenses : 0;
  const totalIncome = categoryFilter === "all" ? period.sales : items.reduce((s, it) => s + it.revenue, 0);
  const totalItemsCost = items.reduce((s, it) => s + it.costTotal, 0);
  const totalExpenses  = totalNonStockExpenses;

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      {/* Sub-session header */}
      <button onClick={handleToggle} className="w-full px-3 py-2.5 flex items-center justify-between gap-3 text-left transition active:bg-white/5">
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Users className="h-3 w-3 text-slate-800 shrink-0" />
            <span className="text-[11px] font-black text-foreground">{fmtTs(sub.opened_at)}</span>
            {isActive && <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "rgba(134,239,172,0.15)", color: "#15803d", border: "1px solid rgba(134,239,172,0.3)" }}>LIVE</span>}
          </div>
          <div className="flex items-center gap-1.5 pl-5">
            <span className="text-[10px] text-slate-800">
              {sub.closed_at ? `→ ${fmtTs(sub.closed_at)}` : "Still open"}
            </span>
            {sub.cashier_float > 0 && <span className="text-[9px] text-slate-800">· Float ${fmt(sub.cashier_float)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data.loaded
            ? <span className="font-black text-xs" style={{ color: totalIncome > 0 ? "#15803d" : "var(--muted-foreground)" }}>
                ${fmt(totalIncome)}
              </span>
            : <span className="text-[10px] text-slate-800">tap</span>
          }
          {data.loading && <Loader2 className="h-3 w-3 animate-spin text-slate-800" />}
          <ChevronDown className={`h-3 w-3 text-slate-800 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {open && (
        <div className="border-t" style={{ borderColor: "#e2e8f0" }}>
          {data.loading && <div className="flex justify-center py-5"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>}
          {data.loaded && (
            <>
              {/* Mini stats — top row: Bar Sales, Items Cost */}
              <div className="grid grid-cols-2 border-b" style={{ borderColor: "#e2e8f0" }}>
                {[
                  { label: t("bar_sales", "Bar Sales"),  value: totalIncome,    color: "#15803d" },
                  { label: t("items_cost", "Items Cost"), value: totalItemsCost, color: "#b91c1c" },
                ].map((s, i, arr) => (
                  <div key={i} className="px-2 py-2 text-center" style={i < arr.length - 1 ? { borderRight: "1px solid #e2e8f0" } : {}}>
                    <p className="text-xs font-black text-slate-800 uppercase tracking-widest mb-0.5">{s.label}</p>
                    <p className="font-black text-xs" style={{ color: s.value !== 0 ? s.color : "var(--muted-foreground)" }}>
                      {s.value !== 0 ? `$${fmt(Math.abs(s.value))}` : "—"}
                    </p>
                  </div>
                ))}
              </div>
              {/* Mini stats — bottom row: Gross Profit, Expenses, Net Profit */}
              {(() => {
                const grossProfit = totalIncome - totalItemsCost;
                const netProfit   = grossProfit - totalExpenses;
                return (
                  <div className="grid grid-cols-3 border-b" style={{ borderColor: "#e2e8f0" }}>
                    {[
                      { label: t("gross_profit", "Gross Profit"), value: grossProfit, color: grossProfit >= 0 ? "#15803d" : "#b91c1c", sign: true },
                      { label: t("expenses", "Expenses"),     value: totalExpenses, color: "#a16207", sign: false },
                      { label: t("net_profit", "Net Profit"),   value: netProfit,   color: netProfit >= 0 ? "#15803d" : "#b91c1c", sign: true },
                    ].map((s, i, arr) => (
                      <div key={i} className="px-2 py-2 text-center" style={i < arr.length - 1 ? { borderRight: "1px solid #e2e8f0" } : {}}>
                        <p className="text-xs font-black text-slate-800 uppercase tracking-widest mb-0.5">{s.label}</p>
                        <p className="font-black text-xs" style={{ color: s.value !== 0 ? s.color : "var(--muted-foreground)" }}>
                          {s.value !== 0 ? `${s.sign ? (s.value > 0 ? "+" : "-") : ""}$${fmt(Math.abs(s.value))}` : "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {/* Items */}
              {items.length === 0
                ? <div className="py-6 text-center text-slate-800 text-xs">No sales in this shift</div>
                : <div>
                    <div className="px-3 py-1.5 flex items-center gap-2" style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <ShoppingBag className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-black">{t("items_sold", "Items Sold")}</span>
                      <span className="text-xs text-slate-800 ml-auto">{data.orders.length} {data.orders.length === 1 ? t("order_1", "order") : t("orders_n", "orders")}</span>
                    </div>
                    <div className="divide-y" style={{ "--tw-divide-opacity": 1 } as React.CSSProperties}>
                      {items.map(it => {
                        const rp = it.revenue - it.costTotal;
                        return (
                          <div key={it.name} className="px-3 py-2 space-y-0.5" style={{ borderColor: "#e2e8f0" }}>
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-bold text-xs flex-1">{it.name}</p>
                              <p className="text-xs text-slate-800">{it.qty} {t("sold_lbl", "sold")}</p>
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                              <p className="text-right font-semibold text-xs" style={{ color: "#15803d" }}>${fmt(it.revenue)}</p>
                              <p className="text-right font-semibold text-xs" style={{ color: "#b91c1c" }}>{it.costTotal > 0 ? `$${fmt(it.costTotal)}` : "—"}</p>
                              <p className="text-right font-black text-xs" style={{ color: rp >= 0 ? "#15803d" : "#b91c1c" }}>{rp >= 0 ? "+" : ""}${fmt(rp)}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
              }
              {/* Order records */}
              {data.orders.length > 0 && (
                <div style={{ borderTop: "1px solid #e2e8f0" }}>
                  <div className="px-3 py-1.5 flex items-center justify-between">
                    <span className="text-xs font-black">Orders</span>
                    <span className="text-xs text-slate-800">{data.orders.length}</span>
                  </div>
                  {data.orders.map(o => (
                    <div key={o.id} className="px-3 py-2 flex items-start justify-between gap-2" style={{ borderTop: "1px solid #e2e8f0" }}>
                      <div className="min-w-0 flex-1">
                        <span className="text-xs text-slate-800 block">{new Date(o.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: TZ })}</span>
                        <div className="mt-0.5 space-y-0.5">
                          {(() => {
                            const collected = orderItemCollected(o);
                            return o.items.map((item, idx) => {
                            const saleTotal = collected[idx]?.collected ?? 0;
                            const costTotal = lineStockCost(item, costProducts);
                            const profit    = saleTotal - costTotal;
                            return (
                              <span key={idx} className="text-xs text-slate-800 block">
                                {item.qty}× {item.name}
                                {" · "}
                                <span style={{ color: "#15803d" }}>${fmt(saleTotal)}</span>
                                {costTotal > 0 && <> · <span style={{ color: "#b91c1c" }}>${fmt(costTotal)}</span> · <span style={{ color: profit >= 0 ? "#15803d" : "#b91c1c" }}>{profit >= 0 ? "+" : ""}${fmt(profit)}</span></>}
                              </span>
                            );
                          });
                          })()}
                        </div>
                      </div>
                      <span className="font-black text-xs shrink-0" style={{ color: "#15803d" }}>
                        ${fmt(Number(o.total))}
                        {o.discount_amount != null && Number(o.discount_amount) > 0 && (
                          <span className="block text-xs font-black text-right" style={{ color: "#a16207" }}>
                            -${fmt(Number(o.discount_amount))} off
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {/* Expenses */}
              {nonStockExpenses.length > 0 && (
                <div style={{ borderTop: "1px solid #e2e8f0" }}>
                  <div className="px-3 py-1.5 flex items-center gap-2">
                    <TrendingDown className="h-3.5 w-3.5 text-red-700" />
                    <span className="text-xs font-black">Expenses</span>
                  </div>
                  {nonStockExpenses.map(e => {
                    const lines = (e.description ?? "").split("\n").filter(Boolean).slice(1).filter(l => !l.startsWith("[Cashier:") && !l.startsWith("[Manager:"));
                    const isRefund = Number(e.amount) < 0;
                    const dateTime = new Date(e.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: TZ });
                    return (
                      <div key={e.id} className="px-3 py-2 flex items-start justify-between gap-2" style={{ borderTop: "1px solid #e2e8f0" }}>
                        <div className="flex-1 min-w-0">
                          {lines.length > 0 ? lines.map((l, i) => <p key={i} className="text-xs font-semibold">{l.split(" = ")[0]}</p>) : <p className="text-xs font-semibold">Expense</p>}
                          <p className="text-xs text-slate-800 mt-0.5">{dateTime}</p>
                        </div>
                        <p className="font-black text-xs shrink-0" style={{ color: isRefund ? "#15803d" : "#b91c1c" }}>
                          {isRefund ? `+$${fmt(Math.abs(Number(e.amount)))}` : `$${fmt(Number(e.amount))}`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── BarSessionAccordion ──────────────────────────────────────────────────────
// Outer accordion: one per bar_sessions row (Open Bar → Close Bar)
function BarSessionAccordion({ session, subSessions, products, categoryFilter, activeSessionId, ownerId }: {
  session: BarSession; subSessions: SubSession[]; products: ProductCost[]; categoryFilter: string; activeSessionId: string | null; ownerId: string;
}) {
  const [open, setOpen] = useState(false);
  const isActive = session.id === activeSessionId || (session.id === "active" && !session.closed_at);

  const openedLabel = fmtTs(session.opened_at);
  const closedLabel = session.closed_at ? fmtTs(session.closed_at) : null;
  const mySubs = subSessions.filter(s => s.store_session_id === session.id);

  const fallbackSub: SubSession = {
    id: `session-${session.id}`,
    store_session_id: session.id,
    opened_at: session.opened_at,
    closed_at: session.closed_at,
    cashier_float: 0,
  };

  return (
    <div className="rounded-2xl border border-border overflow-hidden" style={{ background: "var(--gradient-card)" }}>
      {/* Outer header */}
      <button onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left transition active:bg-white/5">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px]">{isActive ? "🟢" : "🔴"}</span>
            <span className="text-xs font-black text-foreground">{openedLabel}</span>
            {isActive && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "rgba(134,239,172,0.15)", color: "#15803d", border: "1px solid rgba(134,239,172,0.3)" }}>LIVE</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-slate-800 shrink-0" />
            {closedLabel
              ? <span className="text-[11px] text-slate-800">Closed {closedLabel}</span>
              : <span className="text-[11px] font-semibold" style={{ color: "#15803d" }}>Still open</span>
            }
          </div>
          <div className="text-[10px] text-slate-800">
            {mySubs.length > 0 ? `${mySubs.length} cashier shift${mySubs.length !== 1 ? "s" : ""}` : "Full Session"}
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-800 transition-transform shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Sub-sessions or session fallback */}
      {open && (
        <div className="border-t border-border/50 p-3 space-y-2">
          {mySubs.length > 0
            ? mySubs.map(sub => (
                <SubSessionAccordion
                  key={sub.id}
                  sub={sub}
                  products={products}
                  categoryFilter={categoryFilter}
                  isActive={!sub.closed_at && isActive}
                  ownerId={ownerId}
                />
              ))
            : (
                <SubSessionAccordion
                  key={fallbackSub.id}
                  sub={fallbackSub}
                  products={products}
                  categoryFilter={categoryFilter}
                  isActive={isActive}
                  ownerId={ownerId}
                />
              )
          }
        </div>
      )}
    </div>
  );
}

// ─── CombinedSummaryView ──────────────────────────────────────────────────────
// Aggregates all records within the selected calendar date range (TT timezone).
// Sessions are used only for the "X sessions this day" count — NOT as query bounds.
// The owner picks a date range; we show everything recorded in that window.
function CombinedSummaryView({ fromDate, toDate, products, categoryFilter, ownerId, filter, filteredSessions }: {
  fromDate: string; toDate: string; products: ProductCost[]; categoryFilter: string; ownerId: string; filter?: FilterType; filteredSessions?: BarSession[];
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<{ orders: Order[]; expenses: Expense[]; walletIncome: number; loading: boolean }>({ orders: [], expenses: [], walletIncome: 0, loading: true });

  useEffect(() => {
    let cancelled = false;
    setData(d => ({ ...d, loading: true }));

    // Calendar window for the filter the owner picked. Wallet Today is separate:
    // it follows the open bar, not this calendar day.
    const fromUTC = ttCalendarDayBounds(fromDate).fromUTC;
    const toUTC   = ttCalendarDayBounds(toDate).toUTC;

    Promise.all([
      fetchAllPaged<Order>((from, to) =>
        supabase.from("orders").select("id, total, paid, change_given, discount_amount, original_total, items, created_at, cashier_id")
          .eq("owner_id", ownerId).gte("created_at", fromUTC).lte("created_at", toUTC)
          .order("created_at", { ascending: false }).range(from, to),
      ),
      fetchAllPaged<Expense>((from, to) =>
        supabase.from("owner_expenses").select("id, amount, description, expense_date, created_at")
          .eq("owner_id", ownerId).gte("created_at", fromUTC).lte("created_at", toUTC)
          .order("created_at", { ascending: false }).range(from, to),
      ),
    ]).then(([orders, expenses]) => {
      if (cancelled) return;
      // Every sale stays here. Wallet All Time counts a manager or cashier sale
      // only after that wallet is cleared, then the two all-time totals match.
      // A clear is not added again as a second sale.
      setData({
        orders,
        expenses,
        walletIncome: 0,
        loading: false,
      });
    });
    return () => { cancelled = true; };
  }, [fromDate, toDate, ownerId, filter, filteredSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  const costProducts = products as SummaryProductCost[];
  const period = barPeriodSummary(data.orders, data.expenses, products as SummaryProductCost[]);
  const items = categoryFilter === "all" ? period.items : period.items.filter(it => it.category === categoryFilter);
  const nonStockExpenses = data.expenses.filter(e => isNonStockExpense(e.description));
  const totalNonStockExpenses = categoryFilter === "all" ? period.expenses : 0;
  const totalIncome = categoryFilter === "all" ? period.sales : items.reduce((s, it) => s + it.revenue, 0);
  const totalItemsCost = items.reduce((s, it) => s + it.costTotal, 0);
  const totalExpenses  = totalNonStockExpenses;

  return (
    <div className="rounded-2xl border border-sky-200 overflow-hidden bg-white">
      <div style={{ background: "var(--gradient-hero)", color: "#ffffff" }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.25)" }}>
        <span className="text-xs font-black text-white">
          {filterLabel(filter ?? "period", fromDate, toDate)} · {t("combined_summary", "Combined Summary")}
        </span>
        {data.loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />}
      </div>

      {data.loading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-white" /></div>}

      {!data.loading && (
        <>
          {/* Mini stats — top row: Bar Sales, Items Cost */}
          <div className="grid grid-cols-2 border-b" style={{ borderColor: "rgba(255,255,255,0.25)" }}>
            {[
              { label: t("bar_sales", "Bar Sales"),  value: totalIncome },
              { label: t("items_cost", "Items Cost"), value: totalItemsCost },
            ].map((s, i, arr) => (
              <div key={i} className="px-3 py-2.5 text-center" style={i < arr.length - 1 ? { borderRight: "1px solid rgba(255,255,255,0.25)" } : {}}>
                <p className="text-xs font-black uppercase tracking-widest mb-0.5" style={{ color: "rgba(255,255,255,0.85)" }}>{s.label}</p>
                <p className="font-black text-xs text-white">
                  {s.value !== 0 ? `$${fmt(Math.abs(s.value))}` : "—"}
                </p>
              </div>
            ))}
          </div>
          {/* Mini stats — bottom row: Gross Profit, Expenses, Net Profit */}
          {(() => {
            const grossProfit = totalIncome - totalItemsCost;
            const netProfit   = grossProfit - totalExpenses;
            return (
              <div className="grid grid-cols-3" style={{ borderColor: "rgba(255,255,255,0.25)" }}>
                {[
                  { label: t("gross_profit", "Gross Profit"), value: grossProfit, sign: true },
                  { label: t("expenses", "Expenses"),     value: totalExpenses, sign: false },
                  { label: t("net_profit", "Net Profit"),   value: netProfit, sign: true },
                ].map((s, i, arr) => (
                  <div key={i} className="px-3 py-2.5 text-center" style={i < arr.length - 1 ? { borderRight: "1px solid rgba(255,255,255,0.25)" } : {}}>
                    <p className="text-xs font-black uppercase tracking-widest mb-0.5" style={{ color: "rgba(255,255,255,0.85)" }}>{s.label}</p>
                    <p className="font-black text-xs text-white">
                      {s.value !== 0 ? `${s.sign ? (s.value > 0 ? "+" : "-") : ""}$${fmt(Math.abs(s.value))}` : "—"}
                    </p>
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      )}
      </div>
      {!data.loading && (
      <div className="bg-white text-slate-900">
          {/* Items */}
          {items.length === 0
            ? <div className="py-6 text-center text-slate-800 text-xs">{t("no_sales_period", "No sales in this period")}</div>
            : <div>
                <div className="px-3 py-1.5 flex items-center gap-2" style={{ borderBottom: "1px solid #e2e8f0" }}>
                  <ShoppingBag className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-black">{t("items_sold", "Items Sold")}</span>
                  <span className="text-xs text-slate-800 ml-auto">{data.orders.length} {data.orders.length === 1 ? t("order_1", "order") : t("orders_n", "orders")}</span>
                </div>
                <div className="divide-y" style={{ "--tw-divide-opacity": 1 } as React.CSSProperties}>
                  {items.map(it => {
                    const rp = it.revenue - it.costTotal;
                    return (
                      <div key={it.name} className="px-3 py-2 space-y-0.5" style={{ borderColor: "#e2e8f0" }}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-bold text-xs flex-1">{it.name}</p>
                          <p className="text-xs text-slate-800">{it.qty} {t("sold_lbl", "sold")}</p>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          <p className="text-right font-semibold text-xs" style={{ color: "#15803d" }}>${fmt(it.revenue)}</p>
                          <p className="text-right font-semibold text-xs" style={{ color: "#b91c1c" }}>{it.costTotal > 0 ? `$${fmt(it.costTotal)}` : "—"}</p>
                          <p className="text-right font-black text-xs" style={{ color: rp >= 0 ? "#15803d" : "#b91c1c" }}>{rp >= 0 ? "+" : ""}${fmt(rp)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
          }
          {/* Order records */}
          {data.orders.length > 0 && (
            <div style={{ borderTop: "1px solid #e2e8f0" }}>
              <div className="px-3 py-1.5 flex items-center justify-between">
                <span className="text-xs font-black">Orders</span>
                <span className="text-xs text-slate-800">{data.orders.length}</span>
              </div>
              {data.orders.map(o => (
                <div key={o.id} className="px-3 py-2 flex items-start justify-between gap-2" style={{ borderTop: "1px solid #e2e8f0" }}>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs text-slate-800 block">{new Date(o.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: TZ })}</span>
                    <div className="mt-0.5 space-y-0.5">
                      {(() => {
                        const collected = orderItemCollected(o);
                        return o.items.map((item, idx) => {
                        const saleTotal = collected[idx]?.collected ?? 0;
                        const costTotal = lineStockCost(item, costProducts);
                        const profit    = saleTotal - costTotal;
                        return (
                          <span key={idx} className="text-xs text-slate-800 block">
                            {item.qty}× {item.name}
                            {" · "}
                            <span style={{ color: "#15803d" }}>${fmt(saleTotal)}</span>
                            {costTotal > 0 && <> · <span style={{ color: "#b91c1c" }}>${fmt(costTotal)}</span> · <span style={{ color: profit >= 0 ? "#15803d" : "#b91c1c" }}>{profit >= 0 ? "+" : ""}${fmt(profit)}</span></>}
                          </span>
                        );
                      });
                      })()}
                    </div>
                  </div>
                  <span className="font-black text-xs shrink-0" style={{ color: "#15803d" }}>
                    ${fmt(Number(o.total))}
                    {o.discount_amount != null && Number(o.discount_amount) > 0 && (
                      <span className="block text-xs font-black text-right" style={{ color: "#a16207" }}>
                        -${fmt(Number(o.discount_amount))} off
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* Expenses */}
          {nonStockExpenses.length > 0 && (
            <div style={{ borderTop: "1px solid #e2e8f0" }}>
              <div className="px-3 py-1.5 flex items-center gap-2">
                <TrendingDown className="h-3.5 w-3.5 text-red-700" />
                <span className="text-xs font-black">Expenses</span>
              </div>
              {nonStockExpenses.map(e => {
                const lines = (e.description ?? "").split("\n").filter(Boolean).slice(1).filter(l => !l.startsWith("[Cashier:") && !l.startsWith("[Manager:"));
                const isRefund = Number(e.amount) < 0;
                const dateTime = new Date(e.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: TZ });
                return (
                  <div key={e.id} className="px-3 py-2 flex items-start justify-between gap-2" style={{ borderTop: "1px solid #e2e8f0" }}>
                    <div className="flex-1 min-w-0">
                      {lines.length > 0 ? lines.map((l, i) => <p key={i} className="text-xs font-semibold">{l.split(" = ")[0]}</p>) : <p className="text-xs font-semibold">Expense</p>}
                      <p className="text-xs text-slate-800 mt-0.5">{dateTime}</p>
                    </div>
                    <p className="font-black text-xs shrink-0" style={{ color: isRefund ? "#15803d" : "#b91c1c" }}>
                      {isRefund ? `+$${fmt(Math.abs(Number(e.amount)))}` : `$${fmt(Number(e.amount))}`}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
      </div>
      )}
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

  const [filter,   setFilter]   = useState<FilterType>("day");
  const [fromDate, setFromDate] = useState(today);
  const [toDate,   setToDate]   = useState(today);
  const [selMonth, setSelMonth] = useState(() => tzNow().getMonth());
  const [selYear,  setSelYear]  = useState(() => tzNow().getFullYear());
  const [earliestDate,   setEarliestDate]   = useState<string>("2020-01-01");
  const [availableYears, setAvailableYears] = useState<number[]>([new Date().getFullYear()]);

  const [barIsOpen, setBarIsOpen] = useState(false);
  const [allSessions,    setAllSessions]    = useState<BarSession[]>([]);
  const [allSubSessions, setAllSubSessions] = useState<SubSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [products, setProducts] = useState<ProductCost[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [storeCategories, setStoreCategories] = useState<{ id: string; name: string }[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [downloaded,  setDownloaded]  = useState(false);

  const ownerId = profile ? effectiveOwnerId(profile.id) : "";

  // Load everything once
  useEffect(() => {
    if (!ownerId) return;
    setLoadingSessions(true);
    Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from("profiles").select("store_session_start, store_closed_at").eq("id", ownerId).maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from("store_sessions").select("id, opened_at, closed_at").eq("owner_id", ownerId).order("opened_at", { ascending: false }).limit(200),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from("store_sub_sessions").select("id, store_session_id, opened_at, closed_at, cashier_float").eq("owner_id", ownerId).order("opened_at", { ascending: false }).limit(500),
      supabase.from("products").select("id, name, cost_price, units_per_item, category").eq("owner_id", ownerId),
      supabase.from("store_categories").select("id, name").eq("owner_id", ownerId).order("name"),
    ]).then(([profileRes, sessionsRes, subSessionsRes, productsRes, catsRes]: any[]) => {
      const pData = profileRes.data;
      const isOpen = !!(pData?.store_session_start) && !(pData?.store_closed_at);
      setBarIsOpen(isOpen);
      let sessions: BarSession[] = (sessionsRes.data ?? []).map((s: any) => ({ id: s.id, opened_at: s.opened_at, closed_at: s.closed_at }));
      if (isOpen && pData?.store_session_start && !sessions.some((s: BarSession) => s.opened_at === pData.store_session_start)) {
        sessions = [{ id: "active-session", opened_at: pData.store_session_start, closed_at: null }, ...sessions];
      }
      setAllSessions(sessions);
      setAllSubSessions((subSessionsRes.data ?? []).map((s: any) => ({ id: s.id, store_session_id: s.store_session_id, opened_at: s.opened_at, closed_at: s.closed_at, cashier_float: Number(s.cashier_float ?? 0) })));
      setProducts((productsRes.data ?? []) as ProductCost[]);
      setStoreCategories((catsRes.data ?? []) as { id: string; name: string }[]);
      setLoadingSessions(false);
    });
  }, [ownerId]);

  // Fetch earliest record for pickers
  useEffect(() => {
    if (!ownerId) return;
    Promise.all([
      supabase.from("orders").select("created_at").eq("owner_id", ownerId).order("created_at", { ascending: true }).limit(1).maybeSingle(),
      supabase.from("owner_expenses").select("expense_date").eq("owner_id", ownerId).order("expense_date", { ascending: true }).limit(1).maybeSingle(),
    ]).then(([ordRes, expRes]) => {
      const candidates: string[] = [];
      if (ordRes.data?.created_at) candidates.push(ordRes.data.created_at.slice(0, 10));
      if (expRes.data?.expense_date) candidates.push(expRes.data.expense_date);
      const earliest = candidates.sort()[0] ?? "2020-01-01";
      setEarliestDate(earliest);
      const startYr = parseInt(earliest.slice(0, 4));
      const endYr   = tzNow().getFullYear();
      const yrs: number[] = [];
      for (let y = endYr; y >= startYr; y--) yrs.push(y);
      setAvailableYears(yrs);
    });
  }, [ownerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync date range when filter/selMonth/selYear changes
  useEffect(() => {
    const nowTZ = tzNow();
    const nowDay = nowTZ.toLocaleDateString("en-CA");
    if (filter === "day") { setFromDate(nowDay); setToDate(nowDay); }
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

  if (!profile || profile.role !== "owner") return <div className="text-center text-slate-800 py-20">Owners only.</div>;

  // Filter bar sessions that overlap the selected date range.
  // A session "belongs" to a date range if it was open at any point during it:
  // opened_at ≤ end-of-range AND (closed_at ≥ start-of-range OR still open)
  const filteredSessions: BarSession[] = (() => {
    const rangeStart = ttCalendarDayBounds(fromDate).fromUTC;
    const rangeEnd   = ttCalendarDayBounds(toDate).toUTC;
    const res = allSessions.filter(s => {
      const openedBefore = s.opened_at <= rangeEnd;
      const closedAfter  = !s.closed_at || s.closed_at >= rangeStart;
      return openedBefore && closedAfter;
    });
    return res;
  })();

  const activeSessionId = allSessions.find(s => !s.closed_at)?.id ?? null;

  const FILTERS: { key: FilterType; label: string }[] = [
    { key: "day",    label: t("filter_day",    "Day")    },
    { key: "week",   label: t("filter_week",   "Week")   },
    { key: "month",  label: t("filter_month",  "Month")  },
    { key: "year",   label: t("filter_year",   "Year")   },
    { key: "period", label: t("filter_period", "Period") },
  ];

  const handleDownloadPdf = async () => {
    if (downloading || !ownerId) return;
    setDownloading(true);
    try {
      const fromUTC = ttCalendarDayBounds(fromDate).fromUTC;
      const toUTC = ttCalendarDayBounds(toDate).toUTC;
      const [orders, expenses] = await Promise.all([
        fetchAllPaged<Order>((from, to) =>
          supabase.from("orders").select("id, total, paid, change_given, discount_amount, original_total, items, created_at")
            .eq("owner_id", ownerId).gte("created_at", fromUTC).lte("created_at", toUTC)
            .order("created_at", { ascending: false }).range(from, to),
        ),
        fetchAllPaged<Expense>((from, to) =>
          supabase.from("owner_expenses").select("id, amount, description, expense_date, created_at")
            .eq("owner_id", ownerId).gte("created_at", fromUTC).lte("created_at", toUTC)
            .order("created_at", { ascending: false }).range(from, to),
        ),
      ]);

      const costProducts = products as SummaryProductCost[];
      const period = barPeriodSummary(orders, expenses, costProducts);
      const sold = categoryFilter === "all" ? period.items : period.items.filter(it => it.category === categoryFilter);
      const totalIncome = categoryFilter === "all" ? period.sales : sold.reduce((s, it) => s + it.revenue, 0);
      const totalItemsCost = sold.reduce((s, it) => s + it.costTotal, 0);
      const totalExpenses = categoryFilter === "all" ? period.expenses : 0;
      const grossProfit = totalIncome - totalItemsCost;
      const categoryLabel = categoryFilter === "all"
        ? "All categories"
        : storeCategories.find(c => c.id === categoryFilter)?.name
          ?? CATEGORIES.find(c => c.value === categoryFilter)?.label
          ?? categoryFilter;

      const when = (iso: string, withYear: boolean) => new Date(iso).toLocaleString("en-GB", {
        day: "numeric", month: "short", ...(withYear ? { year: "numeric" as const } : {}),
        hour: "2-digit", minute: "2-digit", hour12: true, timeZone: TZ,
      });

      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const periodLabel = filterLabel(filter, fromDate, toDate);
      const generated = new Date().toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true, day: "numeric", month: "short", year: "numeric" });
      const y = await drawHeader(doc, profile.username ?? "Owner", "Summary Report", periodLabel, generated);
      drawSummaryReport(doc, y, {
        sessionCount: filteredSessions.length,
        categoryLabel,
        sales: totalIncome,
        itemsCost: totalItemsCost,
        gross: grossProfit,
        expensesTotal: totalExpenses,
        net: grossProfit - totalExpenses,
        orderCount: orders.length,
        items: sold.map(it => ({ name: it.name, qty: it.qty, revenue: it.revenue, costTotal: it.costTotal })),
        orders: orders.map(o => {
          const lines = Array.isArray(o.items) ? o.items : [];
          const collected = orderItemCollected({ ...o, items: lines });
          return {
            when: when(o.created_at, false),
            total: Number(o.total) || 0,
            discount: Number(o.discount_amount) || 0,
            lines: lines.map((item, idx) => {
              const sale = collected[idx]?.collected ?? 0;
              const cost = lineStockCost(item, costProducts);
              return { qty: Number(item.qty) || 0, name: item.name, sale, cost, profit: sale - cost };
            }),
          };
        }),
        expenses: expenses.filter(e => isNonStockExpense(e.description)).map(e => {
          const lines = (e.description ?? "").split("\n").filter(Boolean).slice(1)
            .filter(l => !l.startsWith("[Cashier:") && !l.startsWith("[Manager:"));
          const amount = Number(e.amount) || 0;
          return {
            when: when(e.created_at, true),
            label: lines.length > 0 ? lines.map(l => l.split(" = ")[0]).join(", ") : "Expense",
            amount,
            refund: amount < 0,
          };
        }),
      });
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
          <h1 className="text-xl font-black">{t("summary_title", "Summary")}</h1>
          <p className="text-xs text-slate-800 mt-0.5">{filterLabel(filter, fromDate, toDate)}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="h-7 rounded-lg border border-border bg-background px-1.5 text-[10px] font-bold outline-none focus:ring-1 focus:ring-primary max-w-[90px]"
            style={{ color: "var(--foreground)" }}>
            <option value="all">{t("all", "All")}</option>
            {storeCategories.length > 0
              ? storeCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
              : CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 font-black"
            disabled={downloading || loadingSessions} onClick={handleDownloadPdf}
            style={downloaded ? { background: "#16a34a", color: "#fff", borderColor: "#16a34a" } : {}}>
            {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : downloaded ? <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> : <Download className="h-3 w-3" />}
            {downloading ? "…" : downloaded ? t("done", "Done") : t("pdf", "PDF")}
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 rounded-2xl p-1" style={{ background: "var(--gradient-card)" }}>
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className="flex-1 h-9 rounded-xl text-xs font-black transition active:scale-[0.97]"
            style={filter === f.key ? { background: "var(--gradient-hero)", color: "#ffffff" } : { color: "#1e293b" }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Bar status badge */}
      <div className="rounded-xl px-4 py-2.5 flex items-center gap-3"
          style={{ background: barIsOpen ? "rgba(134,239,172,0.08)" : "#e2e8f0", border: `1px solid ${barIsOpen ? "rgba(134,239,172,0.25)" : "rgba(255,255,255,0.08)"}` }}>
          <span className="text-sm shrink-0">{barIsOpen ? "🟢" : "🔴"}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: barIsOpen ? "#15803d" : "var(--muted-foreground)" }}>
              {barIsOpen ? t("bar_open", "Bar Open") : t("bar_closed", "Bar Closed")}
            </p>
            <p className="text-[11px] text-slate-800">
              {filter === "week" && <><span className="font-bold text-foreground">{new Date(fromDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>{" → "}<span className="font-bold text-foreground">{new Date(toDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span></>}
              {filter === "month" && <span className="font-bold text-foreground">{new Date(fromDate + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>}
              {filter === "year" && <span className="font-bold text-foreground">{fromDate.slice(0, 4)}</span>}
              {filter === "period" && <><span className="font-bold text-foreground">{new Date(fromDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>{" → "}<span className="font-bold text-foreground">{new Date(toDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span></>}
              {filter === "day" && <span className="font-bold text-foreground">{new Date(fromDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
            </p>
          </div>
        </div>

      {/* Date pickers */}
      {filter === "day" && (
        <div className="rounded-2xl border border-border p-4 space-y-2" style={{ background: "var(--gradient-card)" }}>
          <CalendarPopover label={t("select_day", "Select Day")} value={fromDate} maxDate={today} minDate={earliestDate} onChange={v => { setFromDate(v); setToDate(v); }} />
          {!loadingSessions && (
            <p className="text-xs text-slate-800 pt-1">
              {filteredSessions.length === 0
                ? t("bar_not_open_day", "Bar was not opened this day.")
                : `${filteredSessions.length} ${filteredSessions.length !== 1 ? t("sessions_this_day", "sessions this day") : t("session_this_day", "session this day")}`}
            </p>
          )}
        </div>
      )}
      {filter === "week" && (
        <div className="rounded-2xl border border-border p-4 space-y-2" style={{ background: "var(--gradient-card)" }}>
          <CalendarPopover label={t("week_start", "Week Start")} value={fromDate} maxDate={today} minDate={earliestDate} onChange={v => setFromDate(v)} />
          <p className="text-xs text-slate-800">Period: <span className="font-black text-foreground">{new Date(fromDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })} → {new Date(toDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span></p>
        </div>
      )}
      {filter === "month" && (
        <div className="rounded-2xl border border-border p-4 space-y-3" style={{ background: "var(--gradient-card)" }}>
          <label className="text-[10px] font-black text-slate-800 uppercase tracking-widest">{t("select_month", "Select Month")}</label>
          <div className="flex gap-3">
            <select value={selMonth} onChange={e => setSelMonth(Number(e.target.value))} className="flex-1 h-11 rounded-xl border border-border bg-background px-3 text-sm font-bold outline-none">
              {(["january","february","march","april","may","june","july","august","september","october","november","december"] as const).map((m, i) => (
                <option key={i} value={i}>{t(m, ["January","February","March","April","May","June","July","August","September","October","November","December"][i])}</option>
              ))}
            </select>
            <select value={selYear} onChange={e => setSelYear(Number(e.target.value))} className="w-28 h-11 rounded-xl border border-border bg-background px-3 text-sm font-bold outline-none">
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      )}
      {filter === "year" && (
        <div className="rounded-2xl border border-border p-4 space-y-2" style={{ background: "var(--gradient-card)" }}>
          <label className="text-[10px] font-black text-slate-800 uppercase tracking-widest">{t("select_year", "Select Year")}</label>
          <div className="relative">
            <select value={selYear} onChange={e => setSelYear(Number(e.target.value))} className="w-full h-11 rounded-xl border border-border bg-background pl-4 pr-10 text-sm font-black outline-none appearance-none cursor-pointer" style={{ color: "var(--primary)" }}>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><ChevronDown className="h-4 w-4" style={{ color: "var(--primary)" }} /></div>
          </div>
        </div>
      )}
      {filter === "period" && (
        <div className="rounded-2xl border border-border p-4 space-y-3" style={{ background: "var(--gradient-card)" }}>
          <div className="grid grid-cols-2 gap-3">
            <CalendarPopover label={t("from_date", "From")} value={fromDate} minDate={earliestDate} maxDate={toDate} onChange={v => setFromDate(v)} />
            <CalendarPopover label={t("to_date", "To")}     value={toDate}   minDate={fromDate}     maxDate={today}  onChange={v => setToDate(v)}   />
          </div>
          <p className="text-xs text-slate-800">Oldest record: <span className="font-black text-foreground">{new Date(earliestDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span></p>
        </div>
      )}

      {/* Sessions list / Combined summary */}
      {loadingSessions ? (
        <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
      ) : (
        <CombinedSummaryView
          fromDate={fromDate}
          toDate={toDate}
          products={products}
          categoryFilter={categoryFilter}
          ownerId={ownerId}
          filter={filter}
          filteredSessions={filteredSessions}
        />
      )}
    </div>
  );
}
