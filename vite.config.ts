// Build config — uses @lovable.dev/vite-tanstack-config which bundles TanStack Start,
// Cloudflare Workers, React, Tailwind, tsconfig paths and other required plugins.
// Do NOT add those plugins manually or the build will fail with duplicates.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const externalSupabaseUrl = "https://wpuqdwrndjswjzieoinx.supabase.co";
const externalSupabasePublishableKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndwdXFkd3JuZGpzd2p6aWVvaW54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MzgzMzYsImV4cCI6MjEwMTUxNDMzNn0.d-uguw1p2gUgqjxf_WhZSvXwQD6AbB-A2pIIZah7nFc";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    customViteReactPlugin: true,
  },
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(externalSupabaseUrl),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify("wpuqdwrndjswjzieoinx"),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(externalSupabasePublishableKey),
      "process.env.SUPABASE_URL": JSON.stringify(externalSupabaseUrl),
      "process.env.SUPABASE_PUBLISHABLE_KEY": JSON.stringify(externalSupabasePublishableKey),
    },
  },
});
