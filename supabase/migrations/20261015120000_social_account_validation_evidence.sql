-- ==============================================================================
-- Migration: 20261015120000_social_account_validation_evidence.sql
-- Description:
--   Two timestamps on a connected account that say whether Flas really asked the platform:
--     last_validation_attempt_at  the last time a live check was tried, whatever it found
--     last_validation_success_at  the last time the platform accepted the account's token
--   An account is shown as "Connected" only when the second one is set. Both start empty for
--   every existing account, so no account is marked verified by this file: each one becomes
--   verified when somebody presses Verify now and the platform answers.
--
--   This only adds the two columns. It changes no row, grants nothing and backfills nothing.
--   Safe to run twice. The columns are also created by 20260910100000_social_batch1_foundation.sql
--   with the same names and types (ADD COLUMN IF NOT EXISTS), so the two files do not clash and
--   either order works.
--
--   Run it before or after the code: until it is applied the app shows "Flas cannot save
--   verification results for this workspace yet" and marks nothing verified; nothing breaks.
--
--   Rollback:
--     ALTER TABLE public.social_accounts
--       DROP COLUMN IF EXISTS last_validation_attempt_at,
--       DROP COLUMN IF EXISTS last_validation_success_at;
--   (dropping them returns every account to "Not yet verified"; nothing else is lost)
-- ==============================================================================

BEGIN;

ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS last_validation_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_validation_success_at timestamptz;

COMMENT ON COLUMN public.social_accounts.last_validation_attempt_at IS
  'Last time Flas tried a live check against the platform with this account''s token, whatever the answer. Written only by the server.';
COMMENT ON COLUMN public.social_accounts.last_validation_success_at IS
  'Last time the platform accepted this account''s token in a live check and every permission Flas needs was granted. Empty means "Not yet verified". Written only by the server, only after the platform answered.';

COMMIT;

-- Verification (read-only).
-- Expect: two rows, both timestamptz and nullable. marked_verified is 0 on a workspace that did
-- not have these columns before (this file never sets one); a workspace that applied the
-- foundation migration earlier may legitimately show other numbers.
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'social_accounts'
   AND column_name IN ('last_validation_attempt_at', 'last_validation_success_at')
 ORDER BY column_name;
SELECT count(*) AS accounts, count(last_validation_success_at) AS marked_verified
  FROM public.social_accounts;
