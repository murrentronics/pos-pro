import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useChain } from "@/lib/ChainContext";
import { supabase } from "@/integrations/supabase/client";
import { usePushNotifications } from "@/lib/usePushNotifications";
import { useTranslation } from "@/lib/i18n";
import { useOffline } from "@/lib/OfflineProvider";
import { OfflinePageGuard } from "@/components/OfflinePageGuard";
import { Loader2, Wine, Package, Wallet, Users, ShieldAlert, Ban, UserMinus, Menu, X, CreditCard, Building2, UserCircle, Receipt, Globe, GitBranch, BarChart3, TrendingDown, ClipboardList, BookOpen, ShieldCheck, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";

const DEMO_EMAILS = ["isabel@gmail.com", "renard.sankersingh@gmail.com"];

export default function AppLayout() {
  const { session, profile, loading, signOut } = useAuth();
  const { isChainOwner, isMultiBarOwner, activeBarId, activeBar } = useChain();
  const hasMultipleBars = isChainOwner || isMultiBarOwner;
  const nav = useNavigate();
  const loc = useLocation();
  const { t } = useTranslation();
  const { isOnline } = useOffline();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [ownerEmail, setOwnerEmail] = useState("");

  useEffect(() => {
    if (!loading && !session) nav("/login", { replace: true });
  }, [session, loading, nav]);

  useEffect(() => {
    // Don't force sign-out if we're offline — profile may simply be unavailable
    // from the network. The loadProfile function already preserves the cached
    // profile on network errors, but this is a belt-and-suspenders guard.
    if (!loading && session && !profile && isOnline) {
      signOut().then(() => nav("/login", { replace: true }));
    }
  }, [loading, session, profile, isOnline]);

  useEffect(() => {
    if (!loading && profile?.role === "admin" && !loc.pathname.startsWith("/admin")) {
      nav("/admin", { replace: true });
    }
    if (!loading && profile && profile.role !== "admin" && loc.pathname.startsWith("/admin")) {
      nav("/register", { replace: true });
    }
    // Manager landing page — redirect away from bar/wallet to items
    if (!loading && (profile?.role === "manager" || profile?.job_title === "manager") && (loc.pathname === "/register" || loc.pathname === "/" || loc.pathname === "/wallet")) {
      nav("/products", { replace: true });
    }
    if (!loading && profile && profile.role === "owner" && profile.status === "pending" && loc.pathname !== "/billing" && !DEMO_EMAILS.includes(ownerEmail)) {
      nav("/billing", { replace: true });
    }
    // Multi-bar owner or chain owner with no bar selected → force them to pick a bar first
    // Allow billing page so they can manage subscriptions
    if (!loading && hasMultipleBars && !activeBarId && loc.pathname !== "/switch-bar" && loc.pathname !== "/billing") {
      nav("/switch-bar", { replace: true });
    }
  }, [loading, profile, loc.pathname, nav, isChainOwner, activeBarId, ownerEmail]);

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

  // Close menu on route change + scroll main back to top
  useEffect(() => {
    setMenuOpen(false);
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "instant" });
  }, [loc.pathname]);

  // Register FCM push token for the owner's device — must be before any early returns (Rules of Hooks)
  usePushNotifications(profile?.role === "owner" ? profile.id : null);

  // ── Deep-link navigation from push notification tap (background / killed) ─
  useEffect(() => {
    const handler = (e: Event) => {
      const { path } = (e as CustomEvent).detail as { path: string };
      if (path) nav(path);
    };
    window.addEventListener("pushNotificationNavigate", handler);
    return () => window.removeEventListener("pushNotificationNavigate", handler);
  }, [nav]);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setOwnerEmail(session?.user?.email ?? "");
    };
    load();
  }, [profile?.id]);

  if (loading || !session || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const isOwner    = profile.role === "owner";
  const isAdmin    = profile.role === "admin";
  const isCashier  = profile.role === "cashier";
  const isManager  = profile.role === "manager" || (profile as any).job_title === "manager";
  const isDemo     = DEMO_EMAILS.includes(ownerEmail);
  const isPending  = !isAdmin && !isCashier && !isManager && !isDemo && profile.status === "pending";
  const isSuspended = !isAdmin && !isCashier && !isManager && !isDemo && profile.status === "suspended";


  if (!isAdmin && !isCashier && profile.status === "expelled") {
    return (
      <FullScreenStatus
        icon={UserMinus}
        title="Account expelled"
        message="Your account has been expelled. You no longer have access to P.O.S. Pro."
        onSignOut={() => { signOut(); nav("/login"); }}
      />
    );
  }

  if (isSuspended && loc.pathname !== "/billing") {
    return (
      <FullScreenStatus
        icon={Ban}
        title="Account suspended"
        message="Your account is suspended. Please check your billing page or contact admin."
        onSignOut={() => { signOut(); nav("/login"); }}
        showBillingButton={() => nav("/billing")}
      />
    );
  }

  if (isPending && loc.pathname !== "/billing") {
    return (
      <div className="min-h-screen">
        <header
          className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b border-border"
          style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
        >
          <div className="max-w-2xl lg:max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
            <span className="font-black tracking-tight text-sm">P.O.S. Pro</span>
            <div className="flex items-center gap-2" ref={menuRef}>
              <span className="text-xs font-semibold text-muted-foreground truncate max-w-[100px]">{profile.username}</span>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-1.5 px-3 h-8 rounded-lg font-bold text-xs transition text-primary-foreground"
                style={{ background: "var(--gradient-hero)" }}
              >
                {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                Menu
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-10 w-44 rounded-2xl border border-border shadow-2xl overflow-hidden z-[9999]"
                  style={{ background: "var(--gradient-card)" }}>
                  <Link to="/billing" className="flex items-center gap-3 px-4 py-4 text-sm font-bold transition border-b border-border/50 text-primary">
                    <CreditCard className="h-5 w-5 shrink-0" /> {t("billing", "Billing")}
                  </Link>
                  <button onClick={async () => { try { await signOut(); } catch { /* ignore */ } nav("/login"); }}
                    className="w-full flex items-center gap-3 px-4 py-4 text-sm font-bold text-destructive hover:bg-muted/50 transition">
                    <X className="h-5 w-5 shrink-0" /> {t("logout", "Logout")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="max-w-2xl lg:max-w-4xl mx-auto px-3 py-3">
          <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
            <div className="max-w-md text-center space-y-6">
              <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-yellow-500/20 border border-yellow-500/40">
                <ShieldAlert className="h-10 w-10 text-yellow-500" />
              </div>
              <h1 className="text-3xl font-black">{t("awaiting_approval", "Account Pending")}</h1>
              <p className="text-muted-foreground">{t("account_pending_msg", "Your account is awaiting admin approval. Please complete your billing setup to activate your account.")}</p>
              <Button onClick={() => nav("/billing")} size="lg">{t("go_to_billing", "Go to Billing")}</Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const navItems = isPending
    ? [] // pending users get no nav items — only Billing + Logout shown separately below
    : isAdmin
    ? [
        { to: "/admin",          label: "Panel",   icon: Users },
        { to: "/admin/banking",  label: "Banking", icon: Building2 },
      ]
    : isManager ? [
        // Manager: Items, Stock Check, Customers, Manager dashboard
        { to: "/products",    label: t("products_title", "Items"),      icon: Package      },
        { to: "/stock-check", label: t("stock_check", "Stock Check"),   icon: ClipboardList },
        { to: "/credit",      label: t("customers_title", "Customers"), icon: Receipt      },
        { to: "/manager",     label: t("manage", "Manage"),             icon: TrendingDown },
      ]
    : [
        { to: "/register",  label: t("store", "Store"),                  icon: Wine       },
        { to: "/credit",    label: t("customers_title", "Customers"),  icon: Receipt    },
        ...(isOwner ? [{ to: "/products",    label: t("products_title", "Items"),    icon: Package      }] : []),
        ...(isOwner ? [{ to: "/stock-check", label: t("stock_check", "Stock Check"), icon: ClipboardList }] : []),
        ...(isOwner ? [{ to: "/categories",  label: t("categories", "Categories"),   icon: LayoutGrid   }] : []),
        ...(isOwner ? [{ to: "/cashiers",    label: t("cashiers", "Staff"),           icon: Users        }] : []),
        { to: "/wallet",    label: t("wallet", "Wallet"),               icon: Wallet     },
        ...(isOwner ? [{ to: "/summary",  label: t("summary", "Summary"),   icon: BarChart3  }] : []),
        ...(isOwner ? [{ to: "/billing",  label: t("billing", "Billing"),   icon: CreditCard }] : []),
        ...(isOwner ? [{ to: "/profile",  label: t("profile", "Profile"),   icon: UserCircle }] : []),
      ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden", position: "fixed", inset: 0 }}>
      <header
        className="shrink-0 z-50 bg-background/90 backdrop-blur border-b border-border"
        style={{ paddingTop: "calc(var(--offline-banner-h, 0px) + env(safe-area-inset-top, 0px))" }}
      >
        <div className="max-w-2xl lg:max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">

          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="flex flex-col leading-tight">
              <span className="font-black tracking-tight text-sm">P.O.S. Pro</span>
              {profile.username && (
                <span className="text-[10px] font-medium text-muted-foreground leading-tight truncate max-w-[140px]">{profile.username}</span>
              )}
            </div>
          </div>

          {/* Hamburger — no username in header on mobile */}
          <div className="flex items-center gap-2 relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 px-4 h-10 rounded-lg font-black text-sm transition text-primary-foreground"
              style={{ background: "var(--gradient-hero)" }}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              {t("menu", "Menu")}
            </button>

            {/* ── CASHIER MENU — full-width big-button grid + brown backdrop ── */}
            {/* menus rendered below at root level */}
          </div>
        </div>
      </header>

      {/* ── CASHIER MENU — at root level, always above page content ── */}
      {menuOpen && (isCashier || isManager) && (
        <>
          <div className="fixed inset-x-0 mx-auto max-w-2xl lg:max-w-4xl rounded-b-2xl border border-border shadow-2xl z-[9999] overflow-y-auto"
            style={{ top: "calc(56px + var(--offline-banner-h, 0px) + env(safe-area-inset-top, 0px))", bottom: 0, background: "var(--gradient-card)", scrollbarWidth: "none" }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-4 border-b border-border/50">
              <span className="text-sm font-black text-foreground">{profile.username}</span>
            </div>
            <div className="p-4 pb-[30vh]">
              <div className="grid grid-cols-3 gap-3">
                {navItems.map((it) => {
                  const active = loc.pathname.startsWith(it.to);
                  const Icon = it.icon;
                  return (
                    <button key={it.to} onClick={() => { setMenuOpen(false); nav(it.to); }}
                      className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 py-4 px-2 active:scale-95 transition-transform select-none"
                      style={{ background: active ? "var(--gradient-hero)" : "var(--gradient-card)", borderColor: active ? "var(--primary)" : "var(--border)", boxShadow: active ? "0 6px 18px rgba(0,180,255,0.35)" : "0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
                      <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: active ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.06)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.25)" }}>
                        <Icon className={`h-6 w-6 ${active ? "text-white" : "text-primary"}`} />
                      </div>
                      <span className={`text-xs font-black text-center leading-tight ${active ? "text-white" : "text-foreground"}`}>{it.label}</span>
                    </button>
                  );
                })}
                <button onClick={() => { setMenuOpen(false); nav("/language"); }}
                  className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 py-4 px-2 active:scale-95 transition-transform select-none"
                  style={{ background: loc.pathname === "/language" ? "var(--gradient-hero)" : "var(--gradient-card)", borderColor: loc.pathname === "/language" ? "var(--primary)" : "var(--border)", boxShadow: loc.pathname === "/language" ? "0 6px 18px rgba(0,180,255,0.35)" : "0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
                  <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: loc.pathname === "/language" ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.06)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.25)" }}>
                    <Globe className={`h-6 w-6 ${loc.pathname === "/language" ? "text-white" : "text-primary"}`} />
                  </div>
                  <span className={`text-xs font-black text-center leading-tight ${loc.pathname === "/language" ? "text-white" : "text-foreground"}`}>{t("language", "Language")}</span>
                </button>
                <button onClick={async () => { try { await signOut(); } catch { /* ignore */ } nav("/login"); }}
                  className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-destructive/40 py-4 px-2 active:scale-95 transition-transform select-none"
                  style={{ background: "rgba(239,68,68,0.08)", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}>
                  <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "rgba(239,68,68,0.12)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.25)" }}>
                    <X className="h-6 w-6 text-destructive" />
                  </div>
                  <span className="text-xs font-black text-destructive text-center leading-tight">{t("logout", "Logout")}</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── OWNER / ADMIN MENU — at root level, always above page content ── */}
      {menuOpen && !isCashier && (
        <>
          <div className="fixed inset-x-0 mx-auto max-w-2xl lg:max-w-4xl border border-border shadow-2xl z-[9999] overflow-y-auto"
            style={{ top: "calc(56px + var(--offline-banner-h, 0px) + env(safe-area-inset-top, 0px))", bottom: 0, background: "var(--gradient-card)", scrollbarWidth: "none" }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border/50">
              <span className="text-sm font-semibold text-muted-foreground truncate block">{profile.username}</span>
              {isChainOwner && activeBar && <span className="text-xs font-black text-primary truncate block mt-0.5">📍 {activeBar.bar_name}</span>}
              {isChainOwner && !activeBar && <span className="text-xs font-black text-amber-400 truncate block mt-0.5">{t("no_bar_selected", "⚠ No store selected")}</span>}
              {!isChainOwner && isMultiBarOwner && activeBar && <span className="text-xs font-black text-primary truncate block mt-0.5">📍 {activeBar.bar_name}</span>}
              {!isChainOwner && isMultiBarOwner && !activeBar && <span className="text-xs font-black text-amber-400 truncate block mt-0.5">{t("no_bar_selected", "⚠ No store selected")}</span>}

            </div>

            {/* Pending users — only Billing + Logout */}
            {isPending ? (
              <div className="p-4 space-y-3">
                <button onClick={() => { setMenuOpen(false); nav("/billing"); }}
                  className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 py-4 px-2 w-full active:scale-95 transition-transform select-none"
                  style={{ background: "var(--gradient-card)", borderColor: "var(--primary)", boxShadow: "0 6px 18px rgba(0,180,255,0.35)" }}>
                  <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "rgba(255,255,255,0.06)" }}>
                    <CreditCard className="h-6 w-6 text-primary" />
                  </div>
                  <span className="text-xs font-black text-center leading-tight text-primary">{t("billing", "Billing")}</span>
                </button>
                <button onClick={async () => { try { await signOut(); } catch { /* ignore */ } nav("/login"); }}
                  className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-destructive/40 py-4 px-2 w-full active:scale-95 transition-transform select-none"
                  style={{ background: "rgba(239,68,68,0.08)" }}>
                  <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "rgba(239,68,68,0.12)" }}>
                    <X className="h-6 w-6 text-destructive" />
                  </div>
                  <span className="text-xs font-black text-destructive text-center leading-tight">{t("logout", "Logout")}</span>
                </button>
              </div>
            ) : (
            <div className="p-4 pb-[30vh]">
              <div className="grid grid-cols-3 gap-3">
                {navItems.map((it) => {
                  const active = loc.pathname.startsWith(it.to);
                  const Icon = it.icon;
                  return (
                    <button key={it.to} onClick={() => { setMenuOpen(false); nav(it.to); }}
                      className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 py-4 px-2 active:scale-95 transition-transform select-none"
                      style={{ background: active ? "var(--gradient-hero)" : "var(--gradient-card)", borderColor: active ? "var(--primary)" : "var(--border)", boxShadow: active ? "0 6px 18px rgba(0,180,255,0.35)" : "0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
                      <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: active ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.06)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.25)" }}>
                        <Icon className={`h-6 w-6 ${active ? "text-white" : "text-primary"}`} />
                      </div>
                      <span className={`text-xs font-black text-center leading-tight ${active ? "text-white" : "text-foreground"}`}>{it.label}</span>
                    </button>
                  );
                })}
                {!isAdmin && (
                <button onClick={() => { setMenuOpen(false); nav("/language"); }}
                  className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 py-4 px-2 active:scale-95 transition-transform select-none"
                  style={{ background: loc.pathname === "/language" ? "var(--gradient-hero)" : "var(--gradient-card)", borderColor: loc.pathname === "/language" ? "var(--primary)" : "var(--border)", boxShadow: loc.pathname === "/language" ? "0 6px 18px rgba(0,180,255,0.35)" : "0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
                  <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: loc.pathname === "/language" ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.06)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.25)" }}>
                    <Globe className={`h-6 w-6 ${loc.pathname === "/language" ? "text-white" : "text-primary"}`} />
                  </div>
                  <span className={`text-xs font-black text-center leading-tight ${loc.pathname === "/language" ? "text-white" : "text-foreground"}`}>{t("language", "Language")}</span>
                </button>
                )}
                {hasMultipleBars && (
                  <button onClick={() => { setMenuOpen(false); nav("/switch-bar"); }}
                    className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 py-4 px-2 active:scale-95 transition-transform select-none"
                    style={{ background: loc.pathname === "/switch-bar" ? "var(--gradient-hero)" : "var(--gradient-card)", borderColor: loc.pathname === "/switch-bar" ? "var(--primary)" : "var(--border)", boxShadow: loc.pathname === "/switch-bar" ? "0 6px 18px rgba(0,180,255,0.35)" : "0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
                    <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: loc.pathname === "/switch-bar" ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.06)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.25)" }}>
                      <GitBranch className={`h-6 w-6 ${loc.pathname === "/switch-bar" ? "text-white" : "text-primary"}`} />
                    </div>
                    <span className={`text-xs font-black text-center leading-tight ${loc.pathname === "/switch-bar" ? "text-white" : "text-foreground"}`}>
                      {t("switch_bar", "Switch Store")}
                    </span>
                  </button>
                )}
                {(isOwner || isManager) && (
                  <button onClick={() => { setMenuOpen(false); nav("/privacy"); }}
                    className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 py-4 px-2 active:scale-95 transition-transform select-none"
                    style={{ background: loc.pathname === "/privacy" ? "var(--gradient-hero)" : "var(--gradient-card)", borderColor: loc.pathname === "/privacy" ? "var(--primary)" : "var(--border)", boxShadow: loc.pathname === "/privacy" ? "0 6px 18px rgba(0,180,255,0.35)" : "0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
                    <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: loc.pathname === "/privacy" ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.06)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.25)" }}>
                      <ShieldCheck className={`h-6 w-6 ${loc.pathname === "/privacy" ? "text-white" : "text-primary"}`} />
                    </div>
                    <span className={`text-xs font-black text-center leading-tight ${loc.pathname === "/privacy" ? "text-white" : "text-foreground"}`}>Privacy</span>
                  </button>
                )}
                {(isOwner || isManager) && (
                  <button onClick={() => { setMenuOpen(false); nav("/manual"); }}
                    className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 py-4 px-2 active:scale-95 transition-transform select-none"
                    style={{ background: loc.pathname === "/manual" ? "var(--gradient-hero)" : "var(--gradient-card)", borderColor: loc.pathname === "/manual" ? "var(--primary)" : "var(--border)", boxShadow: loc.pathname === "/manual" ? "0 6px 18px rgba(0,180,255,0.35)" : "0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
                    <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: loc.pathname === "/manual" ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.06)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.25)" }}>
                      <BookOpen className={`h-6 w-6 ${loc.pathname === "/manual" ? "text-white" : "text-primary"}`} />
                    </div>
                    <span className={`text-xs font-black text-center leading-tight ${loc.pathname === "/manual" ? "text-white" : "text-foreground"}`}>Manual</span>
                  </button>
                )}
                <button onClick={async () => { try { await signOut(); } catch { /* ignore */ } nav("/login"); }}
                  className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-destructive/40 py-4 px-2 active:scale-95 transition-transform select-none"
                  style={{ background: "rgba(239,68,68,0.08)", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}>
                  <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "rgba(239,68,68,0.12)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.25)" }}>
                    <X className="h-6 w-6 text-destructive" />
                  </div>
                  <span className="text-xs font-black text-destructive text-center leading-tight">{t("logout", "Logout")}</span>
                </button>
              </div>
            </div>
            )} {/* end isPending ternary */}
          </div>
        </>
      )}

      <main className="max-w-2xl lg:max-w-4xl mx-auto w-full px-3 overflow-y-auto flex-1 scrollbar-none" style={{ overscrollBehavior: "none", WebkitOverflowScrolling: "auto", scrollbarWidth: "none", msOverflowStyle: "none" }}>
        <OfflinePageGuard>
          {/* Block outlet while a redirect is pending — prevents register flashing for managers */}
          {(() => {
            if (!loading && profile) {
              const isManagerUser = profile.role === "manager" || (profile as any)?.job_title === "manager";
              if (isManagerUser && (loc.pathname === "/register" || loc.pathname === "/" || loc.pathname === "/wallet")) {
                return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
              }
            }
            return <Outlet />;
          })()}
        </OfflinePageGuard>
      </main>


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
