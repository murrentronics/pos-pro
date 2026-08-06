import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Resets any staff member's password.
// Caller must be the owner of that staff member, or an admin.

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
    if (!isOwner && !isAdmin) return json({ error: "Only owners or admins can reset passwords" }, 403);

    const { cashier_id, new_password } = await req.json();
    if (!cashier_id)   return json({ error: "cashier_id required" }, 400);
    if (!new_password) return json({ error: "new_password required" }, 400);
    if (new_password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);

    // Verify ownership
    const { data: staffProfile } = await svc
      .from("profiles")
      .select("id, parent_id, role")
      .eq("id", cashier_id)
      .single();

    if (!staffProfile) return json({ error: "Staff member not found" }, 404);
    if (isOwner && staffProfile.parent_id !== user.id) {
      return json({ error: "Not authorized to reset this staff member's password" }, 403);
    }

    // Owners cannot reset other owners' passwords via this endpoint
    if (staffProfile.role === "owner") {
      return json({ error: "Cannot reset an owner password via this endpoint" }, 403);
    }

    const { error: resetErr } = await svc.auth.admin.updateUserById(cashier_id, {
      password: new_password,
    });

    if (resetErr) return json({ error: resetErr.message }, 400);

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
