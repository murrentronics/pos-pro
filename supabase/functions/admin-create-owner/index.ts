import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Admin creates a new owner account directly (without self-registration).
// Optionally activates a plan immediately.

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
      username,
      email,
      password,
      phone,
      address,
      plan_type = "basic",      // optional: activate plan immediately
      duration_months = 0,      // 0 = don't activate, just create pending
    } = await req.json();

    if (!username || !email || !password) {
      return json({ error: "username, email, and password are required" }, 400);
    }

    // Check username uniqueness
    const { data: existingUsername } = await svc
      .from("profiles").select("id").eq("username", username).maybeSingle();
    if (existingUsername) return json({ error: `Username "${username}" is already taken` }, 400);

    // Check email uniqueness
    const { data: { users: existingEmails } } = await svc.auth.admin.listUsers();
    if (existingEmails.some(u => u.email === email)) {
      return json({ error: `Email "${email}" is already registered` }, 400);
    }

    // Create auth user
    const { data: authData, error: createErr } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, role: "owner" },
    });

    if (createErr) return json({ error: createErr.message }, 400);
    const uid = authData.user.id;

    // Build profile update
    const now = new Date();
    const profileUpdate: Record<string, unknown> = {
      username,
      role:           "owner",
      status:         duration_months > 0 ? "approved" : "pending",
      parent_id:      null,
      has_login:      true,
      billing_status: duration_months > 0 ? "active" : "pending_setup",
      plan_type:      plan_type,
      ...(phone   ? { phone }   : {}),
      ...(address ? { address } : {}),
    };

    if (duration_months > 0) {
      const endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() + Number(duration_months));
      profileUpdate.subscription_start_date = now.toISOString();
      profileUpdate.subscription_end_date   = endDate.toISOString();
      if (plan_type === "chain") {
        profileUpdate.chain_addon_active = true;
        profileUpdate.chain_bar_count    = 1;
      }
    }

    // The trigger already inserted a pending profile row; update it
    const { error: profileErr } = await svc
      .from("profiles")
      .update(profileUpdate)
      .eq("id", uid);

    if (profileErr) {
      await svc.auth.admin.deleteUser(uid);
      return json({ error: "Failed to set up profile: " + profileErr.message }, 500);
    }

    return json({ id: uid, username, email }, 200);

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
