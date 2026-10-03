import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [l.slice(0, i).trim(), v];
    }),
);

const url = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/$/, "");
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;
const email = "renard@posprott.com";
const password = "Bestbarappever123$";

function addMonths(iso, months) {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d;
}

async function main() {
  const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const session = await login.json();
  if (!login.ok) {
    console.error("login failed", session.error_description || login.status);
    process.exit(1);
  }
  const token = session.access_token;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const ownersRes = await fetch(
    `${url}/rest/v1/profiles?select=id,username,role,billing_status,subscription_end_date,parent_id&subscription_end_date=not.is.null&order=subscription_end_date.desc`,
    { headers },
  );
  const allWithEnd = await ownersRes.json();
  if (!Array.isArray(allWithEnd)) {
    console.error("owners fetch failed", allWithEnd);
    process.exit(1);
  }
  console.log(
    "all end dates:",
    allWithEnd.map((o) => `${o.username}|${o.role}|${o.billing_status}|${o.subscription_end_date}|parent=${o.parent_id}`),
  );

  const owners = allWithEnd.filter((o) => o.role === "owner" && !o.parent_id);
  console.log(`owners scanned: ${owners.length}`);
  let fixed = 0;
  for (const owner of owners) {
    if (!owner.subscription_end_date) {
      console.log("skip (no end)", owner.username || owner.id);
      continue;
    }

    const payRes = await fetch(
      `${url}/rest/v1/billing_payments?owner_id=eq.${owner.id}&status=eq.paid&select=id,payment_date,approved_at,created_at,next_due_date,plan_id,billing_plans(plan_type,duration_months)&order=approved_at.desc.nullslast`,
      { headers },
    );
    const payments = await payRes.json();
    if (!Array.isArray(payments)) {
      console.log("payments error", owner.username, payments);
      continue;
    }

    const basic = payments.find((p) => p.billing_plans?.plan_type === "basic" || p.billing_plans?.plan_type === "chain");
    if (!basic) {
      console.log("skip (no basic pay)", owner.username, owner.subscription_end_date, "pays", payments.length);
      continue;
    }

    const months = Math.min(Number(basic.billing_plans?.duration_months) || 12, 12);
    const paidAt = basic.payment_date || basic.approved_at || basic.created_at;
    const correctEnd = addMonths(paidAt, months);
    const currentEnd = new Date(owner.subscription_end_date);
    const driftMs = currentEnd.getTime() - correctEnd.getTime();
    console.log(
      "check",
      owner.username,
      "current",
      owner.subscription_end_date,
      "paidAt",
      paidAt,
      "correct",
      correctEnd.toISOString(),
      "driftDays",
      Math.round(driftMs / 86400000),
    );
    if (driftMs <= 2 * 86400000) continue;

    const correctIso = correctEnd.toISOString();
    const patch = await fetch(`${url}/rest/v1/profiles?id=eq.${owner.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ subscription_end_date: correctIso }),
    });
    const patched = await patch.json();
    console.log(
      "fixed",
      owner.username || owner.id,
      owner.subscription_end_date,
      "→",
      correctIso,
      patch.status,
      Array.isArray(patched) ? "ok" : patched.message || patched,
    );

    await fetch(`${url}/rest/v1/billing_payments?id=eq.${basic.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ next_due_date: correctIso }),
    });

    const addons = payments.filter((p) =>
      ["bar_only_addon", "bar_addon", "machines_bar_addon"].includes(p.billing_plans?.plan_type),
    );
    for (const addon of addons) {
      await fetch(`${url}/rest/v1/billing_payments?id=eq.${addon.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ next_due_date: correctIso }),
      });
    }

    fixed += 1;
  }

  console.log(`done — fixed ${fixed} owner(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
