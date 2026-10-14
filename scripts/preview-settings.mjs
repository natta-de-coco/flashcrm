import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const repo = path.resolve(import.meta.dirname, "..");
const runtime = path.join(repo, "scripts/settings-preview/runtime.tsx");
const functions = path.join(repo, "scripts/settings-preview/functions.ts");
const aliases = ["@/hooks/useAuth", "@/hooks/useTenant", "@/hooks/useI18n"].map((find) => ({
  find,
  replacement: runtime,
}));
for (const find of [
  "@/lib/workspace.functions",
  "@/lib/profile-settings.functions",
  "@/lib/billing.functions",
  "@/lib/invoice-branding.functions",
  "@/lib/lead-alerts.functions",
  "@/lib/notifications.functions",
  "@/integrations/supabase/client",
])
  aliases.push({ find, replacement: functions });
aliases.push(
  {
    find: /^@tanstack\/react-start$/,
    replacement: path.join(repo, "scripts/settings-preview/server-fn.ts"),
  },
  { find: "@", replacement: path.join(repo, "src") },
);
const server = await createServer({
  configFile: false,
  root: path.join(repo, "scripts/settings-preview"),
  publicDir: path.join(repo, "public"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: aliases, dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 4316, strictPort: true, fs: { allow: [repo] } },
});
await server.listen();
server.printUrls();
