import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Loader2, ShoppingCart, User, Package, Wallet, Users, ShieldAlert, Ban, UserMinus, Menu, X, Receipt, TrendingDown, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useChain } from "@/lib/ChainContext";
import { openCashDrawer, type CashDrawerResult } from "@/lib/cashDrawer";
import { BarcodeScannerModal } from "@/components/BarcodeScannerModal";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { session, profile, loading, signOut } = useAuth();
  const { effectiveOwnerId } = useChain();
  const nav = useNavigate();
  const loc = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Store session state (owner/manager — for the open/close toggle) ─────────
  const [storeSessionStart, setStoreSessionStart] = useState<string | null>(null);
  const [storeClosedAt,     setStoreClosedAt]     = useState<string | null>(null);
  const [storeToggleBusy,   setStoreToggleBusy]   = useState(false);
  const storeIsOpen = !!storeSessionStart && !storeClosedAt;

  // ── Cash Drawer state ──────────────────────────────────────────────────────
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [showDrawerModal, setShowDrawerModal] = useState(false);
  const [drawerResult, setDrawerResult] = useState<CashDrawerResult | null>(null);

  // ── Barcode Scanner state ──────────────────────────────────────────────────
  const [showScannerModal, setShowScannerModal] = useState(false);

  useEffect(() => {
    const openHandler = () => setShowScannerModal(true);
    window.addEventListener("pospro-open-scanner", openHandler);
    return () => window.removeEventListener("pospro-open-scanner", openHandler);
  }, []);

  const handleOpenCashDrawer = async () => {
    setDrawerBusy(true);
    setShowDrawerModal(true);
    setDrawerResult(null);
    const result = await openCashDrawer();
    setDrawerResult(result);
    setDrawerBusy(false);
  };

  // ── Open Store modal ──────────────────────────────────────────────────────
  const [showOpenStoreModal,  setShowOpenStoreModal]  = useState(false);
  const [openStoreFloat,      setOpenStoreFloat]      = useState("");
  const [showCloseStoreConfirm, setShowCloseStoreConfirm] = useState(false);

  const handleStoreFloatNumpad = (k: string) => {
    if (k === "⌫") { setOpenStoreFloat((v) => v.slice(0, -1)); return; }
    setOpenStoreFloat((v) => v === "0" || v === "" ? k : v + k);
  };

  useEffect(() => {
    if (!loading && !session) nav({ to: "/login" });
  }, [session, loading, nav]);

  useEffect(() => {
    if (!loading && session && !profile) {
      const t = setTimeout(() => {
        signOut().then(() => nav({ to: "/login" }));
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [loading, session, profile, nav, signOut]);

  useEffect(() => {
    if (!loading && profile?.role === "admin" && !loc.pathname.startsWith("/admin")) {
      nav({ to: "/admin" as "/" });
    }
  }, [loading, profile, loc.pathname, nav]);

  useEffect(() => {
    const isMgr = profile?.role === "manager" || (profile as { job_title?: string })?.job_title === "manager";
    if (!loading && isMgr && loc.pathname === "/register") {
      nav({ to: "/products" as "/" });
    }
  }, [loading, profile, loc.pathname, nav]);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);

  // Load store session state for owner/manager open-close toggle
  useEffect(() => {
    const isMgr = profile?.role === "manager" || (profile as { job_title?: string })?.job_title === "manager";
    if (!profile || (profile.role !== "owner" && !isMgr)) return;
    const ownerId = effectiveOwnerId(isMgr ? (profile.parent_id ?? profile.id) : profile.id);
    if (!ownerId) return;

    supabase
      .from("profiles")
      .select("store_session_start, store_closed_at")
      .eq("id", ownerId)
      .single()
      .then(({ data }) => {
        setStoreSessionStart(data?.store_session_start ?? null);
        setStoreClosedAt(data?.store_closed_at ?? null);
      });

    const ch = supabase
      .channel(`store-session-layout-${ownerId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${ownerId}` },
        (payload) => {
          const rec = payload.new as Record<string, unknown>;
          if ("store_session_start" in rec) setStoreSessionStart((rec.store_session_start as string | null) ?? null);
          if ("store_closed_at"     in rec) setStoreClosedAt((rec.store_closed_at as string | null) ?? null);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile?.id, profile?.parent_id, profile?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenStore = () => {
    setOpenStoreFloat("");
    setShowOpenStoreModal(true);
  };

  const confirmOpenStore = async () => {
    const isMgr = profile?.role === "manager" || (profile as { job_title?: string })?.job_title === "manager";
    if (!profile || (profile.role !== "owner" && !isMgr)) return;
    const ownerId = effectiveOwnerId(isMgr ? (profile.parent_id ?? profile.id) : profile.id);
    const floatVal = parseInt(openStoreFloat, 10);
    if (isNaN(floatVal) || floatVal < 0) { toast.error("Enter a valid store float amount"); return; }

    setStoreToggleBusy(true);
    setShowOpenStoreModal(false);

    // Guard: no double-open
    const { data: existing } = await supabase
      .from("store_sessions")
      .select("id")
      .eq("owner_id", ownerId)
      .is("closed_at", null)
      .limit(1)
      .maybeSingle();
    if (existing) {
      setStoreToggleBusy(false);
      toast.error("Store is already open — close the current session first");
      return;
    }

    const now = new Date().toISOString();

    // 1. Stamp profiles
    const { error } = await supabase
      .from("profiles")
      .update({
        store_session_start: now,
        store_closed_at: null,
        cashier_float: floatVal,
        cashier_float_set_at: now,
      })
      .eq("id", ownerId);
    if (error) { setStoreToggleBusy(false); toast.error("Failed to open store: " + error.message); return; }

    // 2. Insert store_sessions row
    const { data: newSession } = await supabase
      .from("store_sessions")
      .insert({ owner_id: ownerId, opened_at: now })
      .select("id")
      .single();

    // 3. Insert store_sub_sessions row
    if (newSession?.id) {
      await supabase.from("store_sub_sessions").insert({
        owner_id: ownerId,
        store_session_id: newSession.id,
        opened_at: now,
        cashier_float: floatVal,
      });
    }

    setStoreToggleBusy(false);
    setStoreSessionStart(now);
    setStoreClosedAt(null);
    toast.success("🟢 Store opened");
  };

  const handleCloseStore = async () => {
    const isMgr = profile?.role === "manager" || (profile as { job_title?: string })?.job_title === "manager";
    if (!profile || (profile.role !== "owner" && !isMgr)) return;
    const ownerId = effectiveOwnerId(isMgr ? (profile.parent_id ?? profile.id) : profile.id);

    setStoreToggleBusy(true);
    const now = new Date().toISOString();

    await supabase.from("store_sub_sessions")
      .update({ closed_at: now })
      .eq("owner_id", ownerId)
      .is("closed_at", null);

    await supabase.from("store_sessions")
      .update({ closed_at: now })
      .eq("owner_id", ownerId)
      .is("closed_at", null);

    const { error } = await supabase
      .from("profiles")
      .update({ store_closed_at: now })
      .eq("id", ownerId);

    setStoreToggleBusy(false);
    if (error) { toast.error("Failed to close store: " + error.message); return; }
    setStoreClosedAt(now);
    toast.success("🔴 Store closed");
  };

  if (loading || !session || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const isOwner   = profile.role === "owner";
  const isAdmin   = profile.role === "admin";
  const isManager = profile.role === "manager" || (profile as { job_title?: string }).job_title === "manager";

  if (!isAdmin) {
    if (profile.status === "rejected") {
      return <FullScreenStatus icon={Ban} title="Account rejected"
        message="Your payment was rejected by admin. Contact admin to have your account reinstated."
        onSignOut={() => { signOut(); nav({ to: "/login" }); }} />;
    }
    if (profile.status === "suspended") {
      if (loc.pathname === "/billing") return <Outlet />;
      return <FullScreenStatus icon={Ban} title="Account suspended"
        message="Your subscription has expired or your account has been suspended. Please renew your subscription or contact admin."
        onSignOut={() => { signOut(); nav({ to: "/login" }); }}
        showBillingButton={() => nav({ to: "/billing" as "/" })} />;
    }
    if (profile.status === "pending") {
      return <FullScreenStatus icon={ShieldAlert} title="Awaiting approval"
        message="Your owner account is pending admin approval. You'll get access once approved."
        onSignOut={() => { signOut(); nav({ to: "/login" }); }} />;
    }
  }

  const navItems = isAdmin
    ? [{ to: "/admin", label: "Users", icon: Users }]
    : isManager
    ? [
        { to: "/products",    label: "Items",       icon: Package       },
        { to: "/stock-check", label: "Stock Check", icon: ClipboardList },
        { to: "/manager",     label: "Manage",      icon: TrendingDown  },
      ]
    : [
        { to: "/register",    label: "Store",       icon: ShoppingCart  },
        { to: "/credit",      label: "Customers",   icon: User          },
        ...(isOwner ? [{ to: "/products",    label: "Items",       icon: Package       }] : []),
        ...(isOwner ? [{ to: "/stock-check", label: "Stock Check", icon: ClipboardList }] : []),
        ...(isOwner ? [{ to: "/cashiers",    label: "Staff",       icon: Users         }] : []),
        { to: "/wallet",      label: "Wallet",      icon: Wallet        },
      ];

  return (
    <div className="min-h-screen">
      <header
        className="bg-background/90 backdrop-blur border-b border-border relative z-50"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="max-w-2xl mx-auto px-3 h-12 flex items-center relative">
          {/* Logo */}
          <div className="flex flex-col leading-tight w-20 shrink-0">
            <span className="font-black tracking-tight text-sm truncate">P.O.S. Pro</span>
            {profile.username && (
              <span className="text-[10px] font-medium text-muted-foreground leading-tight truncate">
                {profile.username}
              </span>
            )}
          </div>

          {/* Center: Open Drawer + Scan */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleOpenCashDrawer}
              disabled={drawerBusy}
              className="h-8 px-2.5 rounded-lg font-black text-[11px] flex items-center justify-center gap-1 active:scale-95 transition disabled:opacity-50 whitespace-nowrap"
              style={{ background: "var(--gradient-hero)", color: "var(--primary-foreground)" }}
            >
              {drawerBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "💵 Open Drawer"}
            </button>
            <button
              type="button"
              onClick={() => setShowScannerModal(true)}
              className="h-8 px-2.5 rounded-lg font-black text-[11px] flex items-center justify-center gap-1 active:scale-95 transition whitespace-nowrap"
              style={{ background: "var(--gradient-hero)", color: "var(--primary-foreground)" }}
            >
              📷 Scan
            </button>
          </div>

          {/* Right: store toggle + hamburger */}
          <div className="flex items-center gap-2 ml-auto" ref={menuRef}>
            {(isOwner || isManager) && (
              <button
                type="button"
                disabled={storeToggleBusy}
                onClick={storeIsOpen ? () => setShowCloseStoreConfirm(true) : handleOpenStore}
                className="h-7 px-2.5 rounded-lg font-black text-[11px] flex items-center gap-1 transition active:scale-95 disabled:opacity-50 shrink-0"
                style={storeIsOpen
                  ? { background: "rgba(134,239,172,0.12)", border: "1px solid #86efac", color: "#86efac" }
                  : { background: "rgba(239,68,68,0.12)", border: "1px solid #f87171", color: "#f87171" }}
              >
                {storeToggleBusy
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <span className="text-[10px]">{storeIsOpen ? "🟢" : "🔴"}</span>}
                {storeIsOpen ? "Open" : "Closed"}
              </button>
            )}
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg font-bold text-xs transition text-primary-foreground"
              style={{ background: "var(--gradient-hero)" }}
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              Menu
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-10 w-44 rounded-2xl border border-border shadow-2xl overflow-hidden z-[100]"
                style={{ background: "var(--gradient-card)" }}
              >
                {navItems.map((it) => {
                  const active = loc.pathname.startsWith(it.to);
                  const Icon = it.icon;
                  return (
                    <a
                      key={it.to}
                      href={`#${it.to}`}
                      className={`flex items-center gap-3 px-4 py-4 text-sm font-bold transition border-b border-border/50 last:border-0 ${
                        active ? "text-primary" : "text-foreground hover:bg-muted/50"
                      }`}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      {it.label}
                    </a>
                  );
                })}
                <button
                  onClick={() => { signOut(); nav({ to: "/login" }); }}
                  className="w-full flex items-center gap-3 px-4 py-4 text-sm font-bold text-destructive hover:bg-muted/50 transition"
                >
                  <X className="h-5 w-5 shrink-0" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-3 py-3">
        <Outlet />
      </main>

      {/* ── Close Store Confirm ─────────────────────────────────────────── */}
      {showCloseStoreConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-border shadow-2xl overflow-hidden"
            style={{ background: "var(--gradient-card)" }}>
            <div className="px-6 pt-6 pb-2 text-center">
              <div className="h-14 w-14 rounded-full flex items-center justify-center mx-auto mb-3"
                style={{ background: "rgba(239,68,68,0.12)", border: "1.5px solid #f87171" }}>
                <span className="text-2xl">🔴</span>
              </div>
              <h2 className="font-black text-xl">Close Store?</h2>
              <p className="text-sm text-muted-foreground mt-2">This will end the current session. Are you sure?</p>
            </div>
            <div className="px-6 pb-6 pt-4 flex gap-3">
              <button onClick={() => setShowCloseStoreConfirm(false)}
                className="flex-1 h-12 rounded-2xl font-black text-sm border border-border hover:bg-muted/30 transition">
                Cancel
              </button>
              <button
                onClick={() => { setShowCloseStoreConfirm(false); handleCloseStore(); }}
                disabled={storeToggleBusy}
                className="flex-1 h-12 rounded-2xl font-black text-sm transition active:scale-95 disabled:opacity-50"
                style={{ background: "rgba(239,68,68,0.15)", border: "1.5px solid #f87171", color: "#f87171" }}>
                {storeToggleBusy ? <Loader2 className="h-4 w-4 animate-spin inline" /> : "Close Store"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Open Store Modal ────────────────────────────────────────────── */}
      {showOpenStoreModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-border shadow-2xl overflow-hidden"
            style={{ background: "var(--gradient-card)" }}>
            <div className="px-6 pt-6 pb-2 text-center">
              <div className="h-14 w-14 rounded-full flex items-center justify-center mx-auto mb-3"
                style={{ background: "rgba(134,239,172,0.12)", border: "1.5px solid #86efac" }}>
                <span className="text-2xl">🟢</span>
              </div>
              <h2 className="font-black text-xl">Open Store</h2>
              <p className="text-xs text-muted-foreground mt-1">Set float before starting the session</p>
            </div>

            <div className="px-6 pb-6 pt-4 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-black text-muted-foreground uppercase tracking-wider">Store Float</label>
                <div
                  className="w-full h-11 rounded-xl border bg-background px-4 flex items-center cursor-pointer transition"
                  style={{ borderColor: "var(--primary)" }}
                >
                  <span className={`text-base font-black ${openStoreFloat ? "text-primary" : "text-muted-foreground"}`}>
                    {openStoreFloat || "0"}
                  </span>
                </div>
              </div>

              {/* Numpad */}
              <div className="grid grid-cols-3 gap-1.5">
                {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k, i) => (
                  k === "" ? <div key={i} /> :
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleStoreFloatNumpad(k)}
                    className={`h-12 rounded-xl font-black text-lg transition active:scale-95 ${
                      k === "⌫"
                        ? "bg-destructive/20 text-destructive hover:bg-destructive/30"
                        : "bg-muted hover:bg-muted/70 text-foreground"
                    }`}
                  >{k}</button>
                ))}
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowOpenStoreModal(false)}
                  className="flex-1 h-12 rounded-2xl font-black text-sm border border-border hover:bg-muted/30 transition">
                  Cancel
                </button>
                <button
                  onClick={confirmOpenStore}
                  disabled={storeToggleBusy || !openStoreFloat}
                  className="flex-1 h-12 rounded-2xl font-black text-sm transition active:scale-95 disabled:opacity-50"
                  style={{ background: "rgba(134,239,172,0.15)", border: "1.5px solid #86efac", color: "#86efac" }}>
                  {storeToggleBusy ? <Loader2 className="h-4 w-4 animate-spin inline" /> : "Open Store"}
                </button>
              </div>
            </div>
          </div>
         </div>
       )}

       {/* ── Cash Drawer result modal ──────────────────────────────────────── */}
       {showDrawerModal && (
         <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
           <div className="w-full max-w-sm rounded-3xl border border-border shadow-2xl overflow-hidden"
             style={{ background: "var(--gradient-card)" }}>
             <div className="px-6 pt-6 pb-2 text-center">
               <div className="h-14 w-14 rounded-full flex items-center justify-center mx-auto mb-3"
                 style={{ background: drawerResult?.opened ? "rgba(134,239,172,0.12)" : "rgba(239,68,68,0.12)", border: "1.5px solid " + (drawerResult?.opened ? "#86efac" : "#f87171") }}>
                 <span className="text-2xl">{drawerResult?.opened ? "✅" : "❌"}</span>
               </div>
               <h2 className="font-black text-xl">{drawerResult?.opened ? "Drawer Opened" : "Could Not Open Drawer"}</h2>
               <p className="text-sm text-muted-foreground mt-2">
                 {drawerResult?.opened
                   ? <>Sent via {drawerResult.method === "native" ? "USB" : drawerResult.method === "webserial" ? "Web Serial" : "simulated"} {drawerResult.device ? `· ${drawerResult.device}` : ""}</>
                   : drawerResult?.error ?? "Unknown error"}
               </p>
             </div>
             <div className="px-6 pb-6 pt-4">
               <button onClick={() => setShowDrawerModal(false)}
                 className="w-full h-12 rounded-2xl font-black text-sm border border-border hover:bg-muted/30 transition">
                 Close
               </button>
             </div>
            </div>
          </div>
        )}

        {/* ── Barcode Scanner Modal ───────────────────────────────────────── */}
        <BarcodeScannerModal
          open={showScannerModal}
          onClose={() => setShowScannerModal(false)}
          onDone={(items) => {
            items.forEach((item) => {
              window.dispatchEvent(new CustomEvent("pospro-barcode-scan", { detail: item.product }));
            });
          }}
        />
      </div>
    );
}

function FullScreenStatus({
  icon: Icon, title, message, onSignOut, showBillingButton,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  message: string;
  onSignOut: () => void;
  showBillingButton?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "radial-gradient(circle at 50% 0%, oklch(0.20 0.08 240) 0%, oklch(0.08 0.04 240) 70%)" }}>
      <div className="max-w-md text-center space-y-6">
        <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-destructive/20 border border-destructive/40">
          <Icon className="h-10 w-10 text-destructive" />
        </div>
        <h1 className="text-3xl font-black">{title}</h1>
        <p className="text-muted-foreground">{message}</p>
        <div className="flex gap-3 justify-center">
          {showBillingButton && <Button onClick={showBillingButton}>Go to Billing</Button>}
          <Button variant="outline" onClick={onSignOut}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}
