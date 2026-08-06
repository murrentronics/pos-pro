import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Lets an admin directly set a plan on any owner without going through the
// billing payment flow. Useful for comps, manual activations, corrections.

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

    const {
      owner_id,
      plan_type,         // "basic" | "premium" | "premium_20" | "chain"
      duration_months,   // 6 or 12
    } = await req.json();

    if (!owner_id)        return json({ error: "owner_id required" }, 400);
    if (!plan_type)       return json({ error: "plan_type required" }, 400);
    if (!duration_months) return json({ error: "duration_months required" }, 400);

    const validPlans = ["basic", "premium", "premium_20", "chain"];
    if (!validPlans.includes(plan_type)) {
      return json({ error: `plan_type must be one of: ${validPlans.join(", ")}` }, 400);
    }

    // Verify the owner exists
    const { data: ownerRow } = await svc
      .from("profiles")
      .select("id, role, parent_id, subscription_end_date, billing_status")
      .eq("id", owner_id)
      .single();

    if (!ownerRow || ownerRow.role !== "owner" || ownerRow.parent_id) {
      return json({ error: "Target must be a root owner account" }, 400);
    }

    const now = new Date();

    // Extend from existing end date if currently active, otherwise from now
    const base = (
      ownerRow.billing_status === "active" &&
      ownerRow.subscription_end_date &&
      new Date(ownerRow.subscription_end_date) > now
    ) ? new Date(ownerRow.subscription_end_date) : now;

    const endDate = new Date(base);
    endDate.setMonth(endDate.getMonth() + Number(duration_months));

    const updates: Record<string, unknown> = {
      status:                  "approved",
      billing_status:          "active",
      plan_type,
      subscription_start_date: now.toISOString(),
      subscription_end_date:   endDate.toISOString(),
    };

    if (plan_type === "chain") {
      updates.chain_addon_active = true;
      // Only set chain_bar_count to 1 if they don't already have stores
      const { count } = await svc
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("parent_id", owner_id)
        .eq("is_bar_account", true);
      if ((count ?? 0) === 0) updates.chain_bar_count = 1;
    }

    await svc.from("profiles").update(updates).eq("id", owner_id);

    return json({
      ok: true,
      plan_type,
      subscription_end_date: endDate.toISOString(),
    }, 200);

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
