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

    // ── Auth: must be admin ───────────────────────────────────────────────────
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const { data: caller } = await svc.from("profiles").select("role").eq("id", user.id).single();
    if (caller?.role !== "admin") return json({ error: "Admin only" }, 403);

    const body = await req.json();
    // Accepts either owner_id (admin-initiated) or payment_id (billing-flow)
    const owner_id: string | undefined  = body.owner_id;
    const payment_id: string | undefined = body.payment_id;
    const force: boolean = body.force === true;

    if (!owner_id && !payment_id) {
      return json({ error: "owner_id or payment_id required" }, 400);
    }

    let ownerId = owner_id ?? "";

    // Resolve owner from payment if payment_id was provided
    if (payment_id && !owner_id) {
      const { data: pay, error: payErr } = await svc
        .from("billing_payments")
        .select("owner_id")
        .eq("id", payment_id)
        .single();
      if (payErr || !pay) return json({ error: "Payment not found" }, 404);
      ownerId = pay.owner_id;
    }

    // ── Addon guard ───────────────────────────────────────────────────────────
    // For P.O.S. Pro the only active addons are chain and multi-bar.
    // If addons are active and force is not set, warn the admin first.
    if (!force) {
      const { data: ownerRow } = await svc
        .from("profiles")
        .select("chain_addon_active, is_multi_bar, addon_bar_count")
        .eq("id", ownerId)
        .single();

      const activeAddons: string[] = [];
      if (ownerRow?.chain_addon_active)               activeAddons.push("Chain of Stores");
      if (ownerRow?.is_multi_bar && (ownerRow?.addon_bar_count ?? 0) > 0)
                                                       activeAddons.push("Extra Store addon");

      if (activeAddons.length > 0) {
        return json({ has_addons: true, addons: activeAddons }, 200);
      }
    }

    // ── 1. Delete all staff (cashiers / managers / custom) ───────────────────
    const { data: staff } = await svc
      .from("profiles")
      .select("id")
      .eq("parent_id", ownerId)
      .in("role", ["cashier", "manager", "custom"]);

    for (const s of staff ?? []) {
      await svc.from("credit_transactions").update({ cashier_id: ownerId }).eq("cashier_id", s.id);
      await svc.from("profiles").delete().eq("id", s.id);
      await svc.auth.admin.deleteUser(s.id);
    }

    // ── 2. Delete all child store accounts (chain / multi-bar) ───────────────
    const { data: stores } = await svc
      .from("profiles")
      .select("id")
      .eq("parent_id", ownerId)
      .eq("is_bar_account", true);

    for (const store of stores ?? []) {
      await svc.from("profiles").delete().eq("id", store.id);
      await svc.auth.admin.deleteUser(store.id);
    }

    // ── 3. Delete all billing payments for this owner ─────────────────────────
    if (payment_id) {
      await svc.from("billing_payments").delete().eq("id", payment_id);
    } else {
      await svc.from("billing_payments").delete().eq("owner_id", ownerId);
    }

    // ── 4. Full profile reset ─────────────────────────────────────────────────
    await svc.from("profiles").update({
      status:                  "pending",
      billing_status:          "pending_setup",
      plan_type:               "basic",
      subscription_start_date: null,
      subscription_end_date:   null,
      chain_addon_active:      false,
      chain_bar_count:         0,
      addon_bar_count:         0,
      is_multi_bar:            false,
      wallet_balance:          0,
    }).eq("id", ownerId);

    return json({ ok: true }, 200);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
