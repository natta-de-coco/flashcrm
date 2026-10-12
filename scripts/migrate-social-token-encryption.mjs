// Moves social provider tokens from the plaintext columns to *_enc (Batch 1,
// Phase 6), and re-encrypts under a new key when rotating.
//
//   node scripts/migrate-social-token-encryption.mjs            # dry run
//   node scripts/migrate-social-token-encryption.mjs --apply    # write
//   node scripts/migrate-social-token-encryption.mjs --rotate --apply
//
// Needs, in the environment (never on the command line, which shells record):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   SOCIAL_TOKEN_ENCRYPTION_KEYS, SOCIAL_TOKEN_ACTIVE_KEY_ID
//
// Per row, in this order -- a failure at any step leaves the plaintext in
// place, so nothing is ever lost:
//   1. read plaintext server-side
//   2. encrypt, bound to (tenant, platform, field)
//   3. write the envelope and the key id
//   4. read it back and decrypt; it must equal the plaintext
//   5. only then NULL the plaintext columns
//
// Prints row ids and counts. Never a token, a key or an envelope.
import { build } from "esbuild";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const ROTATE = process.argv.includes("--rotate");

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SOCIAL_TOKEN_ENCRYPTION_KEYS", "SOCIAL_TOKEN_ACTIVE_KEY_ID"]) {
  if (!process.env[name]) {
    console.error(`Missing ${name}. Set it in the environment, not on the command line.`);
    process.exit(2);
  }
}

fs.mkdirSync("node_modules/.cache", { recursive: true });
await build({
  entryPoints: ["src/lib/social-secrets.server.ts"],
  outfile: "node_modules/.cache/flas-secrets.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
});
const secrets = await import("../node_modules/.cache/flas-secrets.mjs");
secrets.readKeyRing(); // fail fast, before touching any row

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const COLS = "id, tenant_id, platform, access_token, refresh_token, access_token_enc, refresh_token_enc, token_key_id";
const stats = { seen: 0, migrated: 0, rotated: 0, skipped: 0, failed: 0 };
const PAGE = 200;

async function encryptPair(row, access, refresh) {
  const aad = (field) => secrets.tokenAad(row.tenant_id, row.platform, field);
  return {
    access_token_enc: access ? await secrets.encryptSecret(access, aad("access_token")) : null,
    refresh_token_enc: refresh ? await secrets.encryptSecret(refresh, aad("refresh_token")) : null,
    token_key_id: secrets.readKeyRing().active,
  };
}

async function verifyRow(id, row, access, refresh) {
  const { data, error } = await db.from("social_accounts").select(COLS).eq("id", id).eq("tenant_id", row.tenant_id).single();
  if (error || !data) return false;
  const aad = (field) => secrets.tokenAad(row.tenant_id, row.platform, field);
  try {
    const a = data.access_token_enc ? await secrets.decryptSecret(data.access_token_enc, aad("access_token")) : null;
    const r = data.refresh_token_enc ? await secrets.decryptSecret(data.refresh_token_enc, aad("refresh_token")) : null;
    return a === (access ?? null) && r === (refresh ?? null);
  } catch {
    return false;
  }
}

for (let from = 0; ; from += PAGE) {
  const { data: rows, error } = await db.from("social_accounts").select(COLS).order("id").range(from, from + PAGE - 1);
  if (error) {
    console.error("Could not read social_accounts:", error.code ?? "error");
    process.exit(1);
  }
  if (!rows?.length) break;

  for (const row of rows) {
    stats.seen++;
    const hasPlain = Boolean(row.access_token || row.refresh_token);
    const hasEnc = Boolean(row.access_token_enc || row.refresh_token_enc);

    if (!ROTATE) {
      if (!hasPlain) { stats.skipped++; continue; }
      if (hasEnc) {
        // Both present: an interrupted earlier run. Verify the envelope, then
        // clear plaintext -- never re-encrypt over a value we cannot confirm.
        const ok = await verifyRow(row.id, row, row.access_token, row.refresh_token);
        if (!ok) { stats.failed++; console.log(`  FAIL  ${row.id}  existing envelope does not match plaintext; left untouched`); continue; }
        if (APPLY) await db.from("social_accounts").update({ access_token: null, refresh_token: null }).eq("id", row.id).eq("tenant_id", row.tenant_id);
        stats.migrated++;
        continue;
      }
      if (!APPLY) { stats.migrated++; console.log(`  would migrate  ${row.id}`); continue; }
      const patch = await encryptPair(row, row.access_token, row.refresh_token);
      const { error: e1 } = await db.from("social_accounts").update(patch).eq("id", row.id).eq("tenant_id", row.tenant_id);
      if (e1) { stats.failed++; console.log(`  FAIL  ${row.id}  write refused (${e1.code ?? "error"})`); continue; }
      if (!(await verifyRow(row.id, row, row.access_token, row.refresh_token))) {
        stats.failed++;
        console.log(`  FAIL  ${row.id}  read-back did not decrypt to the original; plaintext kept`);
        continue;
      }
      const { error: e2 } = await db.from("social_accounts").update({ access_token: null, refresh_token: null }).eq("id", row.id).eq("tenant_id", row.tenant_id);
      if (e2) { stats.failed++; console.log(`  FAIL  ${row.id}  could not clear plaintext (${e2.code ?? "error"})`); continue; }
      stats.migrated++;
      console.log(`  ok    ${row.id}`);
      continue;
    }

    // --rotate: re-encrypt envelopes written under a non-active key.
    const stale = [row.access_token_enc, row.refresh_token_enc].some((v) => v && secrets.needsRotation(v));
    if (!stale) { stats.skipped++; continue; }
    const aad = (field) => secrets.tokenAad(row.tenant_id, row.platform, field);
    let access, refresh;
    try {
      access = row.access_token_enc ? await secrets.decryptSecret(row.access_token_enc, aad("access_token")) : null;
      refresh = row.refresh_token_enc ? await secrets.decryptSecret(row.refresh_token_enc, aad("refresh_token")) : null;
    } catch (e) {
      stats.failed++;
      console.log(`  FAIL  ${row.id}  cannot decrypt (${e.code ?? "error"}); is the old key still in the ring?`);
      continue;
    }
    if (!APPLY) { stats.rotated++; console.log(`  would rotate  ${row.id}`); continue; }
    const patch = await encryptPair(row, access, refresh);
    const { error: e3 } = await db.from("social_accounts").update(patch).eq("id", row.id).eq("tenant_id", row.tenant_id);
    if (e3 || !(await verifyRow(row.id, row, access, refresh))) {
      stats.failed++;
      console.log(`  FAIL  ${row.id}  rotation not confirmed`);
      continue;
    }
    stats.rotated++;
    console.log(`  ok    ${row.id}  rotated`);
  }
}

console.log("");
console.log(`${APPLY ? "APPLIED" : "DRY RUN"}${ROTATE ? " (rotate)" : ""}:`, JSON.stringify(stats));
if (!APPLY) console.log("Nothing was written. Re-run with --apply.");
process.exit(stats.failed ? 1 : 0);
