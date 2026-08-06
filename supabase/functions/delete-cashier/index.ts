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

    // ── Auth ──────────────────────────────────────────────────────────────────
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: callerProfile } = await svc
      .from("profiles").select("role").eq("id", user.id).single();
    const isOwner = callerProfile?.role === "owner";
    const isAdmin = callerProfile?.role === "admin";
    if (!isOwner && !isAdmin) return json({ error: "Only owners or admins can delete staff" }, 403);

    const { cashier_id } = await req.json();
    if (!cashier_id) return json({ error: "cashier_id required" }, 400);

    // ── Verify ownership ──────────────────────────────────────────────────────
    const { data: staffProfile } = await svc
      .from("profiles")
      .select("id, parent_id, role, wallet_balance")
      .eq("id", cashier_id)
      .single();

    if (!staffProfile) return json({ error: "Staff member not found" }, 404);

    // Owner can only delete their own staff; admin can delete anyone's staff
    if (isOwner && staffProfile.parent_id !== user.id) {
      return json({ error: "Not authorized to delete this staff member" }, 403);
    }

    const ownerId = isAdmin ? (staffProfile.parent_id ?? user.id) : user.id;

    // ── Transfer wallet balance to owner before deleting ──────────────────────
    if ((staffProfile.wallet_balance ?? 0) > 0) {
      await svc.from("profiles").update({
        wallet_balance: (staffProfile.wallet_balance ?? 0),
      }).eq("id", ownerId); // will be added below via increment

      // Use RPC to safely increment
      await svc.rpc("transfer_cashier_to_owner", { _cashier_id: cashier_id });
    }

    // ── Reassign credit transactions so FK doesn't block delete ──────────────
    await svc.from("credit_transactions")
      .update({ cashier_id: ownerId })
      .eq("cashier_id", cashier_id);

    // ── Delete profile then auth user ─────────────────────────────────────────
    await svc.from("profiles").delete().eq("id", cashier_id);
    await svc.auth.admin.deleteUser(cashier_id);

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
