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
const username = "renard";

async function main() {
  // Create if missing
  const signup = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      data: { username, role: "admin" },
    }),
  });
  const signupBody = await signup.json().catch(() => ({}));
  console.log("signup", signup.status, signupBody.user?.id || signupBody.msg || signupBody.message || signupBody.error_code || "ok");

  const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const session = await login.json();
  if (!login.ok) {
    console.error("login failed", session.error_description || session.msg || login.status);
    process.exit(1);
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
      username,
      role: "admin",
      status: "approved",
      billing_status: "active",
      has_login: true,
      parent_id: null,
    }),
  });
  const rows = await patch.json().catch(() => ({}));
  console.log(
    "profile",
    patch.status,
    Array.isArray(rows)
      ? { username: rows[0]?.username, role: rows[0]?.role, status: rows[0]?.status }
      : (rows.message || rows.hint || JSON.stringify(rows).slice(0, 200)),
  );

  // Confirm admin access shape
  const check = await fetch(
    `${url}/rest/v1/profiles?id=eq.${uid}&select=username,role,status`,
    { headers: { apikey: key, Authorization: `Bearer ${token}` } },
  );
  console.log("verify", await check.json());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
