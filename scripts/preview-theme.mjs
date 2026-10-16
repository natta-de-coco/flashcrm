// Isolated visual preview. Does not load auth, Supabase, server functions or customer data.
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const repo = path.resolve(import.meta.dirname, "..");
const server = await createServer({
  configFile: false,
  root: path.join(repo, "scripts/theme-preview"),
  publicDir: path.join(repo, "public"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.join(repo, "src") }, dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 4314, strictPort: true, fs: { allow: [repo] } },
});
await server.listen();
server.printUrls();
