-- The deployed OAuth starter writes these three fields on every attempt.
-- Some databases received the older storage repair but not the channel-model
-- migration containing these columns. Repair only the write prerequisites;
-- do not activate the rest of that model or change any grants/RLS policies.
-- Safe before the preflight code deploy. Existing state hashes, verifiers,
-- expiry/consumption fields and channel history are retained. No credentials.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.oauth_states
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'connect',
  ADD COLUMN IF NOT EXISTS target_account_id uuid,
  ADD COLUMN IF NOT EXISTS requested_scopes text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = 'public.oauth_states'::regclass
      AND attname = 'purpose' AND atttypid = 'text'::regtype AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = 'public.oauth_states'::regclass
      AND attname = 'target_account_id' AND atttypid = 'uuid'::regtype AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = 'public.oauth_states'::regclass
      AND attname = 'requested_scopes' AND atttypid = 'text[]'::regtype AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'OAuth attempt columns have unexpected types. Nothing was changed; review schema drift.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.oauth_states'::regclass
      AND conname = 'oauth_states_purpose_check'
  ) THEN
    ALTER TABLE public.oauth_states ADD CONSTRAINT oauth_states_purpose_check
      CHECK (purpose IN ('connect', 'reconnect', 'upgrade'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Verify: three rows, types text / uuid / ARRAY (udt_name _text).
-- SELECT column_name, data_type, udt_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='oauth_states'
-- AND column_name IN ('purpose','target_account_id','requested_scopes');
-- No browser grant is introduced. Check before/after:
-- SELECT has_table_privilege('anon','public.oauth_states','SELECT,INSERT,UPDATE,DELETE'),
--        has_table_privilege('authenticated','public.oauth_states','SELECT,INSERT,UPDATE,DELETE');
-- Both must remain false. Re-run is safe. Stop on type/constraint/lock errors.
-- Recovery: retain these additive fields when rolling back the preflight code;
-- the current starter already needs them. Do not drop live OAuth state/history.
