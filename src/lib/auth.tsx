import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import {
  forgetRememberedProfile,
  forgetRememberedSession,
  isSessionRevoked,
  readRememberedProfile,
  readRememberedSession,
  rememberProfile,
  rememberSession,
} from "@/lib/authSession";

export type UserStatus = "pending" | "approved" | "suspended" | "expelled" | "rejected";
export type Profile = {
  id: string;
  username: string;
  first_name?: string | null;
  last_name?: string | null;
  role: "owner" | "cashier" | "admin" | "manager";
  parent_id: string | null;
  wallet_balance: number;
  status: UserStatus;
  phone?: string;
  address?: string;
  billing_status?: string;
  subscription_end_date?: string;
  subscription_start_date?: string;
  plan_type?: "basic" | "premium" | "premium_20" | "chain";
  premium_subscription_start_date?: string;
  premium_subscription_end_date?: string;
  // Chain of Bars plan
  chain_addon_active?: boolean;
  chain_bar_count?: number;
  is_bar_account?: boolean;
  // Multi-bar addon
  addon_bar_count?: number;
  is_multi_bar?: boolean;
  job_title?: string;
};

type AuthCtx = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const savedSession = readRememberedSession();
  const savedProfile = readRememberedProfile();
  const [session, setSession] = useState<Session | null>(savedSession);
  const [profile, setProfile] = useState<Profile | null>(savedProfile);
  // A saved login opens straight into the register. A first visit waits for auth.
  const [loading, setLoading] = useState(!(savedSession && savedProfile));
  // track whether a profile fetch is in flight so we don't sign out prematurely
  const profileFetching = useRef(false);
  // track whether the user explicitly called signOut() so we don't treat
  // token-refresh SIGNED_OUT events as intentional logouts
  const explicitSignOut = useRef(false);
  const recovering = useRef(false);

  const applyProfile = (p: Profile | null) => {
    if (p) rememberProfile(p);
    setProfile(p);
  };

  const loadProfile = async (uid: string) => {
    profileFetching.current = true;
    try {
      // Don't block the register on a slow wake-up. The saved profile stays
      // on screen, and this request still updates it when the network answers.
      const fetchPromise = supabase
        .from("profiles")
        .select("*")
        .eq("id", uid)
        .maybeSingle();

      void fetchPromise.then(({ data, error }) => {
        if (error || !data) return;
        applyProfile(data as unknown as Profile);
      });

      const timeoutPromise = new Promise<{ data: null; error: { message: string } }>(
        (resolve) => setTimeout(() => resolve({ data: null, error: { message: "offline" } }), 6000)
      );

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise]) as { data: unknown; error: { message?: string } | null };

      if (error) {
        setProfile((prev) => prev ?? readRememberedProfile());
        return;
      }

      if (data) applyProfile(data as unknown as Profile);
      else setProfile((prev) => prev ?? readRememberedProfile());
    } finally {
      profileFetching.current = false;
      setLoading(false);
    }
  };

  const recoverSession = async (): Promise<boolean> => {
    const backup = readRememberedSession();
    if (!backup?.refresh_token) return false;

    setSession(backup);
    setProfile((prev) => prev ?? readRememberedProfile());

    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: backup.refresh_token });
      if (data.session) {
        rememberSession(data.session);
        setSession(data.session);
        void loadProfile(data.session.user.id);
        return true;
      }
      const blob = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
      if (blob.includes("already used") || blob.includes("already_used")) {
        const { data: again } = await supabase.auth.getSession();
        if (again.session) {
          rememberSession(again.session);
          setSession(again.session);
          void loadProfile(again.session.user.id);
          return true;
        }
      }
      if (isSessionRevoked(error)) return false;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }

    // Network is still waking up. Stay on the saved login.
    return true;
  };

  useEffect(() => {
    let cancelled = false;

    const dropSession = () => {
      forgetRememberedSession();
      forgetRememberedProfile();
      setSession(null);
      setProfile(null);
      setLoading(false);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (cancelled) return;
      if (s?.user) {
        rememberSession(s);
        setSession(s);
        void loadProfile(s.user.id);
        return;
      }

      if (explicitSignOut.current) {
        explicitSignOut.current = false;
        dropSession();
        return;
      }

      // Idle, a sleeping device, or a blip while the radio wakes up can fire
      // SIGNED_OUT even though the refresh token is still good. Stay signed in
      // unless this token was actually revoked.
      if (event !== "SIGNED_OUT" && event !== "INITIAL_SESSION") return;
      if (recovering.current) return;
      recovering.current = true;
      void recoverSession()
        .then((kept) => {
          if (cancelled) return;
          if (!kept) dropSession();
        })
        .finally(() => {
          recovering.current = false;
          if (!cancelled) setLoading(false);
        });
    });

    const resumeRefresh = () => {
      void supabase.auth.startAutoRefresh();
    };
    let leftTheApp = false;
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        leftTheApp = true;
        void supabase.auth.stopAutoRefresh();
        return;
      }
      resumeRefresh();
      if (!leftTheApp) return;
      // Coming back from idle. getUser checks the server session, so a login
      // on another device signs this one out instead of a dead token.
      void supabase.auth.getUser().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", resumeRefresh);
    window.addEventListener("online", onVisible);
    onVisible();
    const lateWake = window.setTimeout(resumeRefresh, 500);

    return () => {
      window.clearTimeout(lateWake);
      cancelled = true;
      sub.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", resumeRefresh);
      window.removeEventListener("online", onVisible);
      void supabase.auth.stopAutoRefresh();
    };
  }, []);

  // Realtime: watch own profile row for updates and deletes
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;

    const ch = supabase
      .channel(`profile-${uid}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${uid}` },
        (payload) => {
          setProfile((prev) => {
            const next = { ...(prev as Profile), ...(payload.new as Profile) };
            rememberProfile(next);
            return next;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "profiles", filter: `id=eq.${uid}` },
        () => {
          explicitSignOut.current = true;
          forgetRememberedSession();
          forgetRememberedProfile();
          setProfile(null);
          setSession(null);
          void supabase.auth.signOut();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [session?.user?.id]);

  const value: AuthCtx = {
    user: session?.user ?? null,
    session,
    profile,
    loading,
    refreshProfile: async () => {
      if (session?.user) await loadProfile(session.user.id);
    },
    signOut: async () => {
      // Flag that this is intentional so the auth listener knows to clear state
      explicitSignOut.current = true;
      forgetRememberedSession();
      forgetRememberedProfile();
      // Remove push notification listeners before signing out to prevent
      // the cleanup race on Android that causes the brown screen crash
      if (Capacitor.isNativePlatform()) {
        try {
          const { PushNotifications } = await import("@capacitor/push-notifications");
          await PushNotifications.removeAllListeners();
        } catch { /* ignore — listeners may not be registered */ }
      }
      await supabase.auth.signOut();
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
};

export const CASHIER_DOMAIN = "bartendaz.cashier";
export const usernameToEmail = (u: string) => `${u.trim().toLowerCase()}@${CASHIER_DOMAIN}`;
