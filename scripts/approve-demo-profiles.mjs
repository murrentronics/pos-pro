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
const end = "2099-12-31T23:59:59.000Z";

const demos = [
  { email: "demo1@posprott.com", username: "demo1" },
  { email: "demo2@posprott.com", username: "demo2" },
];

for (const demo of demos) {
  const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: demo.email, password: "123456" }),
  });
  const session = await login.json();
  if (!login.ok) {
    console.log(demo.email, "login failed", session.error_description || session.msg || login.status);
    continue;
  }
  const uid = session.user.id;
  const token = session.access_token;

  const patch = await fetch(`${url}/rest/v1/profiles?id=eq.${uid}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      username: demo.username,
      status: "approved",
      billing_status: "active",
      plan_type: "basic",
      subscription_end_date: end,
      has_login: true,
    }),
  });
  const body = await patch.json().catch(() => ({}));
  console.log(
    demo.email,
    "patch",
    patch.status,
    Array.isArray(body) ? `ok status=${body[0]?.status}` : (body.message || body.hint || JSON.stringify(body).slice(0, 160)),
  );
}
