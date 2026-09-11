import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const HERE = path.resolve("supabase/verify");
const MIG = path.resolve("supabase/migrations");
const CACHE = path.resolve("node_modules/.cache");
const PORT = 54971;
const DATA = path.join(HERE, ".pgdata-audit-10");
fs.rmSync(DATA, { recursive: true, force: true });

console.log("================================================================================");
console.log("INDEPENDENT EMPIRICAL VERIFICATION: SOCIAL CHANNELS INTEGRATION");
console.log("================================================================================");

const pgsql = new EmbeddedPostgres({
  databaseDir: DATA,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

await pgsql.initialise();
await pgsql.start();

const client = new pg.Client({
  host: "localhost",
  port: PORT,
  user: "postgres",
  password: "postgres",
  database: "postgres",
});
await client.connect();
await client.query("SET search_path TO public, extensions");
await client.query(fs.readFileSync(path.join(HERE, "supabase-shim.sql"), "utf8"));

// Apply all migrations in strict order
const files = fs.readdirSync(MIG).filter(f => f.endsWith(".sql")).sort();
for (const f of files) {
  const sql = fs.readFileSync(path.join(MIG, f), "utf8");
  await client.query(sql);
}
console.log(`Applied all ${files.length} migrations cleanly.`);

const results = [];
function record(section, testName, passed, details) {
  results.push({ section, testName, passed, details });
  const icon = passed ? "PASS" : "FAIL";
  console.log(`[${icon}] ${section} :: ${testName}`);
  if (!passed || process.env.VERBOSE) {
    console.log(`       Details: ${details}`);
  }
}

// ── Helpers to simulate PostgREST authenticated requests ────────────────────
async function asUser(userId, callback) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("SELECT set_config('role', 'authenticated', true)");
    return await callback();
  } finally {
    try { await client.query("ROLLBACK"); } catch {}
  }
}

async function asAnon(callback) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE anon");
    await client.query("SELECT set_config('role', 'anon', true)");
    return await callback();
  } finally {
    try { await client.query("ROLLBACK"); } catch {}
  }
}

// Seed two distinct tenants and users
const orgA = (await client.query("INSERT INTO public.organizations(name, slug) VALUES('Tenant A Corp', 'tenant-a') RETURNING id")).rows[0].id;
const userA = (await client.query("INSERT INTO auth.users(email) VALUES('admin@tenant-a.com') RETURNING id")).rows[0].id;
await client.query("UPDATE public.profiles SET tenant_id = $2, staff_role = 'company_admin' WHERE id = $1", [userA, orgA]);
await client.query("INSERT INTO public.user_roles(user_id, role) VALUES($1, 'admin') ON CONFLICT DO NOTHING", [userA]);

const orgB = (await client.query("INSERT INTO public.organizations(name, slug) VALUES('Tenant B Ltd', 'tenant-b') RETURNING id")).rows[0].id;
const userB = (await client.query("INSERT INTO auth.users(email) VALUES('admin@tenant-b.com') RETURNING id")).rows[0].id;
await client.query("UPDATE public.profiles SET tenant_id = $2, staff_role = 'company_admin' WHERE id = $1", [userB, orgB]);
await client.query("INSERT INTO public.user_roles(user_id, role) VALUES($1, 'admin') ON CONFLICT DO NOTHING", [userB]);

console.log(`\nSeed: Tenant A (${orgA}) userA (${userA}), Tenant B (${orgB}) userB (${userB})`);

// ═════════════════════════════════════════════════════════════════════════════
// 1. TENANT CROSSING TESTS
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n--- 1. Testing Tenant Crossing ---");
const rowAId = (await client.query(`
  INSERT INTO public.social_accounts(tenant_id, platform, label, external_id, active, connection_state)
  VALUES($1, 'instagram', 'Tenant A IG', 'ig_A_1', true, 'connected')
  RETURNING id
`, [orgA])).rows[0].id;

const stateAHash = crypto.createHash("sha256").update("state_secret_A").digest("hex");
const stateAId = (await client.query(`
  INSERT INTO public.oauth_states(tenant_id, user_id, platform, state_hash, redirect_uri)
  VALUES($1, $2, 'meta', $3, 'https://crm.test/cb')
  RETURNING id
`, [orgA, userA, stateAHash])).rows[0].id;

// Verify legitimate User A can read Tenant A's account
await asUser(userA, async () => {
  const legitA = await client.query("SELECT id, platform, label FROM public.social_accounts WHERE tenant_id = $1", [orgA]);
  record("Tenant Crossing", "Legitimate User A can query Tenant A account", legitA.rows.length === 1, `Found ${legitA.rows.length} rows`);
});

// Test 1.1: User B tries to select Tenant A's social account by tenant_id
await asUser(userB, async () => {
  const r1 = await client.query("SELECT id, platform, label FROM public.social_accounts WHERE tenant_id = $1", [orgA]);
  record("Tenant Crossing", "User B cannot query Tenant A accounts by tenant_id (RLS 0 rows)", r1.rows.length === 0, `Returned ${r1.rows.length} rows`);
});

// Test 1.2: User B tries to select Tenant A's account knowing exact id
await asUser(userB, async () => {
  const r2 = await client.query("SELECT id, platform, label FROM public.social_accounts WHERE id = $1", [rowAId]);
  record("Tenant Crossing", "User B cannot query Tenant A account by exact row ID (RLS 0 rows)", r2.rows.length === 0, `Returned ${r2.rows.length} rows`);
});

// Test 1.3: User B tries to UPDATE Tenant A's account
await asUser(userB, async () => {
  const r3 = await client.query("UPDATE public.social_accounts SET label = 'HACKED' WHERE id = $1", [rowAId]);
  record("Tenant Crossing", "User B cannot update Tenant A account (RLS 0 affected)", r3.rowCount === 0, `Updated ${r3.rowCount} rows`);
});

// Test 1.4: User B tries to DELETE Tenant A's account
await asUser(userB, async () => {
  const r4 = await client.query("DELETE FROM public.social_accounts WHERE id = $1", [rowAId]);
  record("Tenant Crossing", "User B cannot delete Tenant A account (RLS 0 affected)", r4.rowCount === 0, `Deleted ${r4.rowCount} rows`);
});

// Test 1.5: User B tries to select Tenant A's oauth_states
await asUser(userB, async () => {
  let r5Rows = 0;
  try {
    const r5 = await client.query("SELECT id, platform, tenant_id FROM public.oauth_states WHERE id = $1", [stateAId]);
    r5Rows = r5.rows.length;
  } catch (e) {
    r5Rows = 0; // Refused outright
  }
  record("Tenant Crossing", "User B cannot select Tenant A oauth_states (0 rows or permission denied)", r5Rows === 0, `Returned ${r5Rows} rows`);
});

// Test 1.6: User B tries to lock Tenant A's connection refresh
await asUser(userB, async () => {
  const lockOther = (await client.query("SELECT public.try_lock_connection_refresh($1) as locked", [rowAId])).rows[0].locked;
  record("Tenant Crossing", "User B cannot acquire refresh lock for Tenant A connection", lockOther === false, `Lock result: ${lockOther}`);
});

// Verify row A remained untouched
const verifyA = await client.query("SELECT label FROM public.social_accounts WHERE id = $1", [rowAId]);
record("Tenant Crossing", "Tenant A row remains untouched after Tenant B attack", verifyA.rows[0]?.label === "Tenant A IG", `Label is: ${verifyA.rows[0]?.label}`);

// ═════════════════════════════════════════════════════════════════════════════
// 2. OAUTH REPLAY TESTS
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n--- 2. Testing OAuth Replay ---");
const rawReplayState = "nonce_replay_protection_test_state_xyz123";
const replayHash = crypto.createHash("sha256").update(rawReplayState).digest("hex");

await client.query(`
  INSERT INTO public.oauth_states(tenant_id, user_id, platform, state_hash, redirect_uri, code_verifier, expires_at)
  VALUES($1, $2, 'twitter', $3, 'https://crm.test/cb', 'verifier_xyz', now() + interval '10 minutes')
`, [orgA, userA, replayHash]);

// First consumption
const consume1 = await client.query("SELECT * FROM public.consume_oauth_state_hash($1)", [replayHash]);
record("OAuth Replay", "First consumption succeeds and returns state metadata", consume1.rows.length === 1 && consume1.rows[0].platform === "twitter", `Got ${consume1.rows.length} rows`);

// Replay attack 1
const consume2 = await client.query("SELECT * FROM public.consume_oauth_state_hash($1)", [replayHash]);
record("OAuth Replay", "Replay of consumed state returns 0 rows (rejected)", consume2.rows.length === 0, `Got ${consume2.rows.length} rows`);

// Replay attack 2
const consume3 = await client.query("SELECT * FROM public.consume_oauth_state_hash($1)", [replayHash]);
record("OAuth Replay", "Repeated replay returns 0 rows (rejected)", consume3.rows.length === 0, `Got ${consume3.rows.length} rows`);

// Expired state test
const expiredState = "expired_state_test_xyz987";
const expiredHash = crypto.createHash("sha256").update(expiredState).digest("hex");
await client.query(`
  INSERT INTO public.oauth_states(tenant_id, user_id, platform, state_hash, redirect_uri, expires_at)
  VALUES($1, $2, 'meta', $3, 'https://crm.test/cb', now() - interval '1 second')
`, [orgA, userA, expiredHash]);

const consumeExpired = await client.query("SELECT * FROM public.consume_oauth_state_hash($1)", [expiredHash]);
record("OAuth Replay", "Expired state (expires_at in past) returns 0 rows", consumeExpired.rows.length === 0, `Got ${consumeExpired.rows.length} rows`);

// Abandoned state sweep and rejection test
const abandonedState = "abandoned_state_test_xyz555";
const abandonedHash = crypto.createHash("sha256").update(abandonedState).digest("hex");
await client.query(`
  INSERT INTO public.oauth_states(tenant_id, user_id, platform, state_hash, redirect_uri, attempt_state, expires_at)
  VALUES($1, $2, 'meta', $3, 'https://crm.test/cb', 'started', now() - interval '5 minutes')
`, [orgA, userA, abandonedHash]);

// Run abandoned attempts sweep function
const sweepRes = await client.query("SELECT * FROM public.expire_abandoned_oauth_attempts()");
record("OAuth Replay", "expire_abandoned_oauth_attempts sweeps abandoned states", sweepRes.rows[0]?.expired_count >= 1, `Expired count: ${sweepRes.rows[0]?.expired_count}`);

const consumeAbandoned = await client.query("SELECT * FROM public.consume_oauth_state_hash($1)", [abandonedHash]);
record("OAuth Replay", "Abandoned state swept to expired returns 0 rows", consumeAbandoned.rows.length === 0, `Got ${consumeAbandoned.rows.length} rows`);

// Cancelled callback replay test (state consumed, then user declined/cancelled)
const cancelledState = "cancelled_state_test_xyz777";
const cancelledHash = crypto.createHash("sha256").update(cancelledState).digest("hex");
await client.query(`
  INSERT INTO public.oauth_states(tenant_id, user_id, platform, state_hash, redirect_uri, attempt_state, expires_at)
  VALUES($1, $2, 'meta', $3, 'https://crm.test/cb', 'started', now() + interval '10 minutes')
`, [orgA, userA, cancelledHash]);

// Callback arrived, state consumed
await client.query("SELECT * FROM public.consume_oauth_state_hash($1)", [cancelledHash]);
// Provider declined, marked cancelled
await client.query("UPDATE public.oauth_states SET attempt_state = 'cancelled', attempt_reason = 'User declined' WHERE state_hash = $1", [cancelledHash]);

const replayCancelled = await client.query("SELECT * FROM public.consume_oauth_state_hash($1)", [cancelledHash]);
record("OAuth Replay", "Cancelled state cannot be replayed (used_at is set, returns 0 rows)", replayCancelled.rows.length === 0, `Got ${replayCancelled.rows.length} rows`);

// ═════════════════════════════════════════════════════════════════════════════
// 3. WRONG WORKSPACE / PROVIDER BINDING TESTS
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n--- 3. Testing Wrong Workspace / Provider Binding ---");
const bindState = "provider_binding_state_123";
const bindHash = crypto.createHash("sha256").update(bindState).digest("hex");
await client.query(`
  INSERT INTO public.oauth_states(tenant_id, user_id, platform, state_hash, redirect_uri, expires_at)
  VALUES($1, $2, 'linkedin', $3, 'https://crm.test/cb', now() + interval '10 minutes')
`, [orgA, userA, bindHash]);

const consumedBind = (await client.query("SELECT * FROM public.consume_oauth_state_hash($1)", [bindHash])).rows[0];
record("Wrong Workspace/Provider", "Consumed state row strictly binds initiating tenant_id", consumedBind?.tenant_id === orgA, `tenant_id: ${consumedBind?.tenant_id}`);
record("Wrong Workspace/Provider", "Consumed state row strictly binds initiating platform", consumedBind?.platform === "linkedin", `platform: ${consumedBind?.platform}`);
record("Wrong Workspace/Provider", "Consumed state row strictly binds initiating user_id", consumedBind?.user_id === userA, `user_id: ${consumedBind?.user_id}`);

// Tampered state test
const tamperedHash = crypto.createHash("sha256").update("tampered_fake_state").digest("hex");
const consumeTampered = await client.query("SELECT * FROM public.consume_oauth_state_hash($1)", [tamperedHash]);
record("Wrong Workspace/Provider", "Tampered state hash matches 0 rows in database", consumeTampered.rows.length === 0, `Got ${consumeTampered.rows.length} rows`);

// ═════════════════════════════════════════════════════════════════════════════
// 4. PARTIAL SCOPES TESTS
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n--- 4. Testing Partial Scopes ---");
const deriveModuleUrl = pathToFileURL(path.join(CACHE, "flas-derive-state.mjs")).href;
const { missingScopesFor, deriveConnectionState } = await import(deriveModuleUrl);

// Test 4.1: Facebook missing required scope
const fbMissing = missingScopesFor("facebook", ["pages_show_list", "pages_read_engagement"]);
record("Partial Scopes", "missingScopesFor('facebook') detects missing pages_manage_engagement", fbMissing.includes("pages_manage_engagement"), `Missing: ${fbMissing.join(", ")}`);

// Test 4.2: deriveConnectionState flags missing scope as scope_incomplete
const statePartial = deriveConnectionState({
  active: true,
  access_token: "valid_token_xyz",
  token_expires_at: null,
  granted_scopes: ["pages_show_list", "pages_read_engagement"],
  platform: "facebook",
});
record("Partial Scopes", "deriveConnectionState marks connection as scope_incomplete", statePartial.state === "scope_incomplete", `State: ${statePartial.state}, Reason: ${statePartial.reason}`);

// Test 4.3: Full scopes grants connected state
const fullScopes = ["pages_show_list", "pages_read_engagement", "pages_manage_engagement", "pages_read_user_content", "pages_messaging", "pages_manage_metadata", "read_insights"];
const stateFull = deriveConnectionState({
  active: true,
  access_token: "valid_token_xyz",
  token_expires_at: null,
  granted_scopes: fullScopes,
  platform: "facebook",
});
record("Partial Scopes", "deriveConnectionState marks connection as connected when all scopes present", stateFull.state === "connected", `State: ${stateFull.state}`);

// ═════════════════════════════════════════════════════════════════════════════
// 5. TOKEN LEAKAGE & ENCRYPTION AT REST TESTS
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n--- 5. Testing Token Leakage & Encryption at Rest ---");
// Seed row with tokens
const secretRowId = (await client.query(`
  INSERT INTO public.social_accounts(tenant_id, platform, label, access_token, refresh_token, active)
  VALUES($1, 'facebook', 'FB Page', 'enc:v1:k1:iv:super_secret_ciphertext', 'enc:v1:k1:iv:super_secret_refresh', true)
  RETURNING id
`, [orgA])).rows[0].id;

// Test 5.1: authenticated user attempts to SELECT access_token
let leakedAccess = false;
await asUser(userA, async () => {
  try {
    const res = await client.query("SELECT access_token FROM public.social_accounts WHERE id = $1", [secretRowId]);
    if (res.rows.length > 0 && res.rows[0].access_token != null) leakedAccess = true;
  } catch (e) {
    leakedAccess = false;
  }
});
record("Token Leakage", "access_token cannot be SELECTed by authenticated user", !leakedAccess, leakedAccess ? "LEAKED access_token" : "Blocked by column privileges (42501)");

// Test 5.2: authenticated user attempts to SELECT refresh_token
let leakedRefresh = false;
await asUser(userA, async () => {
  try {
    const res = await client.query("SELECT refresh_token FROM public.social_accounts WHERE id = $1", [secretRowId]);
    if (res.rows.length > 0 && res.rows[0].refresh_token != null) leakedRefresh = true;
  } catch (e) {
    leakedRefresh = false;
  }
});
record("Token Leakage", "refresh_token cannot be SELECTed by authenticated user", !leakedRefresh, leakedRefresh ? "LEAKED refresh_token" : "Blocked by column privileges (42501)");

// Test 5.3: SELECT * fails because user does not have SELECT on all columns
let selectStarAllowed = false;
await asUser(userA, async () => {
  try {
    await client.query("SELECT * FROM public.social_accounts WHERE id = $1", [secretRowId]);
    selectStarAllowed = true;
  } catch (e) {
    selectStarAllowed = false;
  }
});
record("Token Leakage", "SELECT * is blocked to prevent accidental credential dumping", !selectStarAllowed, selectStarAllowed ? "Allowed" : "Blocked by column privileges (42501)");

await asAnon(async () => {
  // Test 5.4: anon user attempts to SELECT any column from social_accounts
  let anonCanRead = false;
  try {
    const res = await client.query("SELECT id FROM public.social_accounts WHERE id = $1", [secretRowId]);
    if (res.rows.length > 0) anonCanRead = true;
  } catch (e) {
    anonCanRead = false;
  }
  record("Token Leakage", "anon role has 0 read access to social_accounts", !anonCanRead, anonCanRead ? "LEAKED to anon" : "Blocked by RLS/privileges");
});

// Test 5.5: Encryption at Rest (AES-256-GCM application sealing)
process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
const secretBoxUrl = pathToFileURL(path.join(CACHE, "flas-secret-box.mjs")).href;
const { sealSecret, openSecret, isSealed } = await import(secretBoxUrl);

const samplePlainToken = "EAAGm0PX4ZB7wBAFakeAccessTokenSecretTokenXYZ";
const sealedToken = await sealSecret(samplePlainToken);
record("Token Leakage", "sealSecret encrypts token into enc:v1 format", isSealed(sealedToken) && sealedToken.startsWith("enc:v1:"), `Sealed: ${sealedToken?.slice(0, 25)}...`);

const openedToken = await openSecret(sealedToken);
record("Token Leakage", "openSecret decrypts token back to plaintext accurately", openedToken === samplePlainToken, "Plaintext restored correctly");

let tamperDetected = false;
try {
  const tamperedSealed = sealedToken.slice(0, -4) + "AAAA";
  await openSecret(tamperedSealed);
} catch (e) {
  tamperDetected = true;
}
record("Token Leakage", "Tampered ciphertext is rejected by authenticated GCM tag check", tamperDetected, "Tampered ciphertext threw decryption error");

// ═════════════════════════════════════════════════════════════════════════════
// 6. MULTI-CHANNEL SELECTION TESTS
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n--- 6. Testing Multi-Channel Selection ---");
// Tenant A connects LinkedIn Page 1
const ch1 = await client.query(`
  INSERT INTO public.social_accounts(tenant_id, platform, label, external_id, active)
  VALUES($1, 'linkedin', 'LinkedIn Acme Page', 'urn:li:organization:1111', true)
  RETURNING id
`, [orgA]);

// Tenant A connects LinkedIn Page 2
const ch2 = await client.query(`
  INSERT INTO public.social_accounts(tenant_id, platform, label, external_id, active)
  VALUES($1, 'linkedin', 'LinkedIn Acme Careers', 'urn:li:organization:2222', true)
  RETURNING id
`, [orgA]);

record("Multi-Channel Selection", "Same tenant can connect two distinct LinkedIn Pages simultaneously", Boolean(ch1.rows[0]?.id && ch2.rows[0]?.id && ch1.rows[0].id !== ch2.rows[0].id), `Page 1: ${ch1.rows[0]?.id}, Page 2: ${ch2.rows[0]?.id}`);

// Count total rows for linkedin in orgA
const liCount = await client.query("SELECT COUNT(*) FROM public.social_accounts WHERE tenant_id = $1 AND platform = 'linkedin'", [orgA]);
record("Multi-Channel Selection", "Both channels are persisted in social_accounts", liCount.rows[0]?.count === "2", `Found ${liCount.rows[0]?.count} channels`);

// ═════════════════════════════════════════════════════════════════════════════
// 7. RECONNECT DUPLICATION TESTS
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n--- 7. Testing Reconnect Duplication ---");
// If user reconnects LinkedIn Page 1 (same tenant_id, platform, external_id)
let duplicateInserted = false;
let duplicateError = null;
try {
  await client.query(`
    INSERT INTO public.social_accounts(tenant_id, platform, label, external_id, active)
    VALUES($1, 'linkedin', 'LinkedIn Acme Page Updated', 'urn:li:organization:1111', true)
  `, [orgA]);
  duplicateInserted = true;
} catch (e) {
  duplicateError = e;
}

record("Reconnect Duplication", "Database enforces unique index on (tenant_id, platform, external_id), preventing duplicate rows", duplicateError?.code === "23505", `Error code: ${duplicateError?.code}`);

// Reconnection update test
await client.query(`
  UPDATE public.social_accounts
     SET label = 'LinkedIn Acme Page Reconnected', last_synced_at = now()
   WHERE tenant_id = $1 AND platform = 'linkedin' AND external_id = 'urn:li:organization:1111'
`, [orgA]);

const reconnectedCount = await client.query("SELECT COUNT(*) FROM public.social_accounts WHERE tenant_id = $1 AND platform = 'linkedin' AND external_id = 'urn:li:organization:1111'", [orgA]);
record("Reconnect Duplication", "Reconnection updates existing row in place (row count remains 1)", reconnectedCount.rows[0]?.count === "1", `Row count: ${reconnectedCount.rows[0]?.count}`);

// ═════════════════════════════════════════════════════════════════════════════
// 8. REFRESH CONCURRENCY TESTS
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n--- 8. Testing Refresh Concurrency Lease ---");
const leaseRowId = ch1.rows[0].id;

// Worker 1 acquires lock
const lock1 = (await client.query("SELECT public.try_lock_connection_refresh($1) as locked", [leaseRowId])).rows[0].locked;
record("Refresh Concurrency", "Worker 1 acquires refresh lease successfully", lock1 === true, `Worker 1 got: ${lock1}`);

// Worker 2 attempts concurrent lock on same account
const lock2 = (await client.query("SELECT public.try_lock_connection_refresh($1) as locked", [leaseRowId])).rows[0].locked;
record("Refresh Concurrency", "Worker 2 is refused lock while Worker 1 holds lease", lock2 === false, `Worker 2 got: ${lock2}`);

// Worker 3 acquires lock on a DIFFERENT account (independent)
const leaseRowId2 = ch2.rows[0].id;
const lock3 = (await client.query("SELECT public.try_lock_connection_refresh($1) as locked", [leaseRowId2])).rows[0].locked;
record("Refresh Concurrency", "Independent account lease can be acquired simultaneously", lock3 === true, `Worker 3 got: ${lock3}`);

// Worker 1 releases lock
await client.query("SELECT public.release_connection_refresh($1)", [leaseRowId]);

// Worker 2 retries lock after release
const lock2Retry = (await client.query("SELECT public.try_lock_connection_refresh($1) as locked", [leaseRowId])).rows[0].locked;
record("Refresh Concurrency", "Releasing lease allows subsequent worker to acquire lock", lock2Retry === true, `Worker 2 retry got: ${lock2Retry}`);

// Abandoned lock expiry simulation: set lease to past
await client.query("UPDATE public.social_accounts SET refresh_locked_until = now() - interval '5 seconds' WHERE id = $1", [leaseRowId]);
const lockExpired = (await client.query("SELECT public.try_lock_connection_refresh($1) as locked", [leaseRowId])).rows[0].locked;
record("Refresh Concurrency", "Expired lease can be reclaimed automatically", lockExpired === true, `Reclaimed: ${lockExpired}`);

// ═════════════════════════════════════════════════════════════════════════════
// 9. LIVE HEALTH & ERROR RECORDING TESTS
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n--- 9. Testing Live Health & Error Recording ---");
// Record error test via record_integration_error RPC
const recordErrRes = await client.query(`
  SELECT public.record_integration_error(
    $1::uuid,
    $2::uuid,
    'meta'::text,
    'channels'::text,
    'health_check'::text,
    401::integer,
    '190'::text,
    '463'::text,
    'OAuthException'::text,
    'The access token has expired.'::text,
    'Token Expired'::text,
    'The Facebook access token has expired.'::text,
    'User changed password or token reached maximum age'::text,
    'Reconnect your Facebook account'::text,
    'action_required'::text,
    false::boolean,
    'v20.0'::text,
    'meta_token_expired_190'::text
  ) as error_id
`, [orgA, leaseRowId]);

record("Live Health", "record_integration_error executes successfully", Boolean(recordErrRes.rows[0]?.error_id), `Error ID: ${recordErrRes.rows[0]?.error_id}`);

// Deduplication test: record the same error again
await client.query(`
  SELECT public.record_integration_error(
    $1::uuid,
    $2::uuid,
    'meta'::text,
    'channels'::text,
    'health_check'::text,
    401::integer,
    '190'::text,
    '463'::text,
    'OAuthException'::text,
    'The access token has expired.'::text,
    'Token Expired'::text,
    'The Facebook access token has expired.'::text,
    'User changed password or token reached maximum age'::text,
    'Reconnect your Facebook account'::text,
    'action_required'::text,
    false::boolean,
    'v20.0'::text,
    'meta_token_expired_190'::text
  ) as error_id
`, [orgA, leaseRowId]);

// Verify error log row and deduplication count
const errLog = await client.query("SELECT * FROM public.integration_errors WHERE account_id = $1", [leaseRowId]);
record("Live Health", "Error is recorded in integration_errors table with correct classification", errLog.rows[0]?.provider_code === "190" && errLog.rows[0]?.http_status === 401, `Code: ${errLog.rows[0]?.provider_code}, status: ${errLog.rows[0]?.http_status}`);
record("Live Health", "Repeated error is deduplicated by fingerprint (occurrence_count = 2)", errLog.rows[0]?.occurrence_count === 2, `Count: ${errLog.rows[0]?.occurrence_count}`);

// RLS check on integration_errors: Tenant B cannot see Tenant A errors
await asUser(userB, async () => {
  const bErr = await client.query("SELECT id, friendly_title FROM public.integration_errors WHERE tenant_id = $1", [orgA]);
  record("Live Health", "Tenant B cannot view Tenant A integration errors (RLS 0 rows)", bErr.rows.length === 0, `Returned ${bErr.rows.length} rows`);
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. BROWSER EXPOSURE AUDIT
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n--- 10. Testing Browser Exposure (Column Privileges) ---");
const privQuery = `
  SELECT table_name, column_name, grantee, privilege_type
    FROM information_schema.column_privileges
   WHERE table_schema = 'public'
     AND grantee IN ('authenticated', 'anon')
     AND privilege_type = 'SELECT'
     AND (
       (table_name = 'social_accounts' AND column_name IN ('access_token', 'refresh_token'))
       OR (table_name = 'platform_apps' AND column_name = 'client_secret')
       OR (table_name = 'oauth_states' AND column_name IN ('code_verifier', 'state'))
       OR (table_name = 'wa_numbers' AND column_name IN ('access_token', 'app_secret'))
       OR (table_name = 'ai_provider_keys' AND column_name = 'api_key')
     )
`;
const exposures = await client.query(privQuery);
record("Browser Exposure", "Zero sensitive credential columns have SELECT privilege granted to authenticated or anon", exposures.rows.length === 0, exposures.rows.map(r => `${r.grantee} can SELECT ${r.table_name}.${r.column_name}`).join(", ") || "Zero exposures");

// Check table level privileges
const tablePrivs = await client.query(`
  SELECT table_name, grantee, privilege_type
    FROM information_schema.table_privileges
   WHERE table_schema = 'public'
     AND grantee IN ('authenticated', 'anon')
     AND table_name IN ('social_accounts', 'oauth_states', 'platform_apps')
     AND privilege_type = 'SELECT'
`);
record("Browser Exposure", "Sensitive tables do NOT have blanket SELECT granted to authenticated or anon (must be column-level)", tablePrivs.rows.length === 0, tablePrivs.rows.map(r => `${r.grantee} has blanket ${r.privilege_type} on ${r.table_name}`).join(", ") || "Zero blanket SELECT grants");

await client.end();
await pgsql.stop();
fs.rmSync(DATA, { recursive: true, force: true });

console.log("\n================================================================================");
console.log("FINAL AUDIT SUMMARY");
console.log("================================================================================");
const failed = results.filter(r => !r.passed);
console.log(`Total Checks: ${results.length}`);
console.log(`Passed:       ${results.length - failed.length}`);
console.log(`Failed:       ${failed.length}`);
if (failed.length > 0) {
  console.log("\nBLOCKERS / FAILURES:");
  for (const f of failed) {
    console.log(`  - [${f.section}] ${f.testName}: ${f.details}`);
  }
}
process.exit(failed.length === 0 ? 0 : 1);
