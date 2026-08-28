/**
 * BillingPage — P.O.S. Pro
 *
 * One plan: $1,800 TT/yr
 * Addon: extra store $1,200 TT/yr (pro-rated to renewal date)
 *
 * Steps:
 *   status      → active dashboard (renew, add store)
 *   choose      → plan selection (new signups / expired)
 *   addon-stores→ name each extra store
 *   payment     → cash or bank transfer
 *   confirm     → summary + submit
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  CreditCard, CheckCircle, Clock, Copy,
  ArrowLeft, Check, Plus, Store,
} from "lucide-react";
import type { BillingPlan, BillingPayment, AdminBankDetails } from "@/types/billing";

const SPECIAL_EMAIL    = "renard.sankersingh@gmail.com";
const DEMO_EMAILS      = ["isabel@gmail.com"];
const MASTER_EMAILS    = [SPECIAL_EMAIL];
const PRICE_BASE       = 1800;   // main plan /yr
const PRICE_STORE      = 1200;   // additional store /yr (full year)

type Step = "status" | "choose" | "addon-stores" | "payment" | "confirm";
type StoreEntry = { name: string; location: string };

export default function BillingPage() {
  const { profile, refreshProfile } = useAuth();

  const [plans, setPlans]         = useState<BillingPlan[]>([]);
  const [payments, setPayments]   = useState<BillingPayment[]>([]);
  const [bankDetails, setBankDetails] = useState<AdminBankDetails | null>(null);
  const [bankEnabled, setBankEnabled] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [historyPage, setHistoryPage] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);
  const HIST_SIZE = 50;

  const [step, setStep]             = useState<Step>("status");
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan | null>(null);
  const [isRenewal, setIsRenewal]   = useState(false);
  const [isAddonFlow, setIsAddonFlow] = useState(false);
  const [payMethod, setPayMethod]   = useState<"cash" | "bank" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [storeCount, setStoreCount] = useState(1);
  const [stores, setStores]         = useState<StoreEntry[]>([{ name: "", location: "" }]);

  useEffect(() => { loadAll(); }, [profile?.id]);
  useEffect(() => { if (profile?.id) loadPayments(); }, [historyPage]);

  useEffect(() => {
    if (!profile?.id) return;
    const ch = supabase
      .channel(`billing-rt-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "billing_payments", filter: `owner_id=eq.${profile.id}` },
        async (payload: any) => {
          await Promise.all([refreshProfile(), loadPayments()]);
          if (payload.new?.status === "paid") setStep("status");
          else if (payload.new?.status === "pending") setStep("status");
        }
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${profile.id}` },
        async (payload: any) => {
          await Promise.all([refreshProfile(), loadPayments()]);
          const bs = payload.new?.billing_status;
          const st = payload.new?.status;
          if (bs === "active" || st === "approved") setStep("status");
          else if (bs === "pending_setup" || st === "pending") setStep("choose");
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile?.id]);

  useEffect(() => {
    if (plans.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const upgrade = params.get("upgrade");
    if (!upgrade) return;
    const plan = plans.find(p => p.plan_type === upgrade);
    if (plan) {
      setSelectedPlan(plan); setIsRenewal(false); setIsAddonFlow(false); setStep("payment");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [plans]);

  const loadAll = async () => {
    await Promise.all([loadPlans(), loadPayments(), loadBankDetails(), loadFlags()]);
    const { data } = await supabase.auth.getUser();
    setUserEmail(data?.user?.email ?? "");
  };
  const loadPlans = async () => {
    const { data } = await supabase.from("billing_plans").select("*")
      .not("name", "ilike", "[Archived]%").order("amount");
    setPlans((data ?? []) as BillingPlan[]);
  };
  const loadPayments = async () => {
    if (!profile?.id) return;
    const { count } = await supabase.from("billing_payments")
      .select("*", { count: "exact", head: true }).eq("owner_id", profile.id);
    setHistoryTotal(count ?? 0);
    const { data } = await supabase.from("billing_payments").select("*")
      .eq("owner_id", profile.id).order("created_at", { ascending: false })
      .range(historyPage * HIST_SIZE, (historyPage + 1) * HIST_SIZE - 1);
    setPayments((data ?? []) as BillingPayment[]);
  };
  const loadBankDetails = async () => {
    const { data } = await supabase.from("admin_bank_details").select("*").eq("is_active", true).single();
    if (data) setBankDetails(data as AdminBankDetails);
  };
  const loadFlags = async () => {
    const { data } = await supabase.from("feature_flags").select("enabled")
      .eq("flag_name", "bank_transfer_enabled").single();
    if (data) setBankEnabled(data.enabled);
  };

  const copy = (t: string) => { navigator.clipboard.writeText(t); toast.success("Copied"); };

  const reset = () => {
    setStep("status"); setSelectedPlan(null);
    setIsRenewal(false); setIsAddonFlow(false); setPayMethod(null);
    setStoreCount(1); setStores([{ name: "", location: "" }]);
  };

  const cancelPending = async () => {
    if (!pendingPayment) return;
    setSubmitting(true);
    await supabase.from("billing_payments").delete().eq("id", pendingPayment.id).eq("status", "pending");
    setSubmitting(false);
    toast.success("Payment cancelled");
    reset(); loadPayments();
  };

  // ── Pro-rata calculation for extra stores ──────────────────────────────
  // New stores align to the main plan's renewal date.
  // Charge only the fraction of the year remaining.
  const planEndDate: Date | null = profile?.subscription_end_date
    ? new Date(profile.subscription_end_date) : null;
  const daysRemaining = planEndDate
    ? Math.min(365, Math.max(0, Math.ceil((planEndDate.getTime() - Date.now()) / 86400000)))
    : 365;
  const proRataFraction = planEndDate ? daysRemaining / 365 : 1;
  const proRataStorePrice = Math.round(PRICE_STORE * proRataFraction);

  const submitPayment = async () => {
    if (!profile?.id || !selectedPlan || !payMethod) return;
    setSubmitting(true);
    const { data: ref, error: refErr } = await supabase.rpc("generate_payment_reference");
    if (refErr) { toast.error("Failed to generate reference"); setSubmitting(false); return; }

    const amount = isAddonFlow
      ? proRataStorePrice * storeCount
      : PRICE_BASE;

    const notesParts: string[] = [];
    if (isAddonFlow) {
      const breakdown = daysRemaining < 365
        ? `${storeCount} extra store${storeCount > 1 ? "s" : ""} @ $${proRataStorePrice} TT each (pro-rated: ${daysRemaining}d of 365d, full $${PRICE_STORE}/yr)`
        : `${storeCount} extra store${storeCount > 1 ? "s" : ""} @ $${PRICE_STORE} TT each`;
      notesParts.push(breakdown);
    }

    let dueDate = new Date();
    if (isRenewal && profile.subscription_end_date) {
      dueDate = new Date(profile.subscription_end_date);
    } else if (isAddonFlow && planEndDate) {
      dueDate = planEndDate; // addon expires with main plan
    }
    dueDate.setMonth(dueDate.getMonth() + (isAddonFlow ? 0 : selectedPlan.duration_months));

    const insertData: Record<string, unknown> = {
      owner_id: profile.id, plan_id: selectedPlan.id,
      reference_number: ref, amount,
      due_date: dueDate.toISOString(), status: "pending",
      payment_method: payMethod,
      notes: notesParts.join(" • ") || null,
    };
    if (isAddonFlow && stores.length > 0) {
      insertData.addon_bar_count = storeCount;
      insertData.addon_bar_data  = stores.slice(0, storeCount).map(s => ({ ...s, type: "bar" }));
    }

    const { error } = await supabase.from("billing_payments").insert(insertData as any);
    setSubmitting(false);
    if (error) { toast.error("Failed to submit payment"); return; }
    toast.success("Payment submitted — awaiting admin confirmation");
    reset(); loadPayments();
  };

  // ── Derived state ─────────────────────────────────────────────────────
  const pendingPayment = payments.find(p => p.status === "pending");
  const hasActive      = profile?.billing_status === "active";
  const isSpecial      = userEmail === SPECIAL_EMAIL;

  // The single main plan from DB (plan_type = "basic")
  const mainPlan      = plans.find(p => p.plan_type === "basic") ?? null;
  const addonPlan     = plans.find(p => p.plan_type === "bar_only_addon") ?? null;

  // Subscription dates
  const subEnd       = profile?.subscription_end_date ? new Date(profile.subscription_end_date) : null;
  const daysLeft     = subEnd ? Math.ceil((subEnd.getTime() - Date.now()) / 86400000) : null;
  const isOverdue    = subEnd ? subEnd < new Date() : false;
  const canRenew     = isOverdue || (daysLeft !== null && daysLeft <= 7);

  // Total annual renewal = main plan + extra stores × per-store price
  const extraStores      = profile?.addon_bar_count ?? 0;
  const totalRenewal     = PRICE_BASE + extraStores * PRICE_STORE;
  const renewalBreakdown = extraStores > 0
    ? `$${PRICE_BASE.toLocaleString()} plan + ${extraStores}×$${PRICE_STORE.toLocaleString()} extra store${extraStores > 1 ? "s" : ""}`
    : "";

  const isNewSignup    = !pendingPayment && profile?.status === "pending" && profile?.billing_status !== "expired";
  const isExpiredRenew = !pendingPayment && profile?.status === "pending" && profile?.billing_status === "expired";
  const histPages      = Math.max(1, Math.ceil(historyTotal / HIST_SIZE));

  // ── Payment summary for confirm step ──────────────────────────────────
  const confirmAmount = isAddonFlow
    ? proRataStorePrice * storeCount
    : PRICE_BASE;
  const confirmLabel = isAddonFlow
    ? `${storeCount} extra store${storeCount > 1 ? "s" : ""} (pro-rated)`
    : isRenewal ? "Subscription renewal" : "P.O.S. Pro — Annual Plan";

  // ── Free / master accounts ─────────────────────────────────────────────
  if (DEMO_EMAILS.includes(userEmail)) return (
    <div className="pb-24 max-w-2xl mx-auto">
      <div className="-mx-3 px-3 pt-2 pb-2 bg-background border-b border-border mb-6">
        <div className="flex items-center gap-3"><CreditCard className="h-5 w-5 text-primary" /><h1 className="text-lg font-black">Billing</h1></div>
      </div>
      <div className="rounded-2xl border border-emerald-500/30 p-6 text-center space-y-3" style={{ background: "linear-gradient(135deg,rgba(16,185,129,0.12),rgba(16,185,129,0.04))" }}>
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 border border-emerald-500/40 mx-auto">
          <CheckCircle className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="text-xl font-black text-emerald-400">Free Demo Account</h2>
        <p className="text-sm text-muted-foreground">Permanent demo — no billing required.</p>
      </div>
    </div>
  );
  if (MASTER_EMAILS.includes(userEmail)) return (
    <div className="pb-24 max-w-2xl mx-auto">
      <div className="-mx-3 px-3 pt-2 pb-2 bg-background border-b border-border mb-6">
        <div className="flex items-center gap-3"><CreditCard className="h-5 w-5 text-primary" /><h1 className="text-lg font-black">Billing</h1></div>
      </div>
      <div className="rounded-2xl border border-primary/30 p-6 text-center space-y-3" style={{ background: "linear-gradient(135deg,rgba(0,180,255,0.12),rgba(0,180,255,0.04))" }}>
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/20 border border-primary/40 mx-auto">
          <CheckCircle className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-black text-primary">Master Account — Free Access</h2>
        <p className="text-sm text-muted-foreground">No billing required.</p>
      </div>
    </div>
  );

  return (
    <div className="pb-24 max-w-2xl mx-auto">

      {/* ── Header ── */}
      <div className="-mx-3 px-3 pt-2 pb-2 bg-background border-b border-border mb-6">
        <div className="flex items-center gap-3">
          {step !== "status" && (
            <button onClick={reset} className="h-8 w-8 rounded-full flex items-center justify-center bg-muted active:scale-90 transition">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <CreditCard className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-black">
            {step === "status"       ? "Billing"
            : step === "choose"      ? "Choose Your Plan"
            : step === "addon-stores"? "Add Extra Store"
            : step === "payment"     ? "Payment Method"
            :                          "Confirm Payment"}
          </h1>
        </div>
        {step !== "status" && (
          <div className="flex items-center gap-1.5 mt-2 ml-10">
            {(step === "addon-stores" ? ["addon-stores","payment","confirm"] : ["choose","payment","confirm"] as Step[]).map((s) => (
              <div key={s} className={`h-2 rounded-full transition-all ${s === step ? "w-6 bg-primary" : "w-2 bg-muted"}`} />
            ))}
          </div>
        )}
      </div>

      {/* ═══ STEP: STATUS ═══ */}
      {step === "status" && (
        <div className="space-y-4">

          {/* Pending payment banner */}
          {pendingPayment && (
            <div className="rounded-2xl border border-yellow-400/50 bg-yellow-50 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-yellow-600 shrink-0" />
                <div>
                  <p className="font-black text-yellow-800">Payment Pending</p>
                  <p className="text-xs text-yellow-700 mt-0.5">
                    {plans.find(p => p.id === pendingPayment.plan_id)?.name ?? "Plan"} — ${pendingPayment.amount.toFixed(0)} TT
                  </p>
                </div>
              </div>
              <div className="bg-white rounded-xl p-3 flex items-center justify-between gap-3 border border-yellow-200">
                <div>
                  <p className="text-xs text-gray-500">Reference number</p>
                  <p className="font-black font-mono text-base text-gray-900">{pendingPayment.reference_number}</p>
                </div>
                <button onClick={() => copy(pendingPayment.reference_number)}
                  className="h-9 w-9 rounded-xl bg-blue-100 flex items-center justify-center active:scale-90 transition">
                  <Copy className="h-4 w-4 text-blue-700" />
                </button>
              </div>
              {pendingPayment.payment_method === "bank" && bankDetails && (
                <div className="bg-white rounded-xl p-3 border border-yellow-200 text-xs space-y-1">
                  {[["Bank", bankDetails.bank_name],["Account", bankDetails.account_name],["Number", bankDetails.account_number]].map(([l,v]) => (
                    <div key={l} className="flex justify-between">
                      <span className="text-gray-500">{l}</span>
                      <span className="font-bold text-gray-800">{v}</span>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={cancelPending} disabled={submitting}
                className="w-full h-10 rounded-xl text-sm font-bold text-red-600 bg-red-50 border border-red-200 active:scale-[0.98] transition disabled:opacity-50">
                Cancel Payment
              </button>
            </div>
          )}

          {/* Active subscription */}
          {hasActive && !pendingPayment && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: "var(--gradient-hero)" }}>
                    <CreditCard className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-black text-foreground text-sm">P.O.S. Pro</p>
                    <p className="font-black text-base" style={{ color: "var(--primary)" }}>
                      ${totalRenewal.toLocaleString()} TT / year
                    </p>
                    {extraStores > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        ${PRICE_BASE.toLocaleString()} plan + {extraStores}×${PRICE_STORE.toLocaleString()} store{extraStores !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                </div>
                <span className={`text-xs font-black px-2.5 py-1 rounded-full ${isOverdue ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"}`}>
                  {isOverdue ? "OVERDUE" : "ACTIVE"}
                </span>
              </div>
              {extraStores > 0 && (
                <p className="text-xs text-muted-foreground">
                  {extraStores + 1} store{extraStores + 1 !== 1 ? "s" : ""} total
                </p>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Renews</span>
                <span className={`font-bold ${isOverdue ? "text-red-500" : daysLeft !== null && daysLeft <= 30 ? "text-yellow-500" : "text-foreground"}`}>
                  {subEnd ? subEnd.toLocaleDateString("en-GB") : "—"}
                  {daysLeft !== null && !isOverdue && daysLeft <= 30 && ` (${daysLeft}d)`}
                </span>
              </div>
              {!isSpecial && (
                canRenew ? (
                  <button
                    onClick={() => { setSelectedPlan(mainPlan!); setIsRenewal(true); setIsAddonFlow(false); setStep("payment"); }}
                    disabled={!mainPlan}
                    className="w-full h-11 rounded-xl font-black text-sm text-white active:scale-[0.98] transition disabled:opacity-50"
                    style={{ background: isOverdue ? "#ef4444" : "var(--gradient-hero)" }}
                  >
                    {isOverdue ? `⚠️ Renew Now — $${totalRenewal.toLocaleString()} TT` : `Renew — $${totalRenewal.toLocaleString()} TT`}
                  </button>
                ) : (
                  <p className="text-xs text-center text-muted-foreground">Renewal available 7 days before due date</p>
                )
              )}
            </div>
          )}

          {/* Add New Store card */}
          {hasActive && !pendingPayment && !isSpecial && (
            <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-card p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Store className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-black text-foreground text-sm">Add New Store</p>
                  <p className="text-xs text-muted-foreground">
                    ${proRataStorePrice.toLocaleString()} TT
                    {daysRemaining < 365 ? ` (pro-rated — ${daysRemaining}d remaining)` : " / yr"}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Each additional store gets its own inventory, cashiers, and wallet. All stores appear in Switch Store from the menu. Full price ${PRICE_STORE.toLocaleString()} TT/yr per store, renews together with your main plan.
              </p>
              <button
                onClick={() => {
                  setIsAddonFlow(true); setIsRenewal(false);
                  setSelectedPlan(addonPlan ?? mainPlan);
                  setStoreCount(1); setStores([{ name: "", location: "" }]);
                  setStep("addon-stores");
                }}
                className="w-full h-11 rounded-xl font-black text-sm text-white active:scale-[0.98] transition"
                style={{ background: "var(--gradient-hero)" }}
              >
                <Plus className="inline h-4 w-4 mr-1" />
                Add Store — ${proRataStorePrice.toLocaleString()} TT
              </button>
            </div>
          )}

          {/* New signup / expired */}
          {(isNewSignup || isExpiredRenew) && !pendingPayment && !hasActive && (
            <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-4 shadow-sm">
              <div className="h-14 w-14 rounded-full flex items-center justify-center mx-auto" style={{ background: "var(--gradient-hero)" }}>
                <CreditCard className="h-7 w-7 text-white" />
              </div>
              <div>
                <h2 className="font-black text-foreground text-lg">
                  {isExpiredRenew ? "Subscription Expired" : "Get Started"}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {isExpiredRenew ? "Renew to restore full access." : "Activate your P.O.S. Pro account."}
                </p>
              </div>
              <button onClick={() => setStep("choose")}
                className="w-full h-12 rounded-xl font-black text-base text-white active:scale-[0.98] transition"
                style={{ background: "var(--gradient-hero)" }}>
                {isExpiredRenew ? "Renew Subscription →" : "View Plan →"}
              </button>
            </div>
          )}

          {/* Payment history */}
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="font-black text-foreground">Payment History</h3>
            </div>
            {payments.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">No payments yet</p>
            ) : (
              <div className="divide-y divide-border">
                {payments.map(p => {
                  const plan = plans.find(x => x.id === p.plan_id);
                  return (
                    <div key={p.id} className="px-5 py-4 flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-foreground">{plan?.name ?? "Plan"}</p>
                        <p className="font-mono text-xs text-muted-foreground mt-0.5">{p.reference_number}</p>
                        {p.notes && <p className="text-xs font-semibold mt-0.5" style={{ color: "#1e3a5f" }}>{p.notes}</p>}
                        <p className="text-xs text-muted-foreground mt-0.5">{new Date(p.created_at).toLocaleDateString("en-GB")}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-black text-foreground">${p.amount.toFixed(0)} TT</p>
                        <span className={`text-xs font-bold ${p.status === "paid" ? "text-green-500" : p.status === "pending" ? "text-yellow-500" : "text-red-500"}`}>
                          {p.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {histPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border">
                <button disabled={historyPage === 0} onClick={() => setHistoryPage(p => p - 1)} className="text-xs font-bold text-primary disabled:text-muted-foreground">← Prev</button>
                <span className="text-xs text-muted-foreground">{historyPage + 1} / {histPages}</span>
                <button disabled={historyPage >= histPages - 1} onClick={() => setHistoryPage(p => p + 1)} className="text-xs font-bold text-primary disabled:text-muted-foreground">Next →</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ STEP: CHOOSE ═══ */}
      {step === "choose" && (
        <div className="space-y-4">
          <p className="text-center text-muted-foreground text-sm">One flat annual fee. No hidden charges.</p>
          <div className="rounded-2xl border-2 border-primary bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl flex items-center justify-center" style={{ background: "var(--gradient-hero)" }}>
                <CreditCard className="h-6 w-6 text-white" />
              </div>
              <div>
                <h3 className="font-black text-foreground text-xl">P.O.S. Pro</h3>
                <p className="text-muted-foreground text-sm">Everything you need to run your business</p>
              </div>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-muted-foreground text-lg">$</span>
              <span className="text-5xl font-black text-primary">1,800</span>
              <span className="text-muted-foreground">/yr TT</span>
            </div>
            <ul className="space-y-2">
              {["Full POS register","Unlimited products & categories","Cashier wallets & management","Credit accounts","Specials & bundle deals","Summary reports & PDFs","Real-time sync"].map(f => (
                <li key={f} className="flex items-center gap-2 text-sm text-foreground">
                  <Check className="h-4 w-4 text-primary shrink-0" /> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => { setSelectedPlan(mainPlan!); setIsRenewal(false); setIsAddonFlow(false); setStep("payment"); }}
              disabled={!mainPlan}
              className="w-full h-12 rounded-xl font-black text-base text-white active:scale-[0.98] transition disabled:opacity-50"
              style={{ background: "var(--gradient-hero)" }}
            >
              Get Started — $1,800 TT/yr
            </button>
          </div>
          <div className="rounded-2xl border border-dashed border-primary/30 bg-card p-4 text-center">
            <p className="text-xs text-muted-foreground">
              Need multiple locations? Add extra stores at <span className="font-black text-primary">${PRICE_STORE.toLocaleString()} TT/yr each</span> after activation.
            </p>
          </div>
        </div>
      )}

      {/* ═══ STEP: ADDON-STORES ═══ */}
      {step === "addon-stores" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-primary/30 bg-card p-4">
            <p className="text-xs text-muted-foreground">
              Each store has its own inventory, cashiers &amp; wallet. Pro-rated to your renewal date ({subEnd?.toLocaleDateString("en-GB") ?? "—"}).
              {daysRemaining < 365 && (
                <span className="text-primary font-bold"> Charged ${proRataStorePrice.toLocaleString()} TT per store ({daysRemaining} days remaining).</span>
              )}
            </p>
          </div>

          {/* Store count */}
          <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
            <p className="font-black text-foreground text-sm">How many extra stores?</p>
            <div className="flex items-center gap-3">
              <button onClick={() => setStoreCount(Math.max(1, storeCount - 1))}
                className="h-10 w-10 rounded-xl bg-muted font-black text-foreground active:scale-90 transition text-lg">−</button>
              <span className="text-2xl font-black text-foreground w-8 text-center">{storeCount}</span>
              <button onClick={() => { setStoreCount(c => c + 1); setStores(s => [...s, { name: "", location: "" }]); }}
                className="h-10 w-10 rounded-xl font-black text-white active:scale-90 transition text-lg" style={{ background: "var(--gradient-hero)" }}>+</button>
              <span className="text-sm text-muted-foreground ml-2">= <span className="font-black text-primary">${(proRataStorePrice * storeCount).toLocaleString()} TT</span></span>
            </div>
          </div>

          {/* Store details */}
          {Array.from({ length: storeCount }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <p className="font-black text-foreground text-sm">Store {i + 1}</p>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Store name</label>
                <input
                  className="w-full rounded-xl border border-border bg-background text-foreground px-3 h-10 text-sm"
                  placeholder="e.g. Downtown Branch"
                  value={stores[i]?.name ?? ""}
                  onChange={e => { const s = [...stores]; s[i] = { ...(s[i] ?? { name: "", location: "" }), name: e.target.value }; setStores(s); }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Location / address</label>
                <input
                  className="w-full rounded-xl border border-border bg-background text-foreground px-3 h-10 text-sm"
                  placeholder="e.g. 45 High St, San Fernando"
                  value={stores[i]?.location ?? ""}
                  onChange={e => { const s = [...stores]; s[i] = { ...(s[i] ?? { name: "", location: "" }), location: e.target.value }; setStores(s); }}
                />
              </div>
            </div>
          ))}

          <button
            onClick={() => setStep("payment")}
            disabled={stores.slice(0, storeCount).some(s => !s.name.trim())}
            className="w-full h-12 rounded-xl font-black text-base text-white active:scale-[0.98] transition disabled:opacity-40"
            style={{ background: "var(--gradient-hero)" }}
          >
            Continue — ${(proRataStorePrice * storeCount).toLocaleString()} TT →
          </button>
        </div>
      )}

      {/* ═══ STEP: PAYMENT ═══ */}
      {step === "payment" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">{confirmLabel}</p>
            <p className="text-3xl font-black text-primary mt-1">${confirmAmount.toLocaleString()} <span className="text-base font-normal text-muted-foreground">TT</span></p>
            {isAddonFlow && daysRemaining < 365 && (
              <p className="text-xs text-muted-foreground mt-1">
                Pro-rated: {daysRemaining}d of 365d · full price ${PRICE_STORE.toLocaleString()}/yr per store · renews with your plan on {subEnd?.toLocaleDateString("en-GB")}
              </p>
            )}
          </div>

          <p className="font-black text-foreground text-sm px-1">How will you pay?</p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setPayMethod("cash")}
              className={`h-20 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 active:scale-95 transition ${payMethod === "cash" ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
              <span className="text-2xl">💵</span>
              <span className={`text-sm font-black ${payMethod === "cash" ? "text-primary" : "text-foreground"}`}>Cash</span>
            </button>
            {bankEnabled && (
              <button onClick={() => setPayMethod("bank")}
                className={`h-20 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 active:scale-95 transition ${payMethod === "bank" ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
                <span className="text-2xl">🏦</span>
                <span className={`text-sm font-black ${payMethod === "bank" ? "text-primary" : "text-foreground"}`}>Bank Transfer</span>
              </button>
            )}
          </div>

          {payMethod === "bank" && bankDetails && (
            <div className="rounded-2xl border border-border bg-card p-4 space-y-2 text-sm">
              <p className="font-black text-foreground">Bank Details</p>
              {([["Bank", bankDetails.bank_name],["Account Name", bankDetails.account_name],["Account Number", bankDetails.account_number],bankDetails.branch ? ["Branch", bankDetails.branch] : null] as ([string,string]|null)[]).filter((x): x is [string,string] => x !== null).map(([l,v]) => (
                <div key={l} className="flex justify-between">
                  <span className="text-muted-foreground">{l}</span>
                  <span className="font-bold text-foreground">{v}</span>
                </div>
              ))}
              {bankDetails.instructions && <p className="text-xs text-muted-foreground border-t border-border pt-2 mt-1">{bankDetails.instructions}</p>}
            </div>
          )}

          <button
            onClick={() => setStep("confirm")}
            disabled={!payMethod}
            className="w-full h-12 rounded-xl font-black text-base text-white active:scale-[0.98] transition disabled:opacity-40"
            style={{ background: "var(--gradient-hero)" }}
          >
            Continue →
          </button>
        </div>
      )}

      {/* ═══ STEP: CONFIRM ═══ */}
      {step === "confirm" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
            <h3 className="font-black text-foreground">Payment Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Plan</span><span className="font-bold text-foreground">{confirmLabel}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Method</span><span className="font-bold text-foreground capitalize">{payMethod}</span></div>
              {isAddonFlow && daysRemaining < 365 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Pro-rated ({daysRemaining}d remaining)</span>
                  <span className="font-bold text-primary">${proRataStorePrice.toLocaleString()} × {storeCount}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-2">
                <span className="font-black text-foreground">Total Due</span>
                <span className="font-black text-primary text-lg">${confirmAmount.toLocaleString()} TT</span>
              </div>
            </div>
          </div>

          {isAddonFlow && (
            <div className="rounded-2xl border border-border bg-card p-4 space-y-2 text-xs text-muted-foreground">
              <p className="font-black text-foreground text-sm">Stores being added</p>
              {stores.slice(0, storeCount).map((s, i) => (
                <div key={i} className="flex justify-between">
                  <span className="font-bold text-foreground">{s.name}</span>
                  <span>{s.location}</span>
                </div>
              ))}
              <p className="pt-1 text-primary">Stores will appear after admin approval. Renews with your main plan.</p>
            </div>
          )}

          <p className="text-xs text-center text-muted-foreground px-4">
            After submitting, an admin will verify your payment and activate your account. You'll be notified in the app.
          </p>

          <button
            onClick={submitPayment}
            disabled={submitting}
            className="w-full h-12 rounded-xl font-black text-base text-white active:scale-[0.98] transition disabled:opacity-50"
            style={{ background: "var(--gradient-hero)" }}
          >
            {submitting ? "Submitting…" : `Submit Payment — $${confirmAmount.toLocaleString()} TT`}
          </button>
        </div>
      )}

    </div>
  );
}
