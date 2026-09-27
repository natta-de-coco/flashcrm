-- A Messenger or Instagram conversation is a thread, not a pile of rows.
--
-- Every DM was stored as its own social_interactions row with no way to tell
-- which conversation it belonged to, so the inbox showed one customer as six
-- separate items ("Mohamed Maharoof x3, Mteos Timer x4") and the thread view
-- showed a single bubble. Meta gives each conversation a stable id; this stores
-- it so the inbox can group by it.
--
-- Additive and safe to re-run. The sync writes thread_id only if this column
-- exists -- it retries without it on a 42703 -- so the order of deploy and
-- migration does not matter.
ALTER TABLE public.social_interactions
  ADD COLUMN IF NOT EXISTS thread_id text;

COMMENT ON COLUMN public.social_interactions.thread_id IS
  'Provider conversation id. DMs in one conversation share it; comments leave it null and group by the post instead.';

CREATE INDEX IF NOT EXISTS social_interactions_thread_idx
  ON public.social_interactions (account_id, thread_id, created_at DESC)
  WHERE thread_id IS NOT NULL;

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='social_interactions' AND column_name='thread_id';
--   -- expected: one row
--
-- After the next sync, DMs should group:
--   SELECT thread_id, count(*), min(created_at), max(created_at)
--   FROM public.social_interactions WHERE kind='dm' AND thread_id IS NOT NULL
--   GROUP BY 1 ORDER BY 3 DESC LIMIT 20;
