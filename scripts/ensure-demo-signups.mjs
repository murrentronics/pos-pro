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
if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL / publishable key in .env");
  process.exit(1);
}

const demos = [
  { email: "demo1@posprott.com", username: "demo1" },
  { email: "demo2@posprott.com", username: "demo2" },
];

for (const demo of demos) {
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: demo.email,
      password: "123456",
      data: { username: demo.username, role: "owner" },
    }),
  });
  const body = await res.json().catch(() => ({}));
  const detail =
    body.msg ||
    body.message ||
    body.error_code ||
    body.error ||
    (body.user && body.user.id) ||
    JSON.stringify(body).slice(0, 120);
  console.log(demo.email, res.status, detail);
}
