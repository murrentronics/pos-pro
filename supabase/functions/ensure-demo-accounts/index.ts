import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEMOS = [
  { email: "demo1@posprott.com", username: "demo1", password: "123456" },
  { email: "demo2@posprott.com", username: "demo2", password: "123456" },
] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const svc = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: caller } = await svc.from("profiles").select("role").eq("id", user.id).single();
    if (caller?.role !== "admin") return json({ error: "Admin only" }, 403);

    const end = new Date("2099-12-31T23:59:59.000Z").toISOString();
    const results: { email: string; id: string; created: boolean }[] = [];

    for (const demo of DEMOS) {
      // Find existing by listing (email filter not always available)
      let existingId: string | null = null;
      let page = 1;
      while (page <= 20 && !existingId) {
        const { data: listed } = await svc.auth.admin.listUsers({ page, perPage: 200 });
        const hit = listed?.users?.find((u) => (u.email ?? "").toLowerCase() === demo.email);
        if (hit) existingId = hit.id;
        if (!listed?.users?.length || listed.users.length < 200) break;
        page += 1;
      }

      let uid = existingId;
      let created = false;

      if (!uid) {
        const { data: authData, error: createErr } = await svc.auth.admin.createUser({
          email: demo.email,
          password: demo.password,
          email_confirm: true,
          user_metadata: { username: demo.username, role: "owner" },
        });
        if (createErr) return json({ error: `${demo.email}: ${createErr.message}` }, 400);
        uid = authData.user.id;
        created = true;
      } else {
        const { error: pwErr } = await svc.auth.admin.updateUserById(uid, {
          password: demo.password,
          email_confirm: true,
          user_metadata: { username: demo.username, role: "owner" },
        });
        if (pwErr) return json({ error: `${demo.email}: ${pwErr.message}` }, 400);
      }

      const { error: profileErr } = await svc.from("profiles").upsert({
        id: uid,
        username: demo.username,
        role: "owner",
        parent_id: null,
        status: "approved",
        billing_status: "active",
        plan_type: "basic",
        subscription_start_date: new Date().toISOString(),
        subscription_end_date: end,
        has_login: true,
        wallet_balance: 0,
      }, { onConflict: "id" });

      if (profileErr) {
        // Trigger may have already inserted; fall back to update
        const { error: updErr } = await svc.from("profiles").update({
          username: demo.username,
          role: "owner",
          parent_id: null,
          status: "approved",
          billing_status: "active",
          plan_type: "basic",
          subscription_end_date: end,
          has_login: true,
        }).eq("id", uid);
        if (updErr) return json({ error: `${demo.email} profile: ${updErr.message}` }, 500);
      }

      await svc.from("billing_payments").delete().eq("owner_id", uid);
      results.push({ email: demo.email, id: uid!, created });
    }

    return json({ ok: true, results });
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
