-- ═════════════════════════════════════════════════════════════════════════════
-- One row per connected channel.
--
-- saveAuthorizedConnection() used to find "the existing connection" by tenant
-- and platform alone. Connecting a second YouTube channel or Facebook Page
-- therefore UPDATED the first one's row: its external_id, token and profile
-- were replaced, and the posts and comments already attached to that row by
-- account_id now appeared under a different account. Nothing in the database
-- objected, because nothing said a channel could only be connected once.
--
-- The code now matches on the channel's own id. This index is the backstop:
-- the same provider account cannot be connected twice in one workspace, so a
-- reconnect has to find and refresh the existing row.
--
-- Partial on external_id IS NOT NULL. A connection whose provider account has
-- not been identified yet (a Meta login waiting for the customer to pick a
-- Page, or a platform without discovery) has no id to be unique on.
--
-- If duplicates already exist this stops and changes nothing. Deleting either
-- copy automatically could delete the one holding the history, so that choice
-- is left to a person. The query in the error message lists them.
--
-- Safe to run twice.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  _duplicates integer;
BEGIN
  SELECT count(*) INTO _duplicates
    FROM (
      SELECT tenant_id, platform, external_id
        FROM public.social_accounts
       WHERE external_id IS NOT NULL
       GROUP BY tenant_id, platform, external_id
      HAVING count(*) > 1
    ) d;

  IF _duplicates > 0 THEN
    RAISE EXCEPTION
      'public.social_accounts has % channel(s) connected more than once in the same workspace. Nothing was changed.',
      _duplicates
      USING HINT = 'List them with: SELECT tenant_id, platform, external_id, array_agg(id) FROM public.social_accounts WHERE external_id IS NOT NULL GROUP BY 1,2,3 HAVING count(*) > 1; keep the row with the history, delete the others, then run this again.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_one_row_per_channel
  ON public.social_accounts (tenant_id, platform, external_id)
  WHERE external_id IS NOT NULL;
