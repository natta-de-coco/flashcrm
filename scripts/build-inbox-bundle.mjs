import { build } from "esbuild";
import { mkdirSync } from "node:fs";

// The Inbox's paging, search and unread rules as one module node --test can
// load. Same shape as the other bundle scripts.
mkdirSync("node_modules/.cache", { recursive: true });
await build({
  stdin: {
    contents: `export * from './src/lib/inbox-thread';`,
    resolveDir: process.cwd(),
  },
  outfile: "node_modules/.cache/flas-inbox.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
  alias: { "@": "./src" },
});
