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

for (const email of ["demo1@posprott.com", "demo2@posprott.com"]) {
  const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "123456" }),
  });
  const session = await login.json();
  if (!login.ok) {
    console.log(email, "LOGIN FAIL", session.error_description || login.status);
    continue;
  }
  const uid = session.user.id;
  const prof = await fetch(
    `${url}/rest/v1/profiles?id=eq.${uid}&select=username,status,billing_status,plan_type,subscription_end_date`,
    { headers: { apikey: key, Authorization: `Bearer ${session.access_token}` } },
  );
  const rows = await prof.json();
  const pays = await fetch(
    `${url}/rest/v1/billing_payments?owner_id=eq.${uid}&select=id`,
    { headers: { apikey: key, Authorization: `Bearer ${session.access_token}` } },
  );
  const payRows = await pays.json();
  console.log(email, {
    login: "ok",
    profile: rows[0],
    billing_payments: Array.isArray(payRows) ? payRows.length : payRows,
  });
}
