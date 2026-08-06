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

    // ── Auth: caller must be owner or admin ───────────────────────────────────
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: callerProfile } = await svc
      .from("profiles").select("role, parent_id").eq("id", user.id).single();

    const isOwner = callerProfile?.role === "owner";
    const isAdmin = callerProfile?.role === "admin";
    if (!isOwner && !isAdmin) return json({ error: "Only owners or admins can create staff" }, 403);

    const {
      username,
      password,
      role = "cashier",       // "cashier" | "manager" | "custom"
      job_title,
      bar_owner_id,           // for chain owners: which sub-store to attach to
      owner_id,               // admin can specify whose account to create under
    } = await req.json();

    if (!username || !password) return json({ error: "username and password are required" }, 400);
    if (!["cashier", "manager", "custom"].includes(role)) {
      return json({ error: "role must be cashier, manager, or custom" }, 400);
    }

    // Resolve the parent_id:
    // - Admin can pass owner_id to create staff under any owner
    // - Owner creates staff under themselves (or a chain sub-store)
    let parentId = user.id;
    if (isAdmin && owner_id) {
      parentId = owner_id;
    } else if (bar_owner_id && bar_owner_id !== user.id) {
      const { data: barProfile } = await svc
        .from("profiles")
        .select("id, parent_id, is_bar_account")
        .eq("id", bar_owner_id)
        .single();
      if (barProfile?.parent_id === user.id && barProfile?.is_bar_account) {
        parentId = bar_owner_id;
      }
    }

    // Unique username check
    const { data: existing } = await svc
      .from("profiles").select("id").eq("username", username).maybeSingle();
    if (existing) return json({ error: `Username "${username}" is already taken` }, 400);

    const isCustom   = role === "custom";
    const isManager  = role === "manager";
    const effectiveRole = isCustom ? "custom" : isManager ? "manager" : "cashier";

    // Create auth user — email is synthetic, never used for login
    const { data: authData, error: createErr } = await svc.auth.admin.createUser({
      email: `${username}@pospro.staff`,
      password,
      email_confirm: true,
      user_metadata: { username, role: effectiveRole, parent_id: parentId },
    });

    if (createErr) {
      const msg = createErr.message.toLowerCase();
      if (msg.includes("already") || msg.includes("duplicate")) {
        return json({ error: `Username "${username}" is already taken` }, 400);
      }
      return json({ error: createErr.message }, 400);
    }

    const uid = authData.user.id;

    // Force-set the profile fields (trigger may have set them, but be explicit)
    const { error: profileErr } = await svc.from("profiles").update({
      parent_id:  parentId,
      role:       effectiveRole as "cashier" | "manager" | "custom",
      status:     "approved",
      has_login:  !isCustom,
      ...(isManager ? { job_title: "manager" } : {}),
      ...(isCustom  ? { job_title: job_title ?? null } : {}),
    }).eq("id", uid);

    if (profileErr) {
      await svc.auth.admin.deleteUser(uid);
      return json({ error: "Failed to update profile: " + profileErr.message }, 500);
    }

    return json({ id: uid, username }, 200);

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
