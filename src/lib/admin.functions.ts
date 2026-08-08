// Browser-side admin operations using authenticated user + admin RLS/RPCs.
// No service role needed — all service-role work is done in edge functions.
import { supabase } from "@/integrations/supabase/client";

export type AdminProfileRow = {
  id: string;
  username: string;
  email: string;
  role: "admin" | "owner" | "cashier" | "manager";
  status: "pending" | "approved" | "suspended" | "expelled" | "rejected";
  wallet_balance: number;
  created_at: string;
  parent_id: string | null;
  phone: string | null;
  address: string | null;
  plan_type?: string;
  billing_status?: string;
  subscription_end_date?: string;
  chain_addon_active?: boolean;
  chain_bar_count?: number;
  is_bar_account?: boolean;
  addon_bar_count?: number;
  is_multi_bar?: boolean;
};

// ── List all owner profiles (admin RPC) ──────────────────────────────────────

export async function listAllProfiles(): Promise<AdminProfileRow[]> {
  const { data, error } = await supabase.rpc("admin_list_profiles");
  if (error) throw new Error(error.message);
  return (data ?? []) as AdminProfileRow[];
}

// ── Set user status ──────────────────────────────────────────────────────────

export async function setUserStatus(
  user_id: string,
  status: AdminProfileRow["status"]
): Promise<void> {
  let extraFields: Record<string, unknown> = {};

  if (status === "pending") {
    const { data: target } = await supabase
      .from("profiles")
      .select("role, parent_id")
      .eq("id", user_id)
      .single();

    const isOwner = target?.role === "owner" && !target?.parent_id;
    if (isOwner) {
      extraFields = {
        billing_status:          "pending_setup",
        plan_type:               "basic",
        subscription_start_date: null,
        subscription_end_date:   null,
        chain_addon_active:      false,
        chain_bar_count:         0,
        addon_bar_count:         0,
        is_multi_bar:            false,
      };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ status, ...extraFields })
    .eq("id", user_id);

  if (error) throw new Error(error.message);
}
// ── Delete user (admin RPC) ──────────────────────────────────────────────────

export async function adminDeleteUser(user_id: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_user", { _user_id: user_id });
  if (error) throw new Error(error.message);
}

// ── Revoke subscription (calls edge function) ────────────────────────────────
//
// Returns:
//   { ok: true }
//   { ok: false, reason: "has_addons", addons: string[] }
//   { ok: false, reason: "error", message: string }

export type RevokeResult =
  | { ok: true }
  | { ok: false; reason: "has_addons"; addons: string[] }
  | { ok: false; reason: "error"; message: string };

export async function revokeSubscription(
  owner_id: string,
  force = false
): Promise<RevokeResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const { data: { session } } = await supabase.auth.getSession();

  // We use the owner_id directly (not a payment_id) for admin-initiated revokes
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/admin-revoke-plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session?.access_token}`,
        "apikey": supabaseKey,
      },
      body: JSON.stringify({ owner_id, force }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Network error";
    return { ok: false, reason: "error", message: msg };
  }

  const json = await res.json();
  if (json.has_addons) return { ok: false, reason: "has_addons", addons: json.addons };
  if (!res.ok) return { ok: false, reason: "error", message: json.error ?? "Unknown error" };
  return { ok: true };
}

// ── Admin set plan directly (no payment required) ────────────────────────────

export type PlanType = "basic" | "premium" | "premium_20" | "chain";

export async function adminSetPlan(
  owner_id: string,
  plan_type: PlanType,
  duration_months: number
): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${supabaseUrl}/functions/v1/admin-set-plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session?.access_token}`,
      "apikey": supabaseKey,
    },
    body: JSON.stringify({ owner_id, plan_type, duration_months }),
    signal: AbortSignal.timeout(15_000),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to set plan");
}

// ── Admin create owner account ───────────────────────────────────────────────

export async function adminCreateOwner(params: {
  username: string;
  email: string;
  password: string;
  phone?: string;
  address?: string;
  plan_type?: PlanType;
}): Promise<{ id: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${supabaseUrl}/functions/v1/admin-create-owner`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session?.access_token}`,
      "apikey": supabaseKey,
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15_000),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to create owner");
  return { id: json.id };
}

// ── Create cashier / manager / custom staff ──────────────────────────────────

export async function createStaffMember(params: {
  owner_id: string;
  username: string;
  password: string;
  role: "cashier" | "manager" | "custom";
  job_title?: string;
  bar_owner_id?: string;
}): Promise<{ id: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${supabaseUrl}/functions/v1/create-cashier`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session?.access_token}`,
      "apikey": supabaseKey,
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15_000),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to create staff member");
  return { id: json.id };
}

// ── Delete cashier / manager / staff ─────────────────────────────────────────

export async function deleteStaffMember(staff_id: string): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${supabaseUrl}/functions/v1/delete-cashier`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session?.access_token}`,
      "apikey": supabaseKey,
    },
    body: JSON.stringify({ cashier_id: staff_id }),
    signal: AbortSignal.timeout(15_000),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to delete staff member");
}

// ── Reset staff password ─────────────────────────────────────────────────────

export async function resetStaffPassword(
  staff_id: string,
  new_password: string
): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${supabaseUrl}/functions/v1/reset-cashier-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session?.access_token}`,
      "apikey": supabaseKey,
    },
    body: JSON.stringify({ cashier_id: staff_id, new_password }),
    signal: AbortSignal.timeout(15_000),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to reset password");
}

// ── Create chain store ────────────────────────────────────────────────────────

export async function createStore(params: {
  owner_id: string;
  store_name: string;
  location?: string;
}): Promise<{ id: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${supabaseUrl}/functions/v1/create-store`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session?.access_token}`,
      "apikey": supabaseKey,
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15_000),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to create store");
  return { id: json.id };
}

// ── Delete chain store ────────────────────────────────────────────────────────

export async function deleteStore(store_id: string, owner_id: string): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${supabaseUrl}/functions/v1/delete-store`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session?.access_token}`,
      "apikey": supabaseKey,
    },
    body: JSON.stringify({ store_id, owner_id }),
    signal: AbortSignal.timeout(15_000),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to delete store");
}
