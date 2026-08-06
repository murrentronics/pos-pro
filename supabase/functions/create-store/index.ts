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
    if (!isOwner && !isAdmin) return json({ error: "Only owners or admins can create stores" }, 403);

    const { owner_id, store_name, location = "" } = await req.json();
    if (!store_name) return json({ error: "store_name required" }, 400);

    // Resolve which owner this store belongs to
    const effectiveOwnerId: string = (isAdmin && owner_id) ? owner_id : user.id;

    // Verify the owner has chain or multi-bar plan
    const { data: ownerRow } = await svc
      .from("profiles")
      .select("chain_addon_active, is_multi_bar, addon_bar_count, chain_bar_count")
      .eq("id", effectiveOwnerId)
      .single();

    if (!ownerRow?.chain_addon_active && !ownerRow?.is_multi_bar && !isAdmin) {
      return json({ error: "Chain or multi-store plan not active" }, 403);
    }

    // Cap at 10 stores per owner
    const currentCount = ownerRow?.chain_bar_count ?? 0;
    if (currentCount >= 10) return json({ error: "Maximum 10 stores reached" }, 400);

    // Create a synthetic auth user for the sub-store
    const newId = crypto.randomUUID();
    const syntheticEmail = `store-${newId}@pospro.chain`;

    const { data: authData, error: createErr } = await svc.auth.admin.createUser({
      email: syntheticEmail,
      password: crypto.randomUUID(), // random, store is never signed into directly
      email_confirm: true,
      user_metadata: {
        username: store_name,
        role: "owner",
        parent_id: effectiveOwnerId,
      },
    });

    if (createErr) return json({ error: createErr.message }, 400);
    const storeId = authData.user.id;

    // Upsert the profile (trigger will have inserted a pending row; force-update it)
    await svc.from("profiles").upsert({
      id:             storeId,
      username:       store_name,
      role:           "owner",
      parent_id:      effectiveOwnerId,
      wallet_balance: 0,
      status:         "approved",
      address:        location,
      is_bar_account: true,
      plan_type:      "chain",
    }, { onConflict: "id" });

    // Increment the owner's chain_bar_count
    await svc.from("profiles").update({
      chain_bar_count: currentCount + 1,
    }).eq("id", effectiveOwnerId);

    return json({ id: storeId, store_name }, 200);

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
