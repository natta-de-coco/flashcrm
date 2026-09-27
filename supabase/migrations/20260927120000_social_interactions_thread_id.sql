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

-- ── One-time backfill of history already imported ───────────────────────────
-- The code files old history on a FIRST sync only, and an account that has
-- already imported its history has a last_synced_at, so nothing would ever
-- reclassify the rows that produced the complaint: a workspace told it had 27
-- conversations to answer, most of them from 2025. This does it once, here.
--
-- Deliberately narrow. A row is filed as history only when it is inbound, still
-- open, older than the same 30-day cutoff the code uses, AND its conversation
-- has been silent for those 30 days. A customer who wrote 45 days ago and again
-- yesterday keeps the whole conversation open -- which is the case archiving
-- must never touch. Nothing is deleted; "archived" is reversible from the
-- inbox's All filter.
-- What counts as one conversation here is what the inbox groups by: the
-- provider's conversation id when there is one, otherwise the person on that
-- account.
UPDATE public.social_interactions AS si
   SET status = 'archived'
 WHERE si.direction = 'in'
   AND si.status = 'open'
   AND si.created_at < now() - interval '30 days'
   AND NOT EXISTS (
     SELECT 1
       FROM public.social_interactions AS recent
      WHERE recent.account_id = si.account_id
        AND recent.kind = si.kind
        AND recent.created_at >= now() - interval '30 days'
        AND coalesce(
              recent.thread_id,
              lower(btrim(coalesce(recent.author_handle, recent.author_name, recent.id::text)))
            ) = coalesce(
              si.thread_id,
              lower(btrim(coalesce(si.author_handle, si.author_name, si.id::text)))
            )
   );

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='social_interactions' AND column_name='thread_id';
--   -- expected: one row
--
-- What is still waiting for a reply, which is the number the dashboard shows:
--   SELECT count(*) FROM public.social_interactions WHERE direction='in' AND status='open';
--   -- expected: only conversations with activity in the last 30 days
--
-- After the next sync, DMs should group:
--   SELECT thread_id, count(*), min(created_at), max(created_at)
--   FROM public.social_interactions WHERE kind='dm' AND thread_id IS NOT NULL
--   GROUP BY 1 ORDER BY 3 DESC LIMIT 20;
