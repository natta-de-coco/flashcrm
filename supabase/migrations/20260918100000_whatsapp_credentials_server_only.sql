-- ═════════════════════════════════════════════════════════════════════════════
-- WhatsApp credentials are written by the server only.
--
-- A number's access token and app secret were inserted straight from the
-- browser, so they were stored exactly as typed instead of encrypted.
-- addWhatsAppNumber (src/lib/wa-numbers.functions.ts) now seals them and writes
-- with the service role. This removes the browser's ability to write them at
-- all, so a plaintext credential cannot be inserted from a signed-in session.
--
-- Mirrors 20260901030000, which did the same for reads: revoke the table-wide
-- privilege, then grant back only the columns the browser legitimately uses.
-- A column-level REVOKE alone would do nothing while a table-wide grant exists.
--
-- ORDER: apply AFTER the code that adds numbers server-side is deployed. Before
-- that, the old screens still insert from the browser and would be refused.
--
-- Idempotent. Safe to re-run. Deletes are unchanged (RLS still scopes them).
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE INSERT ON public.wa_numbers FROM anon, authenticated;

REVOKE UPDATE ON public.wa_numbers FROM anon, authenticated;
GRANT UPDATE (label, is_default, active, alerts_enabled, deliverability_min, read_rate_min)
  ON public.wa_numbers TO authenticated;

COMMIT;

-- Verification (read-only): expect false, false, false, true.
-- SELECT has_table_privilege('authenticated', 'public.wa_numbers', 'INSERT') AS browser_can_insert,
--        has_column_privilege('authenticated', 'public.wa_numbers', 'access_token', 'UPDATE') AS browser_can_write_token,
--        has_column_privilege('authenticated', 'public.wa_numbers', 'app_secret', 'UPDATE') AS browser_can_write_secret,
--        has_column_privilege('authenticated', 'public.wa_numbers', 'label', 'UPDATE') AS browser_can_rename;
