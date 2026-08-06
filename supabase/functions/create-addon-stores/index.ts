import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Called when admin approves a multi-store / addon payment.
// Creates the specified number of stub store accounts under the owner,
// sets is_multi_bar=true and addon_bar_count, does NOT extend subscription_end_date.

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
    if (callerProfile?.role !== "admin") return json({ error: "Admin only" }, 403);

    const { payment_id } = await req.json();
    if (!payment_id) return json({ error: "payment_id required" }, 400);

    // Load payment to get owner + plan details
    const { data: payment, error: payErr } = await svc
      .from("billing_payments")
      .select("owner_id, addon_bar_count, addon_bar_data, billing_plans(plan_type, duration_months)")
      .eq("id", payment_id)
      .single();

    if (payErr || !payment) return json({ error: "Payment not found" }, 404);

    const ownerId: string     = payment.owner_id;
    const requestedCount: number = payment.addon_bar_count ?? 1;
    const addonData: Array<{ store_name?: string; location?: string }> =
      Array.isArray(payment.addon_bar_data) ? payment.addon_bar_data : [];

    // Get current owner state
    const { data: ownerRow } = await svc
      .from("profiles")
      .select("addon_bar_count, is_multi_bar, chain_bar_count")
      .eq("id", ownerId)
      .single();

    const existingAddonCount = ownerRow?.addon_bar_count ?? 0;
    const newAddonCount      = existingAddonCount + requestedCount;

    const createdIds: string[] = [];

    for (let i = 0; i < requestedCount; i++) {
      const storeMeta = addonData[i] ?? {};
      const storeName = storeMeta.store_name ?? `Store ${existingAddonCount + i + 1}`;
      const location  = storeMeta.location  ?? "";

      const syntheticEmail = `store-${crypto.randomUUID()}@pospro.addon`;
      const { data: authData, error: createErr } = await svc.auth.admin.createUser({
        email: syntheticEmail,
        password: crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { username: storeName, role: "owner", parent_id: ownerId },
      });

      if (createErr) {
        console.error(`Failed to create store ${i + 1}:`, createErr.message);
        continue;
      }

      const storeId = authData.user.id;

      await svc.from("profiles").upsert({
        id:             storeId,
        username:       storeName,
        role:           "owner",
        parent_id:      ownerId,
        wallet_balance: 0,
        status:         "approved",
        address:        location,
        is_bar_account: true,
        plan_type:      "basic",
      }, { onConflict: "id" });

      createdIds.push(storeId);
    }

    // Update owner: set is_multi_bar + new addon_bar_count
    await svc.from("profiles").update({
      is_multi_bar:    true,
      addon_bar_count: newAddonCount,
    }).eq("id", ownerId);

    return json({ ok: true, created: createdIds.length, total_addon_stores: newAddonCount }, 200);

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
