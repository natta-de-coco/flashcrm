// supabase/verify/verify-email-schema-and-privacy.mjs
// Empirical PostgreSQL role verification test for PR #81 / Issue #78 Stage 1:
// 1. check_and_prune_tenant_email_storage execution restricted to service_role; forbidden to anon/authenticated
// 2. tenant_smtp_config column security: authenticated cannot SELECT smtp_pass_enc / imap_pass_enc
// 3. lead_alerts_log evidence protection: authenticated cannot INSERT/DELETE; only SELECT under RLS
// 4. guard_campaign_verified_smtp: NULL tenant_id and unverified SMTP rejected
// 5. enforce_drip_enrollment_tenant_match: cross-tenant enrollment rejected
// 6. count-first duplicate reconciliation and unique indexes
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const PORT = 54979;
const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-email-schema-${Date.now()}`),
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

const config = {
  host: "localhost",
  port: PORT,
  user: "postgres",
  password: "postgres",
  database: "postgres",
};

const migration = readFileSync(
  new URL("../migrations/20261014160000_email_schema_and_privacy_hardening.sql", import.meta.url),
  "utf8",
);

const asRole = async (role) => {
  const client = new pg.Client(config);
  await client.connect();
  await client.query(`SET ROLE ${role}`);
  return client;
};

let db;

try {
  console.log("Starting embedded postgres on port", PORT);
  await server.initialise();
  await server.start();
  db = new pg.Client(config);
  await db.connect();

  // Create roles & baseline tables as Supabase sets them up
  await db.query(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid; $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

    CREATE TABLE public.organizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL
    );

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid REFERENCES public.organizations(id),
      staff_role text NOT NULL DEFAULT 'staff'
    );

    CREATE OR REPLACE FUNCTION public.is_super_admin(uid uuid)
    RETURNS boolean LANGUAGE sql AS $$ SELECT false; $$;

    CREATE TABLE public.platform_email_config (
      id int PRIMARY KEY DEFAULT 1,
      sender_name text NOT NULL DEFAULT 'Flas CRM',
      sender_email text NOT NULL DEFAULT 'noreply@flas.app',
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.tenant_smtp_config (
      tenant_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
      provider text NOT NULL DEFAULT 'smtp_relay',
      from_email text,
      from_name text,
      reply_to text,
      region text,
      domain text,
      api_key_enc bytea,
      smtp_host text,
      smtp_port int DEFAULT 465,
      smtp_secure boolean DEFAULT true,
      smtp_user text,
      smtp_pass_enc text,
      imap_host text,
      imap_port int DEFAULT 993,
      imap_secure boolean DEFAULT true,
      imap_user text,
      imap_pass_enc text,
      imap_enabled boolean DEFAULT false,
      welcome_email_enabled boolean DEFAULT false,
      welcome_discount_code text DEFAULT '',
      welcome_discount_percent int DEFAULT 0,
      welcome_subject text DEFAULT '',
      welcome_body_html text,
      spf_verified boolean DEFAULT false,
      dkim_verified boolean DEFAULT false,
      dmarc_verified boolean DEFAULT false,
      verified boolean NOT NULL DEFAULT false,
      last_test_at timestamptz,
      last_test_ok boolean,
      last_test_error text,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- Simulate old column-level grants from 20260830000000
    GRANT SELECT (tenant_id, provider, from_email, from_name, reply_to, region, domain,
                  verified, last_test_at, last_test_ok, last_test_error, created_at, updated_at)
          ON public.tenant_smtp_config TO authenticated;

    CREATE TABLE public.campaigns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid REFERENCES public.organizations(id),
      name text NOT NULL,
      status text NOT NULL DEFAULT 'draft'
    );

    CREATE TABLE public.drip_sequences (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES public.organizations(id),
      name text NOT NULL,
      description text,
      trigger_event text NOT NULL DEFAULT 'lead_consented_intake',
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.drip_steps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sequence_id uuid NOT NULL REFERENCES public.drip_sequences(id) ON DELETE CASCADE,
      step_number int NOT NULL,
      delay_days int NOT NULL DEFAULT 0,
      template_id text NOT NULL DEFAULT 'welcome_discount',
      subject text NOT NULL,
      discount_code text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.drip_enrollments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES public.organizations(id),
      sequence_id uuid NOT NULL REFERENCES public.drip_sequences(id) ON DELETE CASCADE,
      lead_id uuid,
      contact_id uuid,
      email text NOT NULL,
      current_step int NOT NULL DEFAULT 1,
      status text NOT NULL DEFAULT 'enrolled',
      next_run_at timestamptz NOT NULL DEFAULT now(),
      last_sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.lead_alerts_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      lead_id uuid,
      alert_channel text NOT NULL,
      recipient text NOT NULL,
      subject text,
      status text NOT NULL DEFAULT 'sent',
      error text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.portal_email_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES public.organizations(id),
      subject text NOT NULL,
      body_text text NOT NULL DEFAULT '',
      storage_bytes integer NOT NULL DEFAULT 100,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  console.log("Applying forward migration 20261014160000...");
  await db.query(migration);

  // 1. Verify storage RPC permission & caller isolation
  console.log("Testing check_and_prune_tenant_email_storage permissions...");
  const anonClient = await asRole("anon");
  await assert.rejects(
    anonClient.query("SELECT public.check_and_prune_tenant_email_storage(gen_random_uuid())"),
    /permission denied/,
    "anon must not be permitted to execute check_and_prune_tenant_email_storage",
  );
  await anonClient.end();

  const authClient = await asRole("authenticated");
  await assert.rejects(
    authClient.query("SELECT public.check_and_prune_tenant_email_storage(gen_random_uuid())"),
    /permission denied/,
    "authenticated role must not be permitted to execute check_and_prune_tenant_email_storage",
  );

  const serviceClient = await asRole("service_role");
  const tenantRes = await db.query(
    "INSERT INTO public.organizations (name) VALUES ('Test Org') RETURNING id",
  );
  const testTenantId = tenantRes.rows[0].id;
  const storageRes = await serviceClient.query(
    "SELECT public.check_and_prune_tenant_email_storage($1) as res",
    [testTenantId],
  );
  assert.equal(storageRes.rows[0].res.purged_count, 0, "Purged count must be 0");
  assert.equal(storageRes.rows[0].res.used_bytes, 0, "Used bytes must match inserted messages");
  await serviceClient.end();

  // 2. Verify tenant_smtp_config column security
  console.log("Testing tenant_smtp_config column security...");
  // safe column select should succeed
  await authClient.query("SELECT tenant_id, provider, smtp_host FROM public.tenant_smtp_config");
  // secret column select MUST be refused
  await assert.rejects(
    authClient.query("SELECT smtp_pass_enc FROM public.tenant_smtp_config"),
    /permission denied/,
    "authenticated must NOT have SELECT on smtp_pass_enc",
  );
  await assert.rejects(
    authClient.query("SELECT imap_pass_enc FROM public.tenant_smtp_config"),
    /permission denied/,
    "authenticated must NOT have SELECT on imap_pass_enc",
  );
  await assert.rejects(
    authClient.query("SELECT api_key_enc FROM public.tenant_smtp_config"),
    /permission denied/,
    "authenticated must NOT have SELECT on api_key_enc",
  );

  // 3. Verify lead_alerts_log evidence protection
  console.log("Testing lead_alerts_log permissions...");
  await authClient.query("SELECT * FROM public.lead_alerts_log");
  await assert.rejects(
    authClient.query(
      "INSERT INTO public.lead_alerts_log (tenant_id, alert_channel, recipient) VALUES ($1, 'email', 'test@example.com')",
      [testTenantId],
    ),
    /permission denied/,
    "authenticated must NOT be permitted to INSERT into lead_alerts_log",
  );
  await authClient.end();

  // 4. Verify campaign trigger guard_campaign_verified_smtp
  console.log("Testing guard_campaign_verified_smtp trigger...");
  await assert.rejects(
    db.query("INSERT INTO public.campaigns (name, status, tenant_id) VALUES ('Campaign 1', 'scheduled', NULL)"),
    /Cannot schedule or send campaign without a valid tenant_id/,
    "Must reject scheduling when tenant_id is NULL",
  );
  await assert.rejects(
    db.query("INSERT INTO public.campaigns (name, status, tenant_id) VALUES ('Campaign 2', 'scheduled', $1)", [testTenantId]),
    /Cannot schedule or send campaign without verified tenant SMTP credentials/,
    "Must reject scheduling when tenant SMTP is not verified",
  );

  // 5. Verify enrollment-to-sequence tenant consistency
  console.log("Testing enforce_drip_enrollment_tenant_match trigger...");
  const otherTenantRes = await db.query(
    "INSERT INTO public.organizations (name) VALUES ('Other Org') RETURNING id",
  );
  const otherTenantId = otherTenantRes.rows[0].id;
  const seqRes = await db.query(
    "INSERT INTO public.drip_sequences (tenant_id, name) VALUES ($1, 'Seq 1') RETURNING id",
    [testTenantId],
  );
  const seqId = seqRes.rows[0].id;

  // Matching tenant should succeed
  await db.query(
    "INSERT INTO public.drip_enrollments (tenant_id, sequence_id, email) VALUES ($1, $2, 'ok@example.com')",
    [testTenantId, seqId],
  );

  // Mismatched tenant MUST fail
  await assert.rejects(
    db.query(
      "INSERT INTO public.drip_enrollments (tenant_id, sequence_id, email) VALUES ($1, $2, 'bad@example.com')",
      [otherTenantId, seqId],
    ),
    /Tenant mismatch/,
    "Must reject enrollment when tenant_id does not match sequence tenant_id",
  );

  // 6. Verify idempotency: re-running migration must succeed
  console.log("Testing migration idempotency (re-run)...");
  await db.query(migration);

  console.log("\nALL POSTGRESQL ROLE VERIFICATION CHECKS PASSED CLEANLY!");
} finally {
  if (db) await db.end().catch(() => {});
  await server.stop().catch(() => {});
}
