#!/usr/bin/env node
// Pulls recent production errors into a local file.
//
// Why this exists: Claude cannot watch your database. There is no background
// process reading production between sessions, and any claim otherwise would be
// a claim about access that does not exist. What it can do is read a file in
// this repository. So this script is the bridge — you run one command, it
// writes a report, and Claude reads it and works from real data instead of
// asking you to paste screenshots.
//
//   npm run errors           # last 24 hours
//   npm run errors -- 7      # last 7 days
//
// Writes .errors/latest.md (human-readable) and .errors/latest.json (full
// detail). Both are gitignored: they contain customer emails and stack traces,
// and that is not something to commit.
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env. The service role
// is required because these tables are deliberately not readable from a
// browser session.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, ".errors");

/** Minimal .env reader — avoids adding a dependency for six lines of parsing. */
function loadEnv() {
  const env = { ...process.env };
  for (const file of [".env.production", ".env"]) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, k, raw] = m;
      if (env[k]) continue; // real environment wins over the file
      env[k] = raw.trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = loadEnv();
const URL_ = env["SUPABASE_URL"] || env["VITE_SUPABASE_URL"];
const KEY = env["SUPABASE_SERVICE_ROLE_KEY"];

if (!URL_ || !KEY) {
  console.error(
    "Missing credentials.\n" +
      `  SUPABASE_URL${URL_ ? " ok" : " MISSING"}\n` +
      `  SUPABASE_SERVICE_ROLE_KEY${KEY ? " ok" : " MISSING"}\n\n` +
      "Add them to .env (see .env.example). The service role key is in your\n" +
      "Supabase dashboard under Project Settings -> API. Keep it out of git.",
  );
  process.exit(1);
}

const days = Number(process.argv[2] ?? 1);
const since = new Date(Date.now() - days * 86_400_000).toISOString();

async function rest(pathAndQuery) {
  const res = await fetch(`${URL_.replace(/\/+$/, "")}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${await res.text()}`);
  return res.json();
}

// Same fingerprinting as the manager portal, so the two agree.
const fingerprint = (m) =>
  m
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b\d{4,}\b/g, "<n>")
    .replace(/https?:\/\/[^\s"')]+/g, "<url>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);

console.log(`Reading errors since ${since} …`);

const [events, integration, orgs] = await Promise.all([
  rest(
    `error_events?select=id,kind,severity,message,stack,route,url,tenant_id,user_id,user_email,release,created_at&created_at=gte.${since}&order=created_at.desc&limit=2000`,
  ),
  rest(
    `integration_errors?select=id,tenant_id,platform,feature,operation,http_status,provider_code,provider_message,friendly_title,friendly_message,likely_cause,recommended_fix,severity,retryable,occurrence_count,first_seen,last_seen,resolved_at&last_seen=gte.${since}&order=occurrence_count.desc&limit=300`,
  ),
  rest("organizations?select=id,name"),
]);

const orgName = new Map(orgs.map((o) => [o.id, o.name]));

const groups = new Map();
for (const e of events) {
  const fp = fingerprint(e.message);
  let g = groups.get(fp);
  if (!g) {
    g = {
      fingerprint: fp, message: e.message, kind: e.kind, severity: e.severity,
      count: 0, firstSeen: e.created_at, lastSeen: e.created_at,
      routes: new Set(), releases: new Set(), companies: new Set(), users: new Set(),
      sampleStack: e.stack, sampleUrl: e.url,
    };
    groups.set(fp, g);
  }
  g.count++;
  if (e.created_at < g.firstSeen) g.firstSeen = e.created_at;
  if (e.created_at > g.lastSeen) g.lastSeen = e.created_at;
  if (e.severity === "critical") g.severity = "critical";
  if (!g.sampleStack && e.stack) g.sampleStack = e.stack;
  if (e.route) g.routes.add(e.route);
  if (e.release) g.releases.add(e.release);
  if (e.tenant_id) g.companies.add(orgName.get(e.tenant_id) ?? e.tenant_id.slice(0, 8));
  g.users.add(e.user_id ?? `anon:${e.id}`);
}

const ranked = [...groups.values()]
  .map((g) => ({
    ...g,
    routes: [...g.routes], releases: [...g.releases],
    companies: [...g.companies], affectedUsers: g.users.size, users: undefined,
  }))
  .sort((a, b) => b.affectedUsers - a.affectedUsers || b.count - a.count);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(
  path.join(OUT_DIR, "latest.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), days, since, groups: ranked, integration }, null, 2),
);

// The markdown is what Claude actually reads — dense enough to be useful,
// short enough not to swamp a conversation.
const md = [];
md.push(`# Error report — last ${days} day${days === 1 ? "" : "s"}`);
md.push(`Generated ${new Date().toISOString()} · ${events.length} raw events, ${ranked.length} groups`);
if (events.length >= 2000) md.push(`\n> Hit the 2000-row read cap — narrow the window for an accurate picture.`);

md.push(`\n## App errors\n`);
if (ranked.length === 0) md.push("None.");
for (const g of ranked.slice(0, 25)) {
  md.push(`### ${g.severity.toUpperCase()} · ${g.affectedUsers} affected · ${g.count}×`);
  md.push(`**${g.message.slice(0, 300)}**`);
  md.push(`- kind: \`${g.kind}\``);
  md.push(`- routes: ${g.routes.join(", ") || "—"}`);
  md.push(`- companies: ${g.companies.join(", ") || "—"}`);
  md.push(`- release: ${g.releases.join(", ") || "—"}`);
  md.push(`- window: ${g.firstSeen} → ${g.lastSeen}`);
  if (g.sampleStack) {
    md.push("```\n" + g.sampleStack.split("\n").slice(0, 12).join("\n") + "\n```");
  }
  md.push("");
}

md.push(`\n## Provider & integration errors\n`);
const openInt = integration.filter((e) => !e.resolved_at);
if (openInt.length === 0) md.push("None open.");
for (const e of openInt.slice(0, 25)) {
  md.push(`### ${e.platform} · ${e.severity} · ${e.occurrence_count}×`);
  md.push(`**${e.friendly_title}** — ${orgName.get(e.tenant_id) ?? e.tenant_id.slice(0, 8)}`);
  md.push(`- ${e.friendly_message}`);
  if (e.likely_cause) md.push(`- likely cause: ${e.likely_cause}`);
  if (e.recommended_fix) md.push(`- recommended fix: ${e.recommended_fix}`);
  md.push(
    `- provider: ${[e.operation, e.http_status && `HTTP ${e.http_status}`, e.provider_code && `code ${e.provider_code}`].filter(Boolean).join(" · ") || "—"}`,
  );
  if (e.provider_message) md.push(`- raw: ${e.provider_message.slice(0, 300)}`);
  md.push("");
}

fs.writeFileSync(path.join(OUT_DIR, "latest.md"), md.join("\n"));

console.log(`\n  ${events.length} events -> ${ranked.length} groups`);
console.log(`  ${openInt.length} open provider errors`);
console.log(`\nWrote .errors/latest.md and .errors/latest.json`);
console.log(`Tell Claude: "read .errors/latest.md and fix what you find"`);
