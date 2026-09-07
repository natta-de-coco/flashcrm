-- Concurrent inbound messages could drop unread-count increments (read the
-- current value, then write value+1 — a second message arriving between the
-- read and the write gets overwritten). Atomic increment via a single UPDATE.
BEGIN;

CREATE OR REPLACE FUNCTION public.increment_unread_count(_conversation_id uuid)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.conversations
     SET unread_count = unread_count + 1
   WHERE id = _conversation_id
   RETURNING unread_count;
$$;
REVOKE ALL ON FUNCTION public.increment_unread_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_unread_count(uuid) TO service_role;

COMMIT;
