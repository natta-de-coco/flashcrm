-- ═════════════════════════════════════════════════════════════════════════════
-- Batch 2A — separate the person's authorization from the channels it reaches.
--
-- An OAuth authorization belongs to a PERSON. The thing a workspace connects
-- is a CHANNEL: a YouTube channel, a Facebook Page, an Instagram professional
-- account. One authorization can reach several channels, so tokens are stored
-- once, on the authorization, and channels reference it.
--
--   §1  social_authorizations — one human authorization, tokens encrypted
--   §2  social_accounts.authorization_id — channels reference it
--   §3  a channel can only reference its own workspace's authorization
--   §4  an authorization-level refresh lease (one refresh per authorization,
--       however many channels share it)
--   §5  oauth_states records what an attempt is for (connect / reconnect /
--       upgrade), the channel it targets, and the scopes it asked for
--
-- Additive. Existing connections keep working: a social_accounts row with no
-- authorization_id still holds its own token, exactly as before.
-- Idempotent. Rollback at the bottom.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── §1 ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_authorizations (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  authorized_by              uuid,
  provider                   text NOT NULL,
  platform                   text NOT NULL,
  provider_user_id           text,
  provider_email_hint        text,
  access_token_enc           text,
  refresh_token_enc          text,
  token_key_id               text,
  requested_scopes           text[] NOT NULL DEFAULT '{}',
  granted_scopes             text[] NOT NULL DEFAULT '{}',
  expires_at                 timestamptz,
  authorization_state        text NOT NULL DEFAULT 'active',
  state_reason               text,
  -- Public metadata of the channels this authorization can reach, captured at
  -- the callback so the picker never has to hold a token in the browser. Ids,
  -- names, avatars and counts only; never a token.
  discovered_assets          jsonb NOT NULL DEFAULT '[]'::jsonb,
  discovered_at              timestamptz,
  refresh_lease_id           uuid,
  refresh_leased_until       timestamptz,
  last_refreshed_at          timestamptz,
  last_validation_success_at timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.social_authorizations
  DROP CONSTRAINT IF EXISTS social_authorizations_state_check;
ALTER TABLE public.social_authorizations
  ADD CONSTRAINT social_authorizations_state_check CHECK (authorization_state IN (
    'active', 'refresh_failed', 'revoked', 'disconnected', 'provider_unavailable'
  ));

CREATE INDEX IF NOT EXISTS social_authorizations_tenant_idx
  ON public.social_authorizations (tenant_id, provider);

ALTER TABLE public.social_authorizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant reads own social authorizations" ON public.social_authorizations;
CREATE POLICY "Tenant reads own social authorizations" ON public.social_authorizations
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- Server-only writes. Safe columns readable by the workspace; the token
-- columns and the lease are not granted at all.
REVOKE ALL ON public.social_authorizations FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, tenant_id, authorized_by, provider, platform, provider_user_id,
              provider_email_hint, requested_scopes, granted_scopes, expires_at,
              authorization_state, state_reason, discovered_assets, discovered_at,
              last_refreshed_at, last_validation_success_at, created_at, updated_at)
  ON public.social_authorizations TO authenticated;
GRANT ALL ON public.social_authorizations TO service_role;

-- ── §2 ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS authorization_id uuid
    REFERENCES public.social_authorizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_type text;

CREATE INDEX IF NOT EXISTS social_accounts_authorization_idx
  ON public.social_accounts (authorization_id);

GRANT SELECT (authorization_id, account_type) ON public.social_accounts TO authenticated;

-- ── §3 ───────────────────────────────────────────────────────────────────────
-- Same reasoning as the child-row triggers in 20260910100000: RLS checks a
-- row's own tenant, not the tenant of what it points at.
CREATE OR REPLACE FUNCTION public.enforce_account_authorization_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.authorization_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.social_authorizations a
     WHERE a.id = NEW.authorization_id AND a.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'authorization % does not belong to tenant %', NEW.authorization_id, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS social_accounts_authorization_tenant_match ON public.social_accounts;
CREATE TRIGGER social_accounts_authorization_tenant_match
  BEFORE INSERT OR UPDATE OF authorization_id, tenant_id ON public.social_accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_account_authorization_tenant();

-- ── §4 ───────────────────────────────────────────────────────────────────────
-- Channels sharing one authorization share one refresh token. Two channels of
-- the same Google login refreshing concurrently would race exactly as two
-- health checks on one account did -- so the lease lives on the authorization.
CREATE OR REPLACE FUNCTION public.acquire_authorization_refresh_lease(
  _authorization_id uuid, _tenant_id uuid, _lease_seconds integer DEFAULT 60
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _lease uuid := gen_random_uuid();
BEGIN
  UPDATE public.social_authorizations
     SET refresh_lease_id = _lease,
         refresh_leased_until = now() + make_interval(secs => GREATEST(5, LEAST(_lease_seconds, 600)))
   WHERE id = _authorization_id
     AND tenant_id = _tenant_id
     AND (refresh_leased_until IS NULL OR refresh_leased_until < now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN _lease;
END; $$;

CREATE OR REPLACE FUNCTION public.release_authorization_refresh_lease(
  _authorization_id uuid, _tenant_id uuid, _lease_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.social_authorizations
     SET refresh_lease_id = NULL, refresh_leased_until = NULL
   WHERE id = _authorization_id AND tenant_id = _tenant_id AND refresh_lease_id = _lease_id;
  RETURN FOUND;
END; $$;

REVOKE ALL ON FUNCTION public.acquire_authorization_refresh_lease(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_authorization_refresh_lease(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_authorization_refresh_lease(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_authorization_refresh_lease(uuid, uuid, uuid) TO service_role;

-- ── §5 ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.oauth_states
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'connect',
  ADD COLUMN IF NOT EXISTS target_account_id uuid,
  ADD COLUMN IF NOT EXISTS requested_scopes text[];

ALTER TABLE public.oauth_states DROP CONSTRAINT IF EXISTS oauth_states_purpose_check;
ALTER TABLE public.oauth_states
  ADD CONSTRAINT oauth_states_purpose_check CHECK (purpose IN ('connect', 'reconnect', 'upgrade'));

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- Roll the application back first: channels created by the Batch 2A flow hold
-- no token of their own, so old code reading social_accounts would find none.
--
-- BEGIN;
--   ALTER TABLE public.oauth_states DROP CONSTRAINT IF EXISTS oauth_states_purpose_check;
--   ALTER TABLE public.oauth_states DROP COLUMN IF EXISTS requested_scopes,
--                                   DROP COLUMN IF EXISTS target_account_id,
--                                   DROP COLUMN IF EXISTS purpose;
--   DROP FUNCTION IF EXISTS public.acquire_authorization_refresh_lease(uuid, uuid, integer);
--   DROP FUNCTION IF EXISTS public.release_authorization_refresh_lease(uuid, uuid, uuid);
--   DROP TRIGGER IF EXISTS social_accounts_authorization_tenant_match ON public.social_accounts;
--   DROP FUNCTION IF EXISTS public.enforce_account_authorization_tenant();
--   ALTER TABLE public.social_accounts DROP COLUMN IF EXISTS account_type,
--                                      DROP COLUMN IF EXISTS authorization_id;
--   DROP TABLE IF EXISTS public.social_authorizations;
-- COMMIT;
--
-- Dropping social_authorizations destroys the only copy of the tokens for
-- channels connected through the new flow; those channels must reconnect.

-- ─── Sanity checks ───────────────────────────────────────────────────────────
--   SELECT has_column_privilege('authenticated','public.social_authorizations','access_token_enc','SELECT'); -- false
--   SELECT has_table_privilege('authenticated','public.social_authorizations','INSERT');                     -- false
