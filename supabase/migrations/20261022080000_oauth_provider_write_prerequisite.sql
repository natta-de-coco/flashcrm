-- A live retry after the intent-column repair exposed another missing column:
-- the deployed OAuth starter also inserts provider. Its original definition is
-- in 20260910100000_social_batch1_foundation.sql. Restore only that prerequisite,
-- without activating the rest of the channel model or changing access rights.
-- Separate forward migration: 20261022073000 was already applied live.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.oauth_states ADD COLUMN IF NOT EXISTS provider text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = 'public.oauth_states'::regclass
      AND attname = 'provider' AND atttypid = 'text'::regtype AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'OAuth provider column has an unexpected type. Nothing was changed; review schema drift.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Pre-check: provider is absent or text. Browser table privileges must be false.
-- Verify: provider is text; existing row count and relacl remain unchanged;
-- retry Add Integration -> YouTube -> Continue with Google on the live build.
-- Re-runnable. Stop on drift or lock errors. No rows, credentials, policies or
-- grants change. Retain this additive column if rolling back the preflight code:
-- the currently deployed starter already writes it. Do not drop OAuth history.
