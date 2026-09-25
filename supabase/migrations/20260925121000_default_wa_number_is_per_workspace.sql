-- The default WhatsApp number is one per workspace, not one per database.
--
-- The original index was
--
--   CREATE UNIQUE INDEX wa_numbers_single_default ON public.wa_numbers (is_default)
--     WHERE is_default;
--
-- with no tenant_id in the key, so at most one row in the entire database could
-- be the default. The first workspace to connect a number took that slot;
-- every other workspace's first number is inserted with is_default = true
-- (wa-numbers.functions.ts) and hit a unique violation, which the UI reported as
-- "The number could not be saved." A second workspace could not connect
-- WhatsApp at all, and nobody could switch their own default.
--
-- Safe to run more than once.
BEGIN;

DROP INDEX IF EXISTS public.wa_numbers_single_default;

-- One default per workspace. (No workspace can currently have two, because the
-- old index allowed only one in total, so this cannot fail on existing data.)
CREATE UNIQUE INDEX IF NOT EXISTS wa_numbers_single_default_per_tenant
  ON public.wa_numbers (tenant_id)
  WHERE is_default;

COMMIT;

-- ── Verification (run after the commit) ─────────────────────────────────────
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE schemaname = 'public' AND tablename = 'wa_numbers';
--   -- expected: wa_numbers_single_default_per_tenant ON ... (tenant_id) WHERE is_default
--   -- and NO index on (is_default) alone.
--
-- Which workspaces have a default number at all?
--   SELECT tenant_id, count(*) FILTER (WHERE is_default) AS defaults, count(*) AS numbers
--   FROM public.wa_numbers GROUP BY 1;
--   -- a workspace with numbers but 0 defaults cannot send without picking a
--   -- number explicitly; the app now sets one when it adds the first number,
--   -- and "Make default" clears the previous one first.
