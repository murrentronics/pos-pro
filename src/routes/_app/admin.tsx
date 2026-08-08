import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import AdminBillingManagementPage from "@/pages/AdminBillingManagementPage";
import {
  listAllProfiles,
  setUserStatus,
  adminDeleteUser,
} from "@/lib/admin.functions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Check, X, Ban, UserMinus, RotateCw, RotateCcw, Trash2, Loader2,
  ShieldAlert, Search, ImagePlus, Link as LinkIcon, LayoutGrid, CalendarClock, AlertCircle,
  Youtube, Key, BarChart3, RefreshCw, CheckCircle2, XCircle, Zap, Camera, Plus, GitBranch,
  DollarSign, TrendingUp, Calendar, History,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { confirm } from "@/components/ui/confirm-dialog";

// ─── Shareholder Config ───────────────────────────────────────────────────────
const SHAREHOLDERS = [
  { name: "Renard Sankersingh", share: 0.8, color: "text-emerald-400", bg: "border-emerald-500/30", gradient: "linear-gradient(135deg, rgba(16,185,129,0.12), rgba(16,185,129,0.04))" },
  { name: "Theron Murren",      share: 0.2, color: "text-blue-400",    bg: "border-blue-500/30",    gradient: "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(59,130,246,0.04))" },
] as const;

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

type MonthlyRecord = { year: number; month: number; total: number };
type ShareholderMonthly = { year: number; month: number; total: number; shares: number[] };

type Row = {
  id: string;
  username: string;
  email: string;
  role: string;
  status: "pending" | "approved" | "suspended" | "expelled" | "rejected";
  wallet_balance: number;
  created_at: string;
  phone: string | null;
  address: string | null;
  plan_type?: string;
  chain_bar_count?: number;
  is_bar_account?: boolean;
};

type SubPayment = {
  id: string;
  owner_id: string;
  paid_at: string;
  due_date: string;
};

// Compute next due date: 1 year after the given date, minus 1 day
function nextDueDate(fromDate: string): Date {
  const d = new Date(fromDate);
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return d;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Subscription Badge ───────────────────────────────────────────────────────
// ─── Annual Fee Badge — shown big on right of card ───────────────────────────
function AnnualFeeBadge({ ownerId }: { ownerId: string }) {
  const [amount, setAmount] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data: payments } = await supabase
        .from("billing_payments")
        .select("plan_id, amount")
        .eq("owner_id", ownerId)
        .eq("status", "paid")
        .order("created_at", { ascending: false })
        .limit(1);
      if (!payments?.length) return;
      // Use amount directly from payment row (faster, no extra query)
      if (payments[0].amount) {
        setAmount(Number(payments[0].amount));
        return;
      }
      const { data: plan } = await supabase
        .from("billing_plans")
        .select("amount")
        .eq("id", payments[0].plan_id)
        .single();
      if (plan) setAmount(plan.amount);
    })();
  }, [ownerId]);

  if (amount === null) return null;
  return (
    <div className="shrink-0 text-right self-start">
      <div className="text-2xl font-black text-white leading-none">${amount.toFixed(0)}</div>
      <div className="text-[10px] text-white/60 font-bold mt-0.5">TT / yr</div>
    </div>
  );
}

function SubscriptionBadge({ ownerId }: {
  ownerId: string;
}) {
  const [profile, setProfile] = useState<any>(null);
  const [paidCount, setPaidCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      // Get profile with subscription details
      const { data: profileData } = await supabase
        .from("profiles")
        .select("subscription_end_date, billing_status")
        .eq("id", ownerId)
        .single();
      
      // Get count of paid payments
      const { data: payments } = await supabase
        .from("billing_payments")
        .select("id, plan_id")
        .eq("owner_id", ownerId)
        .eq("status", "paid");
      
      // Get plan amount from the most recent payment
      let planAmount = 0;
      if (payments && payments.length > 0) {
        const { data: plan } = await supabase
          .from("billing_plans")
          .select("amount")
          .eq("id", payments[0].plan_id)
          .single();
        
        if (plan) planAmount = plan.amount;
      }
      
      setProfile({ ...profileData, planAmount });
      setPaidCount(payments?.length || 0);
      setLoading(false);
    };
    
    loadData();
  }, [ownerId]);

  if (loading || !profile) return null;

  const dueDate = profile.subscription_end_date ? new Date(profile.subscription_end_date) : null;
  if (!dueDate) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntil = Math.ceil((dueDate.getTime() - today.getTime()) / 86400000);
  const isNearExpiry = daysUntil <= 7;

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold ${
      isNearExpiry
        ? "bg-red-500/15 border border-red-500/30 text-red-400"
        : "bg-muted border border-border text-muted-foreground"
    }`}>
      {isNearExpiry ? (
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
      )}
      <span>
        Due {formatDate(dueDate)}{isNearExpiry && ` (${daysUntil}d)`}
      </span>
    </div>
  );
}

// ─── AdminBillingInline ───────────────────────────────────────────────────────
// Wraps AdminBillingManagementPage for embedding in the admin panel billing tab.
// Keeps the pending count in sync with the parent AdminPage for the badge.
function AdminBillingInline({ onCountChange }: { onCountChange: (n: number) => void }) {
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.from("billing_payments").select("*", { count: "exact", head: true }).eq("status", "pending")
      .then(({ count }: { count: number | null }) => onCountChange(count ?? 0));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <AdminBillingManagementPage />;
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────
export default function AdminPage() {
  const { profile, loading, signOut, user } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [nearExpiryCount, setNearExpiryCount] = useState(0);
  const [pendingBillingCount, setPendingBillingCount] = useState(0);
  const [outerTab, setOuterTab] = useState("panel");
  const [panelSubTab, setPanelSubTab] = useState("dashboard");

  // ── Shareholder income state ────────────────────────────────────────────────
  const [currentMonthIncome, setCurrentMonthIncome] = useState(0);
  const [lastMonthIncome, setLastMonthIncome] = useState(0);
  const [monthlyHistory, setMonthlyHistory] = useState<ShareholderMonthly[]>([]);
  const [incomeLoading, setIncomeLoading] = useState(true);

  useEffect(() => {
    if (!loading && profile && profile.role !== "admin") {
      // Admin-only web: sign out non-admin users
      signOut().then(() => nav("/login", { replace: true }));
    }
  }, [profile, loading, nav, signOut]);

  const refresh = async () => {
    setBusy(true);
    try {
      const data = await listAllProfiles();
      setRows((data ?? []).filter((r) => r.role === "owner") as Row[]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Calculate near-expiry count for approved users
  useEffect(() => {
    const checkNearExpiry = async () => {
      const approvedUsers = rows.filter(r => r.status === "approved");
      let count = 0;
      
      for (const user of approvedUsers) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("subscription_end_date")
          .eq("id", user.id)
          .single();
        
        if (profileData?.subscription_end_date) {
          const dueDate = new Date(profileData.subscription_end_date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const daysUntil = Math.ceil((dueDate.getTime() - today.getTime()) / 86400000);
          
          if (daysUntil <= 7) {
            count++;
          }
        }
      }
      
      setNearExpiryCount(count);
    };
    
    if (rows.length > 0) {
      checkNearExpiry();
    }
  }, [rows]);

  // ── Load shareholder income from billing_payments ──────────────────────────
  const loadShareholderIncome = useCallback(async () => {
    setIncomeLoading(true);
    try {
      // Exclude demo account from income calculations
      const { data: demoProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", "isabel@gmail.com")
        .maybeSingle();
      const demoId = demoProfile?.id;

      // Master account (renard.sankersingh@gmail.com) has no billing payments — no filtering needed
      const masterId: string | undefined = undefined;

      let query = supabase
        .from("billing_payments")
        .select("amount, approved_at")
        .eq("status", "paid")
        .not("approved_at", "is", null);

      if (demoId) query = query.neq("owner_id", demoId);
      if (masterId) query = query.neq("owner_id", masterId);

      const { data } = await query;
      const payments = (data ?? []) as { amount: number; approved_at: string }[];

      const now = new Date();
      const curYear = now.getFullYear();
      const curMonth = now.getMonth(); // 0-indexed

      // Previous month
      const lastMonthDate = new Date(curYear, curMonth - 1, 1);
      const lastYear = lastMonthDate.getFullYear();
      const lastMonth = lastMonthDate.getMonth();

      let curTotal = 0;
      let lastTotal = 0;
      const monthMap = new Map<string, number>(); // "YYYY-MM" -> total

      for (const p of payments) {
        const d = new Date(p.approved_at);
        const y = d.getFullYear();
        const m = d.getMonth();
        const amt = Number(p.amount);

        if (y === curYear && m === curMonth) curTotal += amt;
        if (y === lastYear && m === lastMonth) lastTotal += amt;

        const key = `${y}-${String(m).padStart(2, "0")}`;
        monthMap.set(key, (monthMap.get(key) ?? 0) + amt);
      }

      setCurrentMonthIncome(curTotal);
      setLastMonthIncome(lastTotal);

      // Build sorted history with shareholder splits
      const history: ShareholderMonthly[] = Array.from(monthMap.entries())
        .map(([key, total]) => {
          const [y, m] = key.split("-").map(Number);
          return {
            year: y,
            month: m,
            total,
            shares: SHAREHOLDERS.map(s => Math.round(total * s.share * 100) / 100),
          };
        })
        .sort((a, b) => b.year - a.year || b.month - a.month);

      setMonthlyHistory(history);
    } catch {
      // silent — non-critical
    } finally {
      setIncomeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    refresh();
    loadShareholderIncome();

    const ch = supabase
      .channel("admin-profiles")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "billing_payments" }, () => {
        supabase.from("billing_payments").select("*", { count: "exact", head: true }).eq("status", "pending")
          .then(({ count }) => setPendingBillingCount(count ?? 0));
        loadShareholderIncome();
      })
      .subscribe();

    // Load initial pending billing count
    supabase.from("billing_payments").select("*", { count: "exact", head: true }).eq("status", "pending")
      .then(({ count }) => setPendingBillingCount(count ?? 0));

    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role]);

  const buckets = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const MASTER_ACCOUNT_EMAILS = ["renard.sankersingh@gmail.com", "isabel@gmail.com"];
    const filtered = needle
      ? rows.filter((r) =>
          r.username.toLowerCase().includes(needle) ||
          r.email.toLowerCase().includes(needle) ||
          (r.phone ?? "").toLowerCase().includes(needle) ||
          (r.address ?? "").toLowerCase().includes(needle)
        )
      : rows;
    return {
      // Never show master account in pending — treat as approved regardless of DB status
      pending: filtered.filter((r) => r.status === "pending" && !MASTER_ACCOUNT_EMAILS.includes(r.email)),
      // Approved: hide bar sub-accounts (chain bars) — only show real account owners
      // Master account always appears in approved list
      approved: filtered.filter((r) => (r.status === "approved" || MASTER_ACCOUNT_EMAILS.includes(r.email)) && !r.is_bar_account),
      suspended: filtered.filter((r) => r.status === "suspended" && !r.is_bar_account && !MASTER_ACCOUNT_EMAILS.includes(r.email)),
      expelled: filtered.filter((r) => r.status === "expelled"),
      rejected: filtered.filter((r) => r.status === "rejected"),
    };
  }, [rows, q]);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast.success(msg); await refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };

  if (loading || !profile) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (profile.role !== "admin") return null;

  return (
    <div className="space-y-6">
      {/* Sticky page title */}
      <div className="sticky top-0 z-20 -mx-3 px-3 pt-2 pb-2 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-black leading-tight">Admin — {profile.username.charAt(0).toUpperCase() + profile.username.slice(1)}</h1>
        </div>
      </div>

      <Tabs value={outerTab} onValueChange={setOuterTab}>
        <TabsList className="grid w-full grid-cols-3">
          {(["panel","billing","users"] as const).map((key) => (
            <TabsTrigger
              key={key}
              value={key}
              className="gap-1 relative text-[10px] sm:text-xs"
              style={outerTab === key
                ? { background: "var(--gradient-hero)", color: "#fff", boxShadow: "0 2px 8px rgba(251,146,60,0.4)" }
                : { background: "transparent", boxShadow: "none", color: "var(--muted-foreground)" }
              }
            >
              {key.charAt(0).toUpperCase() + key.slice(1)}
              {key === "billing" && pendingBillingCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
                  {pendingBillingCount > 9 ? "9+" : pendingBillingCount}
                </span>
              )}
              {key === "users" && buckets.pending.length > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-orange-500 text-white text-[9px] font-black flex items-center justify-center">
                  {buckets.pending.length > 9 ? "9+" : buckets.pending.length}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Panel (Dashboard + History sub-tabs) ── */}
        <TabsContent value="panel" className="mt-4">
          <Tabs value={panelSubTab} onValueChange={setPanelSubTab}>
            <TabsList className="grid grid-cols-2 w-full mb-4">
              <TabsTrigger value="dashboard" className="gap-1.5 font-bold"
                style={panelSubTab === "dashboard"
                  ? { background: "var(--gradient-hero)", color: "#fff" }
                  : { background: "transparent", color: "var(--muted-foreground)" }
                }>
                <BarChart3 className="h-3.5 w-3.5" /> Dashboard
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5 font-bold"
                style={panelSubTab === "history"
                  ? { background: "var(--gradient-hero)", color: "#fff" }
                  : { background: "transparent", color: "var(--muted-foreground)" }
                }>
                <History className="h-3.5 w-3.5" /> History
              </TabsTrigger>
            </TabsList>

            {/* ── Dashboard Sub-tab ── */}
            <TabsContent value="dashboard" className="space-y-3 mt-0 pb-10">
              {/* Stat cards — 3 per row on all screens */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-border p-2.5 space-y-0.5" style={{ background: "var(--gradient-card)" }}>
                  <p className="text-[10px] text-muted-foreground font-medium">Pending Users</p>
                  <p className="text-2xl font-black">{buckets.pending.length}</p>
                </div>
                <div className="rounded-xl border border-border p-2.5 space-y-0.5" style={{ background: "var(--gradient-card)" }}>
                  <p className="text-[10px] text-muted-foreground font-medium">Approved Users</p>
                  <p className="text-2xl font-black text-green-400">{buckets.approved.length}</p>
                </div>
                <div className="rounded-xl border border-border p-2.5 space-y-0.5" style={{ background: "var(--gradient-card)" }}>
                  <p className="text-[10px] text-muted-foreground font-medium">Pending Payments</p>
                  <p className="text-2xl font-black text-yellow-400">{pendingBillingCount}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-border p-2.5 space-y-0.5" style={{ background: "var(--gradient-card)" }}>
                  <p className="text-[10px] text-muted-foreground font-medium">Due Soon</p>
                  <p className="text-2xl font-black text-orange-400">{nearExpiryCount}</p>
                </div>
                <div className="rounded-xl border border-border p-2.5 space-y-0.5" style={{ background: "var(--gradient-card)" }}>
                  <p className="text-[10px] text-muted-foreground font-medium">Suspended</p>
                  <p className="text-2xl font-black text-red-400">{buckets.suspended.length}</p>
                </div>
                <div className="rounded-xl border border-border p-2.5 space-y-0.5" style={{ background: "var(--gradient-card)" }}>
                  <p className="text-[10px] text-muted-foreground font-medium">Total Registered</p>
                  <p className="text-2xl font-black">{rows.filter(r => !r.is_bar_account && !["renard.sankersingh@gmail.com", "isabel@gmail.com"].includes(r.email)).length}</p>
                </div>
              </div>

              {/* ── Shareholder Income Split ── */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5 text-primary" />
                  <h2 className="text-xs font-black text-muted-foreground uppercase tracking-widest">Shareholder Income</h2>
                </div>

                {/* Total revenue row */}
                <div className="rounded-xl border border-primary/30 p-3" style={{ background: "linear-gradient(135deg, rgba(251,146,60,0.10), rgba(251,146,60,0.03))" }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-muted-foreground font-medium">Total Revenue This Month</p>
                      <p className="text-2xl font-black text-primary">
                        {incomeLoading ? "…" : `$${currentMonthIncome.toLocaleString("en", { minimumFractionDigits: 0 })}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground font-medium">Last Month</p>
                      <p className="text-lg font-black text-muted-foreground">
                        {incomeLoading ? "…" : `$${lastMonthIncome.toLocaleString("en", { minimumFractionDigits: 0 })}`}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Per-shareholder cards */}
                {SHAREHOLDERS.map((sh, idx) => (
                  <div key={sh.name} className="space-y-1.5">
                    <p className={`text-[10px] font-black uppercase tracking-widest ${sh.color}`}>
                      {sh.name} · {Math.round(sh.share * 100)}%
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className={`rounded-xl border ${sh.bg} p-3 space-y-0.5`} style={{ background: sh.gradient }}>
                        <div className="flex items-center gap-1">
                          <TrendingUp className={`h-3 w-3 ${sh.color}`} />
                          <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">This Month</p>
                        </div>
                        <p className={`text-xl font-black ${sh.color}`}>
                          {incomeLoading ? "…" : `$${Math.round(currentMonthIncome * sh.share).toLocaleString()}`}
                        </p>
                        <p className="text-[9px] text-muted-foreground">
                          {new Date().toLocaleString("en", { month: "long", year: "numeric" })}
                        </p>
                      </div>
                      <div className={`rounded-xl border ${sh.bg} p-3 space-y-0.5`} style={{ background: sh.gradient }}>
                        <div className="flex items-center gap-1">
                          <Calendar className={`h-3 w-3 ${sh.color} opacity-60`} />
                          <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">Last Month</p>
                        </div>
                        <p className={`text-xl font-black ${sh.color} opacity-70`}>
                          {incomeLoading ? "…" : `$${Math.round(lastMonthIncome * sh.share).toLocaleString()}`}
                        </p>
                        <p className="text-[9px] text-muted-foreground">
                          {(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toLocaleString("en", { month: "long", year: "numeric" }); })()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* ── History Sub-tab ── */}
            <TabsContent value="history" className="mt-0">
              {incomeLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : monthlyHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <DollarSign className="h-10 w-10 opacity-30" />
                  <p className="text-sm">No payment history yet.</p>
                </div>
              ) : (
                <Accordion type="multiple" className="space-y-2">
                  {/* Group by year */}
                  {Array.from(new Set(monthlyHistory.map(h => h.year)))
                    .sort((a, b) => b - a)
                    .map(year => {
                      const yearRecords = monthlyHistory.filter(h => h.year === year);
                      const yearTotal = yearRecords.reduce((s, r) => s + r.total, 0);
                      return (
                        <AccordionItem key={year} value={String(year)} className="rounded-2xl border border-border overflow-hidden" style={{ background: "var(--gradient-card)" }}>
                          <AccordionTrigger className="px-4 py-3 hover:no-underline">
                            <div className="flex items-center gap-3 flex-1">
                              <span className="text-lg font-black">{year}</span>
                              <Badge variant="secondary" className="font-black text-xs">
                                {yearRecords.length} month{yearRecords.length !== 1 ? "s" : ""}
                              </Badge>
                              <span className="ml-auto text-sm font-black text-primary mr-2">
                                ${yearTotal.toLocaleString("en", { minimumFractionDigits: 0 })}
                              </span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="px-0 pb-0">
                            <div className="divide-y divide-border">
                              {yearRecords
                                .sort((a, b) => b.month - a.month)
                                .map(rec => (
                                  <div key={`${rec.year}-${rec.month}`} className="px-4 py-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="font-black text-sm">{MONTH_NAMES[rec.month]}</span>
                                      <span className="font-black text-primary">${rec.total.toLocaleString("en", { minimumFractionDigits: 0 })}</span>
                                    </div>
                                    {SHAREHOLDERS.map((sh, idx) => (
                                      <div key={sh.name} className="flex items-center justify-between text-xs">
                                        <span className={`font-bold ${sh.color}`}>
                                          {sh.name.split(" ")[0]} ({Math.round(sh.share * 100)}%)
                                        </span>
                                        <span className={`font-black ${sh.color}`}>
                                          ${rec.shares[idx].toLocaleString("en", { minimumFractionDigits: 0 })}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                </Accordion>
              )}
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* ── Billing ── */}
        <TabsContent value="billing" className="mt-4">
          <AdminBillingInline onCountChange={setPendingBillingCount} />
        </TabsContent>

        {/* ── Users ── */}
        <TabsContent value="users" className="space-y-4 mt-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by username or email…"
              className="pl-9"
            />
          </div>

          <Tabs defaultValue="pending">
            <TabsList className="grid grid-cols-5 w-full">
              <TabsTrigger value="pending" className="gap-1 sm:gap-2 relative">
                <span className="hidden sm:inline">Pending</span>
                <span className="sm:hidden text-lg">⏳</span>
                {buckets.pending.length > 0 && (
                  <Badge variant="default" className="rounded-full px-1.5 py-0 text-xs min-w-[20px] h-5 flex items-center justify-center bg-red-500 text-white">
                    {buckets.pending.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="approved" className="gap-1 sm:gap-2">
                <span className="hidden sm:inline">Approved</span>
                <span className="sm:hidden text-lg">✅</span>
                {nearExpiryCount > 0 && (
                  <Badge variant="destructive" className="rounded-full px-1.5 py-0 text-xs min-w-[20px] h-5 flex items-center justify-center hidden sm:flex">
                    {nearExpiryCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="suspended" className="gap-1 sm:gap-2">
                <span className="hidden sm:inline">Suspended</span>
                <span className="sm:hidden text-lg">⛔</span>
                {buckets.suspended.length > 0 && (
                  <Badge variant="default" className="rounded-full px-1.5 py-0 text-xs min-w-[20px] h-5 flex items-center justify-center bg-orange-500 text-white">
                    {buckets.suspended.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="expelled" className="gap-1 sm:gap-2">
                <span className="hidden sm:inline">Expelled</span>
                <span className="sm:hidden text-lg">🚫</span>
              </TabsTrigger>
              <TabsTrigger value="rejected" className="gap-1 sm:gap-2">
                <span className="hidden sm:inline">Rejected</span>
                <span className="sm:hidden text-lg">✖</span>
                {buckets.rejected.length > 0 && (
                  <Badge variant="default" className="rounded-full px-1.5 py-0 text-xs min-w-[20px] h-5 flex items-center justify-center bg-red-600 text-white">
                    {buckets.rejected.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {(["pending", "approved", "suspended", "expelled", "rejected"] as const).map((k) => (
              <TabsContent key={k} value={k} className="mt-4 space-y-3">
                {buckets[k].length === 0 && (
                  <p className="text-sm text-muted-foreground py-8 text-center">No {k} users</p>
                )}
                {buckets[k].map((r) => (
                  <div key={r.id} className="flex flex-col gap-3 p-4 rounded-xl border border-border bg-card">
                    <div className="flex flex-row items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{r.username}</span>
                          {r.plan_type === "chain" && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30">
                              <GitBranch className="h-2.5 w-2.5" />
                              {(r.chain_bar_count ?? 0) <= 1
                                ? "1 Additional Store"
                                : `Multi-store · ${(r.chain_bar_count ?? 1) - 1} additional`}
                            </span>
                          )}
                          {r.is_bar_account && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                              Sub-store
                            </span>
                          )}
                        </div>
                        {r.email && (
                          <a
                            href={`mailto:${r.email}`}
                            className="text-xs text-primary hover:underline truncate block"
                            title={`Email ${r.username}`}
                          >
                            ✉ {r.email}
                          </a>
                        )}
                        {r.phone && (
                          <a
                            href={`tel:${r.phone}`}
                            className="inline-flex items-center gap-2 text-xs font-black text-black bg-primary border border-primary rounded-lg px-3 py-1.5 hover:opacity-90 transition active:scale-95"
                            title={`Call ${r.username}`}
                          >
                            📞 {r.phone}
                          </a>
                        )}
                        {r.address && (
                          <div className="text-xs text-muted-foreground">
                            📍 {r.address}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground">
                          Joined {new Date(r.created_at).toLocaleDateString("en-GB", { month: "short", day: "numeric", year: "numeric" })}
                        </div>
                      </div>
                      {/* Annual fee — fetched by SubscriptionBadge, shown big on right */}
                      {(k === "approved" || k === "suspended") && (
                        <AnnualFeeBadge ownerId={r.id} />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {k === "pending" && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">Awaiting payment approval in Billing tab</span>
                            <Button size="sm" variant="destructive" onClick={async () => {
                              const ok = await confirm({
                                title: `Delete ${r.username}?`,
                                description: "This will permanently remove this account. Cannot be undone.",
                                confirmLabel: "Delete",
                                destructive: true,
                              });
                              if (ok) act(() => adminDeleteUser(r.id), "Deleted");
                            }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                        {k === "approved" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => act(() => setUserStatus(r.id, "pending"), "Set to Pending")}
                              title="Revert to pending — user will see the select a plan page">
                              <RotateCcw className="h-4 w-4 mr-1" /> Pending
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => act(() => setUserStatus(r.id, "suspended"), "Suspended")}>
                              <Ban className="h-4 w-4 mr-1" /> Suspend
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => act(() => setUserStatus(r.id, "expelled"), "Expelled")}>
                              <UserMinus className="h-4 w-4 mr-1" /> Expel
                            </Button>
                            <Button size="sm" variant="destructive" onClick={async () => {
                              const ok = await confirm({
                                title: `Delete ${r.username}?`,
                                description: "This cannot be undone.",
                                confirmLabel: "Delete",
                                destructive: true,
                              });
                              if (ok) act(() => adminDeleteUser(r.id), "Deleted");
                            }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {k === "suspended" && (
                          <>
                            <Button size="sm" onClick={() => act(() => setUserStatus(r.id, "approved"), "Re-activated")}>
                              <RotateCw className="h-4 w-4 mr-1" /> Re-activate
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => act(() => setUserStatus(r.id, "pending"), "Reset to pending")}
                              title="Clear subscription and send back to pending">
                              <RotateCcw className="h-4 w-4 mr-1" /> Send to Pending
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => act(() => setUserStatus(r.id, "expelled"), "Expelled")}>
                              <UserMinus className="h-4 w-4 mr-1" /> Expel
                            </Button>
                            <Button size="sm" variant="destructive" onClick={async () => {
                              const ok = await confirm({
                                title: `Delete ${r.username}?`,
                                description: "This cannot be undone.",
                                confirmLabel: "Delete",
                                destructive: true,
                              });
                              if (ok) act(() => adminDeleteUser(r.id), "Deleted");
                            }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {k === "expelled" && (
                          <span className="text-xs text-muted-foreground">Account expelled - no actions available</span>
                        )}
                        {k === "rejected" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => act(() => setUserStatus(r.id, "pending"), "Reset to pending")}
                              title="Clear billing fields and allow user to re-submit payment">
                              <RotateCcw className="h-4 w-4 mr-1" /> Send to Pending
                            </Button>
                            <Button size="sm" variant="destructive" onClick={async () => {
                              const ok = await confirm({
                                title: `Delete ${r.username}?`,
                                description: "This cannot be undone.",
                                confirmLabel: "Delete",
                                destructive: true,
                              });
                              if (ok) act(() => adminDeleteUser(r.id), "Deleted");
                            }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    {/* Subscription reminder — show for approved/suspended users */}
                    {(k === "approved" || k === "suspended") && (
                      <SubscriptionBadge ownerId={r.id} />
                    )}
                  </div>
                ))}
              </TabsContent>
            ))}
          </Tabs>
          {busy && <div className="text-xs text-muted-foreground">Loading…</div>}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── YouTube Admin Panel ──────────────────────────────────────────────────────

type YtKeySlot = {
  slot: number;
  label: string;
  enabled: boolean;
  daily_limit: number;
  used_today: number;
  exhausted: boolean;
  last_used_at: string | null;
  reset_at: string | null;
};

type YtStats = {
  searches_today: number;
  successful_today: number;
  failed_today: number;
  quota_used_today: number;
  quota_remaining: number;
  active_keys: number;
  total_keys: number;
  unique_users_today: number;
};

type YtRecentSearch = {
  id: string;
  query: string;
  type: string;
  key_slot: number | null;
  success: boolean;
  error_code: string | null;
  created_at: string;
};

function YouTubeAdminPanel() {
  const [keys,    setKeys   ] = useState<YtKeySlot[]>([]);
  const [stats,   setStats  ] = useState<YtStats | null>(null);
  const [recent,  setRecent ] = useState<YtRecentSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving ] = useState<number | null>(null); // slot being saved

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [keysRes, statsRes, recentRes] = await Promise.all([
        supabase.from("youtube_api_keys").select("*").order("slot"),
        supabase.rpc("get_youtube_daily_stats").single(),
        supabase
          .from("youtube_search_log")
          .select("id, query, type, key_slot, success, error_code, created_at")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (keysRes.data)    setKeys(keysRes.data as YtKeySlot[]);
      if ((statsRes as any).data) setStats((statsRes as any).data as YtStats);
      if (recentRes.data)  setRecent(recentRes.data as YtRecentSearch[]);
    } catch (e) {
      toast.error("Failed to load YouTube stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleSlot = async (slot: number, enabled: boolean) => {
    setSaving(slot);
    const { error } = await supabase
      .from("youtube_api_keys")
      .update({ enabled })
      .eq("slot", slot);
    if (error) toast.error(error.message);
    else { toast.success(`Slot ${slot} ${enabled ? "enabled" : "disabled"}`); await load(); }
    setSaving(null);
  };

  const updateLabel = async (slot: number, label: string) => {
    setSaving(slot);
    const { error } = await supabase
      .from("youtube_api_keys")
      .update({ label })
      .eq("slot", slot);
    if (error) toast.error(error.message);
    else await load();
    setSaving(null);
  };

  const totalCapacity = keys.filter(k => k.enabled).reduce((s, k) => s + k.daily_limit, 0);
  const totalUsed     = stats?.quota_used_today ?? 0;
  const pctUsed       = totalCapacity > 0 ? (totalUsed / totalCapacity) * 100 : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Daily Summary ────────────────────────────────────────────────── */}


      {/* ── Key Pool ─────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-black text-base flex items-center gap-2">
            <Key className="h-4 w-4 text-yellow-400" />
            API Key Pool
          </h2>

        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Keys are stored as Supabase secrets <code className="text-xs bg-muted px-1 rounded">YOUTUBE_API_KEY_1</code> … <code className="text-xs bg-muted px-1 rounded">YOUTUBE_API_KEY_25</code>. Enable each slot once the secret is set.
        </p>

        <div className="space-y-2">
          {keys.map(key => {
            const pct = key.daily_limit > 0 ? (key.used_today / key.daily_limit) * 100 : 0;
            return (
              <div key={key.slot}
                className={`rounded-xl border p-3 space-y-2 transition ${
                  key.exhausted ? "border-red-500/30 bg-red-500/5"
                  : key.enabled  ? "border-green-500/20 bg-green-500/5"
                  : "border-border bg-card"
                }`}>
                <div className="flex items-center gap-3">
                  {/* Slot number */}
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
                    key.exhausted ? "bg-red-500/20 text-red-400"
                    : key.enabled  ? "bg-green-500/20 text-green-400"
                    : "bg-muted text-muted-foreground"
                  }`}>
                    {key.slot === 0 ? "★" : key.slot}
                  </div>

                  {/* Label (editable) */}
                  <Input
                    defaultValue={key.label}
                    onBlur={e => { if (e.target.value !== key.label) updateLabel(key.slot, e.target.value); }}
                    placeholder={key.slot === 0 ? "YOUTUBE_API_KEY (Primary)" : `YOUTUBE_API_KEY_${key.slot}`}
                    className="h-7 text-xs flex-1 bg-transparent border-muted"
                  />

                  {/* Status badge */}
                  {key.exhausted && (
                    <Badge variant="destructive" className="text-[10px] shrink-0">Exhausted</Badge>
                  )}

                  {/* Enable/disable toggle */}
                  <button
                    onClick={() => toggleSlot(key.slot, !key.enabled)}
                    disabled={saving === key.slot}
                    className={`h-7 px-3 rounded-lg text-xs font-bold transition shrink-0 ${
                      key.enabled
                        ? "bg-green-500/20 text-green-400 hover:bg-red-500/20 hover:text-red-400"
                        : "bg-muted text-muted-foreground hover:bg-green-500/20 hover:text-green-400"
                    }`}
                  >
                    {saving === key.slot
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : key.enabled ? "On" : "Off"
                    }
                  </button>
                </div>

                {/* Usage bar — only show when enabled */}
                {key.enabled && (
                  <div className="space-y-1">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(pct, 100)}%`,
                          background: key.exhausted ? "#ef4444" : pct > 80 ? "#eab308" : "#22c55e",
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{key.used_today.toLocaleString("en-GB")} / {key.daily_limit.toLocaleString("en-GB")}</span>
                      <span>{pct.toFixed(1)}%</span>
                      {key.last_used_at && (
                        <span>Last: {new Date(key.last_used_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Setup Guide ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 space-y-2">
        <p className="text-yellow-400 text-sm font-black flex items-center gap-2">
          <Zap className="h-4 w-4" /> Setup Checklist
        </p>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>Get a free YouTube Data API v3 key from <span className="text-primary">console.cloud.google.com</span></li>
          <li>Run: <code className="bg-muted px-1 rounded">supabase secrets set YOUTUBE_API_KEY_1=AIzaSy...</code></li>
          <li>Repeat for each key (up to YOUTUBE_API_KEY_25)</li>
          <li>Toggle each slot <span className="text-green-400 font-bold">On</span> in the table above</li>
          <li>Run: <code className="bg-muted px-1 rounded">supabase functions deploy youtube-search</code></li>
          <li>Set up daily cron: <code className="bg-muted px-1 rounded">SELECT cron.schedule('reset-youtube-keys', '0 0 * * *', 'SELECT public.reset_youtube_key_counts()')</code></li>
        </ol>
      </div>
    </div>
  );
}
