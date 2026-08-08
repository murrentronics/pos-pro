/**
 * create-addon-bars — P.O.S. Pro
 *
 * Called by AdminBillingManagementPage when approving a bar_only_addon payment.
 * Creates each extra store sub-account under the owner and increments addon_bar_count.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type BarEntry = { name: string; location: string };

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify caller is an authenticated admin
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: callerProfile } = await supabase
      .from("profiles").select("role").eq("id", user.id).single();
    if (callerProfile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { payment_id } = await req.json();
    if (!payment_id) {
      return new Response(JSON.stringify({ error: "payment_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Load the payment
    const { data: payment, error: payErr } = await supabase
      .from("billing_payments")
      .select("*")
      .eq("id", payment_id)
      .single();

    if (payErr || !payment) {
      return new Response(JSON.stringify({ error: "Payment not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ownerId: string = payment.owner_id;
    const barData: BarEntry[] = (payment.addon_bar_data as BarEntry[]) ?? [];

    // Load owner profile
    const { data: ownerProfile } = await supabase
      .from("profiles")
      .select("addon_bar_count, subscription_end_date")
      .eq("id", ownerId)
      .single();

    if (!ownerProfile) {
      return new Response(JSON.stringify({ error: "Owner not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const createdIds: string[] = [];

    // Create a sub-account for each extra store
    for (const bar of barData) {
      const fakeEmail = `store-${crypto.randomUUID()}@pospro.internal`;

      const { data: authData, error: createError } = await supabase.auth.admin.createUser({
        email: fakeEmail,
        password: crypto.randomUUID(),
        email_confirm: true,
        user_metadata: {
          username: bar.name.trim(),
          role: "owner",
          parent_id: ownerId,
        },
      });

      if (createError || !authData.user) {
        console.error("Failed to create auth user:", createError?.message);
        continue;
      }

      const storeId = authData.user.id;

      const { error: profileError } = await supabase
        .from("profiles")
        .upsert({
          id:             storeId,
          username:       bar.name.trim(),
          role:           "owner",
          parent_id:      ownerId,
          wallet_balance: 0,
          status:         "approved",
          address:        bar.location.trim(),
          is_bar_account: true,
          plan_type:      "basic",
          billing_status: "active",
        }, { onConflict: "id" });

      if (profileError) {
        console.error("Failed to upsert profile:", profileError.message);
        await supabase.auth.admin.deleteUser(storeId);
        continue;
      }

      createdIds.push(storeId);
    }

    // Count actual sub-accounts from DB
    const { count: actualSubCount } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", ownerId)
      .eq("is_bar_account", true);

    const newAddonCount = actualSubCount ?? (ownerProfile.addon_bar_count ?? 0) + createdIds.length;

    // Update owner: mark multi-store, increment count
    await supabase.from("profiles").update({
      is_multi_bar:    true,
      addon_bar_count: newAddonCount,
      billing_status:  "active",
      status:          "approved",
    }).eq("id", ownerId);

    return new Response(
      JSON.stringify({ created: createdIds.length, ids: createdIds }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
