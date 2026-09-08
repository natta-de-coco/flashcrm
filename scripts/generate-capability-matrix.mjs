// Generates docs/social-capability-matrix.md from the connector registry.
//
// The matrix is generated rather than written so there is exactly one source
// of truth. A hand-maintained second copy is the thing that goes stale and
// starts advertising capabilities that do not exist -- which is the problem
// the registry was built to end.
//
//   npm run docs:capabilities
import { writeFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";

mkdirSync("node_modules/.cache", { recursive: true });
await build({
  entryPoints: ["src/lib/social-connector-definitions.ts"],
  outfile: "node_modules/.cache/flas-registry.mjs",
  format: "esm",
  bundle: false,
  logLevel: "error",
});

const reg = await import("../node_modules/.cache/flas-registry.mjs");
const {
  CONNECTOR_DEFINITIONS, CONNECTOR_COUNTS, CAPABILITY_KEYS, CAPABILITY_LABELS,
  STATUS_LABELS, resolveAllCapabilities,
} = reg;

const out = [];
out.push("# Social capability matrix");
out.push("");
out.push("**Generated from `src/lib/social-connector-definitions.ts` — do not edit by hand.**");
out.push("Regenerate with `npm run docs:capabilities`.");
out.push("");
out.push(`Generated ${new Date().toISOString().slice(0, 10)} · ${CONNECTOR_COUNTS.total} connectors ` +
  `(${CONNECTOR_COUNTS.oauthPlatforms} API platform connectors using OAuth, ` +
  `${CONNECTOR_COUNTS.keyedOrPlugin} connected with keys or a plugin).`);
out.push("");
out.push("## How to read this");
out.push("");
out.push("Two different things are recorded, and they must not be confused:");
out.push("");
out.push("- **Provider** — does the platform expose an API for this at all.");
out.push("- **Flas** — has Flas written the code that uses it.");
out.push("");
out.push("A capability is only usable when both are true *and* the scope it needs is actually");
out.push("requested at authorization. This document describes the static definition; what one");
out.push("connected account can do right now lives in the `social_capabilities` table and can");
out.push("only ever be narrower.");
out.push("");
for (const [k, v] of Object.entries(STATUS_LABELS)) out.push(`- \`${k}\` — ${v}`);
out.push("");

// Summary grid
out.push("## Summary");
out.push("");
const shown = CAPABILITY_KEYS.filter((k) =>
  CONNECTOR_DEFINITIONS.some((c) => c.capabilities[k].providerSupports));
out.push("| Connector | " + shown.map((k) => CAPABILITY_LABELS[k]).join(" | ") + " |");
out.push("|---|" + shown.map(() => "---").join("|") + "|");
const mark = (r) =>
  r.status === "implemented" ? "yes"
  : r.status === "not_supported" ? "—"
  : r.status === "not_implemented" ? "provider only"
  : r.status === "scope_not_requested" ? "**scope missing**"
  : r.status === "requires_provider_review" ? "review"
  : "account type";
for (const c of CONNECTOR_DEFINITIONS) {
  const byKey = Object.fromEntries(resolveAllCapabilities(c).map((r) => [r.key, r]));
  out.push(`| ${c.displayName} | ` + shown.map((k) => mark(byKey[k])).join(" | ") + " |");
}
out.push("");

// Per-connector detail
out.push("## Connectors");
for (const c of CONNECTOR_DEFINITIONS) {
  out.push("");
  out.push(`### ${c.displayName}`);
  out.push("");
  out.push(`- **ID**: \`${c.id}\` · **Category**: ${c.category} · **Auth**: ${c.authMethod}`);
  out.push(`- **Account types**: ${c.accountTypes.join("; ")}`);
  out.push(`- **Provider review required**: ${c.providerReviewRequired ? "yes" : "no"} · ` +
    `**Sandbox**: ${c.sandboxAvailable ? "yes" : "no"} · **Last verified**: ${c.lastVerified}`);
  out.push(`- **Requested scopes**: ${c.requestedScopes.length ? c.requestedScopes.map((s) => `\`${s}\``).join(", ") : "none (not OAuth)"}`);
  if (c.optionalScopes.length) {
    out.push(`- **Not requested**: ${c.optionalScopes.map((s) => `\`${s}\``).join(", ")}`);
  }
  out.push(`- **Setup**: ${c.setupRequirements.join("; ")}`);
  out.push(`- **Docs**: ${c.docs.map((d) => `<${d}>`).join(" · ")}`);
  out.push("");
  out.push("| Capability | Provider | Flas | Status | Required scopes | Note |");
  out.push("|---|---|---|---|---|---|");
  for (const r of resolveAllCapabilities(c)) {
    if (!r.providerSupports && !r.note) continue;
    out.push(
      `| ${CAPABILITY_LABELS[r.key]} | ${r.providerSupports ? "yes" : "no"} | ` +
      `${r.flasImplements ? "yes" : "no"} | ${STATUS_LABELS[r.status]} | ` +
      `${r.requiredScopes.length ? r.requiredScopes.map((s) => `\`${s}\``).join(", ") : "—"} | ` +
      `${(r.note ?? "").replace(/\|/g, "\|")} |`,
    );
  }
  if (c.knownLimitations.length) {
    out.push("");
    out.push("**Known limitations**");
    for (const l of c.knownLimitations) out.push(`- ${l}`);
  }
}

mkdirSync("docs", { recursive: true });
writeFileSync("docs/social-capability-matrix.md", out.join("\n") + "\n");
console.log(`Wrote docs/social-capability-matrix.md (${CONNECTOR_DEFINITIONS.length} connectors)`);
