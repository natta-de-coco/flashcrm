-- ═════════════════════════════════════════════════════════════════════════════
-- Red-team finding B-2 — tenant_id must not be nullable on customer data.
--
-- A row with a NULL tenant_id belongs to nobody. Every RLS policy on these
-- tables is of the form `tenant_id = current_tenant_id()`, and `NULL = <uuid>`
-- evaluates to NULL rather than true, so such a row is invisible to every
-- tenant. It is not, as first reported, writable by anyone: the same NULL
-- makes the INSERT policy's WITH CHECK fail too, so ordinary users cannot
-- create one. Only a service-role path that forgets to set tenant_id can --
-- and when it does, the row is silently orphaned instead of raising.
--
-- This migration turns that silent orphan into a loud error.
--
-- SCOPE — seven tables, deliberately not all twenty-two that allow NULL:
--
--   contacts, conversations, messages, leads, wa_numbers, campaigns,
--   wa_templates
--
-- Verified against production before writing this: all seven currently hold
-- zero NULL rows, so SET NOT NULL applies without a backfill. That also means
-- every write path in use today already sets tenant_id, so nothing that works
-- now can start failing.
--
-- EXCLUDED, with reasons — do not "finish the job" by adding these:
--
--   profiles              A user exists before joining an organization.
--                         NULL is the correct representation of that state.
--   super_admin_subscribers  A view. NOT NULL does not apply.
--   audit_log             Platform-level events legitimately have no tenant.
--   system_alerts         Platform-wide alerts are not tenant-scoped.
--   auth_email_attempts   Written before a tenant is known.
--   webhook_events        Written on arrival, before the tenant is resolved.
--   error_events          Platform errors can occur outside any tenant.
--
-- The DEFAULT matches the convention already used elsewhere in this schema
-- (see 20260825164922). Under a normal user session it fills tenant_id in; in
-- a service-role context current_tenant_id() returns NULL, which now raises a
-- not-null violation rather than writing an orphan. That is the intent.
--
-- Idempotent. SET NOT NULL and SET DEFAULT are both no-ops when already set.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  _table text;
  _nulls bigint;
  _tables text[] := ARRAY[
    'contacts', 'conversations', 'messages', 'leads',
    'wa_numbers', 'campaigns', 'wa_templates'
  ];
BEGIN
  FOREACH _table IN ARRAY _tables LOOP
    -- A table missing from this database is skipped rather than fatal, so the
    -- migration remains replayable against a partially built schema.
    IF to_regclass('public.' || quote_ident(_table)) IS NULL THEN
      RAISE NOTICE 'skipping %: table not present', _table;
      CONTINUE;
    END IF;

    -- Fail loudly and name the table, rather than letting SET NOT NULL emit a
    -- generic error that does not say how many rows are in the way.
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', _table)
      INTO _nulls;

    IF _nulls > 0 THEN
      RAISE EXCEPTION
        'public.% has % row(s) with a NULL tenant_id. Backfill or delete them, then re-run.',
        _table, _nulls;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id()',
      _table);
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', _table);
  END LOOP;
END $$;

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- Dropping the constraint restores the previous behaviour exactly; no data is
-- changed by this migration, so nothing needs restoring.
--
--   ALTER TABLE public.contacts      ALTER COLUMN tenant_id DROP NOT NULL;
--   ALTER TABLE public.conversations ALTER COLUMN tenant_id DROP NOT NULL;
--   ALTER TABLE public.messages      ALTER COLUMN tenant_id DROP NOT NULL;
--   ALTER TABLE public.leads         ALTER COLUMN tenant_id DROP NOT NULL;
--   ALTER TABLE public.wa_numbers    ALTER COLUMN tenant_id DROP NOT NULL;
--   ALTER TABLE public.campaigns     ALTER COLUMN tenant_id DROP NOT NULL;
--   ALTER TABLE public.wa_templates  ALTER COLUMN tenant_id DROP NOT NULL;
--
-- The DEFAULT may be left in place; it is inert without the constraint. To
-- remove it as well, DROP DEFAULT on the same columns.

-- ─── Sanity check ────────────────────────────────────────────────────────────
--   SELECT table_name, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND column_name = 'tenant_id'
--      AND table_name IN ('contacts','conversations','messages','leads',
--                         'wa_numbers','campaigns','wa_templates')
--    ORDER BY table_name;
-- Every row must read NO.
