import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const svc = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: callerProfile } = await svc
      .from("profiles").select("role").eq("id", user.id).single();
    const isOwner = callerProfile?.role === "owner";
    const isAdmin = callerProfile?.role === "admin";
    if (!isOwner && !isAdmin) return json({ error: "Only owners or admins can delete stores" }, 403);

    const { store_id, owner_id } = await req.json();
    if (!store_id) return json({ error: "store_id required" }, 400);

    // Verify the store belongs to the caller (or admin can delete any)
    const { data: storeProfile } = await svc
      .from("profiles")
      .select("id, parent_id, is_bar_account")
      .eq("id", store_id)
      .single();

    if (!storeProfile) return json({ error: "Store not found" }, 404);
    if (!storeProfile.is_bar_account) return json({ error: "Target is not a store account" }, 400);

    const effectiveOwnerId: string = isAdmin
      ? (owner_id ?? storeProfile.parent_id)
      : user.id;

    if (storeProfile.parent_id !== effectiveOwnerId) {
      return json({ error: "Not authorized to delete this store" }, 403);
    }

    // Delete all staff under this store first
    const { data: storeStaff } = await svc
      .from("profiles")
      .select("id")
      .eq("parent_id", store_id);

    for (const s of storeStaff ?? []) {
      await svc.from("credit_transactions").update({ cashier_id: effectiveOwnerId }).eq("cashier_id", s.id);
      await svc.from("profiles").delete().eq("id", s.id);
      await svc.auth.admin.deleteUser(s.id);
    }

    // Delete the store profile then auth user
    await svc.from("profiles").delete().eq("id", store_id);
    await svc.auth.admin.deleteUser(store_id);

    // Decrement chain_bar_count on owner
    const { data: ownerRow } = await svc
      .from("profiles")
      .select("chain_bar_count")
      .eq("id", effectiveOwnerId)
      .single();

    await svc.from("profiles").update({
      chain_bar_count: Math.max(0, (ownerRow?.chain_bar_count ?? 1) - 1),
    }).eq("id", effectiveOwnerId);

    return json({ ok: true }, 200);

  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
