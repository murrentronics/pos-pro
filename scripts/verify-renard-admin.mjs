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

const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: key, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "renard@posprott.com", password: "Bestbarappever123$" }),
});
const session = await login.json();
if (!login.ok) {
  console.error("login fail", session);
  process.exit(1);
}

const rpc = await fetch(`${url}/rest/v1/rpc/admin_list_profiles`, {
  method: "POST",
  headers: {
    apikey: key,
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  },
  body: "{}",
});
const rows = await rpc.json();
console.log({
  login: "ok",
  role: "admin",
  admin_list_ok: rpc.ok,
  owner_count: Array.isArray(rows) ? rows.filter((r) => r.role === "owner").length : rows,
});
