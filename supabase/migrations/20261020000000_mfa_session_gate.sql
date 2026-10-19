-- The database also requires the second sign-in step.
--
-- WHY THIS EXISTS
-- Two-factor sign-in (PR #68) is enforced by the app: the sign-in page, the
-- signed-in layout and every server function refuse a session that has given
-- the password but not the code. The database did not. Anyone holding only the
-- password of an account that has two-factor turned on can ask Supabase Auth for
-- a password-only ("aal1") token and then read and change that company's rows
-- straight through the data API, because every policy only asks "which company
-- is this person in?" and never "did they enter the code?".
--
-- WHAT IT DOES
-- A session meets the rule when EITHER its token says it entered a code
-- ("aal2"), OR its person has no verified authenticator-app factor at all.
-- That is the same rule the app uses (src/lib/two-factor.ts), so nobody is
-- locked out who the app lets in.
--   * public.session_meets_mfa()        the rule, as one function
--   * mfa_session_gate (RESTRICTIVE)    one policy on EVERY row-level-security
--                                       table in public, and on storage.objects.
--                                       RESTRICTIVE means it is ANDed with the
--                                       policies already there: it can only take
--                                       access away, never add any.
--   * public.apply_mfa_session_gate()   puts the policy on every such table that
--                                       exists. Run it again at the end of any
--                                       later migration that adds a table.
--   * public.list_subscribers()         a SECURITY DEFINER function runs as its
--                                       owner and skips policies, so it gets the
--                                       same rule as its first line.
--   * public.open_contact_whatsapp()    same reason, same rule. PR #66's body
--                                       (20261007130000, live) with one guard
--                                       added right after its sign-in check;
--                                       nothing else in it, and not its owner,
--                                       its security mode or its grants, changes.
--                                       The file stops if #66 is not applied.
--
-- !!! ROLL-OUT ORDER IS PART OF THE SAFETY OF THIS FILE !!!
--   1. PR #68 (the app asks for the code) is live.
--   2. The app code of the pull request that ships this file is live.
--   3. ONLY THEN paste this file, and after every other pending migration.
-- Pasted first, every person with a verified factor loses all access to their
-- data (the old app never asks them for the code). People without a factor are
-- not affected whatever the order. Read the pre-flight query in the pull
-- request before pasting. A table that appears AFTER this file (a later
-- migration) is not covered until SELECT public.apply_mfa_session_gate(); is
-- run again; the verification query at the bottom lists any that were missed.
--
-- NOT COVERED HERE (on purpose; listed in the pull request):
--   * tenant_alert_settings and lead_alerts_log (the lead-alert recipients and
--     their log): 20261016142000_settings_alert_prerequisites.sql (PR #87)
--     stops with "Alert prerequisite policy drift" when either table carries a
--     policy it does not know, and it runs in the repository's re-run check. A
--     gate policy there would make that file fail the day it is pasted. They are
--     left out of apply_mfa_session_gate() below, by name, until that check
--     ignores a policy called mfa_session_gate; then delete the two names from
--     the list and run SELECT public.apply_mfa_session_gate();
--   * record_integration_error(): a separate, older problem (it accepts any
--     tenant id). Not a two-factor question.
--   * Enrolling a factor from a password-only session: the database cannot see
--     the caller's level at that moment. See the recovery runbook of PR #68.
--
-- SAFE TO RUN TWICE. One transaction: if anything fails, nothing is changed.
--
-- WHEN TO RUN IT: at a quiet time. Putting a policy on a table needs a short
-- exclusive lock on it (every reader and writer of that table waits for the
-- fraction of a second the file holds it, about a second in all). The file never
-- queues behind a busy table: it asks for all its locks without waiting, lets them
-- go the moment one is busy, tries again for about 5 seconds, and then stops with
-- "<table> is in use by another session ... nothing was changed". That is not an
-- error in the file: RUN IT AGAIN (it is safe to run again), in a quieter hour if
-- it keeps happening (a Storage upload or a long report holds its table). Nobody
-- else waits while it tries. SET LOCAL lock_timeout below is the net under that
-- for any wait the file did not foresee.
--
-- KILL SWITCH (no table locks, takes effect for the next statement), if people
-- are locked out and you need access back before you have found the cause.
-- Re-running this whole file afterwards restores the real rule.
-- <killswitch>
-- CREATE OR REPLACE FUNCTION public.session_meets_mfa() RETURNS boolean
-- LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT true $$;
-- </killswitch>
--
-- FULL ROLLBACK, one statement: drops every mfa_session_gate policy (public
-- tables and storage.objects), puts list_subscribers() back exactly as it was
-- in 20260904010000 and open_contact_whatsapp() back exactly as PR #66 made it,
-- and drops the two functions. (The two come first because their guard line
-- calls the function that is being dropped.)
-- <rollback>
-- DO $rollback$
-- DECLARE
--   r record;
-- BEGIN
--   FOR r IN SELECT schemaname, tablename FROM pg_policies WHERE policyname = 'mfa_session_gate' LOOP
--     EXECUTE format('DROP POLICY mfa_session_gate ON %I.%I', r.schemaname, r.tablename);
--   END LOOP;
-- CREATE OR REPLACE FUNCTION public.list_subscribers()
-- RETURNS SETOF public.super_admin_subscribers
-- LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   IF NOT public.is_super_admin(auth.uid()) THEN
--     RAISE EXCEPTION 'Super admin only';
--   END IF;
--   RETURN QUERY SELECT * FROM public.super_admin_subscribers ORDER BY company_created_at DESC;
-- END; $$;
-- CREATE OR REPLACE FUNCTION public.open_contact_whatsapp(p_contact_id uuid)
-- RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
-- DECLARE
--   v_tenant uuid;
--   v_contact public.contacts%ROWTYPE;
--   v_conversation public.conversations%ROWTYPE;
--   v_number uuid;
--   v_id uuid;
--   v_actual_number uuid;
-- BEGIN
--   IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
--   v_tenant := public.current_tenant_id();
--   IF v_tenant IS NULL THEN RAISE EXCEPTION 'Your workspace is not ready.'; END IF;
--   SELECT * INTO v_contact FROM public.contacts
--     WHERE id = p_contact_id AND tenant_id = v_tenant FOR UPDATE;
--   IF NOT FOUND THEN RAISE EXCEPTION 'Contact not found.'; END IF;
--
--   -- A number the contact card shows: a phone identity, or the phone on the
--   -- contact record.
--   IF btrim(coalesce(v_contact.phone, '')) = '' AND NOT EXISTS (
--     SELECT 1 FROM public.contact_identities i
--      WHERE i.tenant_id = v_tenant AND i.contact_id = p_contact_id
--        AND i.kind = 'phone' AND i.normalized <> ''
--   ) THEN
--     RAISE EXCEPTION 'Add a WhatsApp phone number to this contact first.';
--   END IF;
--
--   IF NOT coalesce(v_contact.consent_given, false) THEN
--     RAISE EXCEPTION 'Record this contact''s permission before starting a WhatsApp conversation.';
--   END IF;
--   IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_tenant
--     AND NOT suspended AND subscription_status IN ('trial', 'active')) THEN
--     RAISE EXCEPTION 'Sending is paused for this workspace. Check its subscription.';
--   END IF;
--   SELECT * INTO v_conversation FROM public.conversations
--     WHERE tenant_id = v_tenant AND contact_id = p_contact_id AND channel = 'whatsapp';
--   SELECT assigned_wa_number_id INTO v_number FROM public.leads
--     WHERE tenant_id = v_tenant AND contact_id = p_contact_id AND assigned_wa_number_id IS NOT NULL
--     ORDER BY created_at, id LIMIT 1;
--   IF v_number IS NOT NULL AND v_conversation.wa_number_id IS NOT NULL
--      AND v_number <> v_conversation.wa_number_id THEN
--     RAISE EXCEPTION 'This contact is assigned to a different WhatsApp line. Ask an administrator to resolve its routing.';
--   END IF;
--   v_number := coalesce(v_number, v_conversation.wa_number_id);
--   IF v_number IS NULL THEN
--     SELECT id INTO v_number FROM public.wa_numbers
--       WHERE tenant_id = v_tenant AND active AND is_default ORDER BY id LIMIT 1;
--   END IF;
--   IF v_number IS NULL OR NOT EXISTS (SELECT 1 FROM public.wa_numbers
--     WHERE id = v_number AND tenant_id = v_tenant AND active) THEN
--     RAISE EXCEPTION 'Choose an active default WhatsApp number in Settings first.';
--   END IF;
--   INSERT INTO public.conversations (tenant_id, contact_id, channel, wa_number_id, bot_enabled)
--     VALUES (v_tenant, p_contact_id, 'whatsapp', v_number, false)
--     ON CONFLICT (tenant_id, contact_id) WHERE channel = 'whatsapp'
--     DO UPDATE SET wa_number_id = coalesce(conversations.wa_number_id, EXCLUDED.wa_number_id)
--     RETURNING id, wa_number_id INTO v_id, v_actual_number;
--   IF v_actual_number IS DISTINCT FROM v_number THEN
--     RAISE EXCEPTION 'The conversation was opened on another WhatsApp line. Refresh and check its routing.';
--   END IF;
--   RETURN v_id;
-- END;
-- $$;
--   DROP FUNCTION IF EXISTS public.apply_mfa_session_gate();
--   DROP FUNCTION IF EXISTS public.session_meets_mfa();
-- END
-- $rollback$;
-- </rollback>

BEGIN;

SET LOCAL lock_timeout = '2s';

-- ── 1. The rule ────────────────────────────────────────────────────────────
-- SECURITY DEFINER because the browser role is not allowed to read
-- auth.mfa_factors, and a policy runs as the browser role. search_path is empty
-- and every name is qualified, so nothing can be substituted for them.
-- There is deliberately no EXCEPTION block: if this function cannot do its job
-- the statement fails loudly (an outage we would notice and kill-switch) rather
-- than answering "true" in silence (a gap nobody would notice).
-- SET row_security = off is the same promise for one case that is otherwise
-- silent: if row-level security is on for auth.mfa_factors and the role that
-- owns this function is exempt from it neither as a superuser, nor by BYPASSRLS,
-- nor as the table's owner, a plain query reads ZERO rows without any error, so
-- "no factor" would be the answer for everybody and the gate would be inert. With
-- row_security off, PostgreSQL raises "query would be affected by row-level
-- security policy" instead. An exempt owner (the project's postgres role) is not
-- affected by the setting. The pre-flight below turns the error into plain words.
--   * no identity at all                 -> false
--   * token says aal2                    -> true  (no table is read)
--   * anything else (aal1, no claim,
--     aal3, a claim of another shape)    -> true only if the person has no
--                                           VERIFIED authenticator-app (totp)
--                                           factor. An unverified (half-finished
--                                           set-up) factor does not count; a
--                                           verified phone or security-key
--                                           factor does not count either,
--                                           because the app can neither enrol
--                                           nor ask for those, so counting
--                                           them would lock a person out with
--                                           no way to enter a code.
CREATE OR REPLACE FUNCTION public.session_meets_mfa()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  IF coalesce(auth.jwt() ->> 'aal', '') = 'aal2' THEN
    RETURN true;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1
      FROM auth.mfa_factors f
     WHERE f.user_id = auth.uid()
       AND f.status::text = 'verified'
       AND f.factor_type::text = 'totp'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.session_meets_mfa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_meets_mfa() TO authenticated, service_role;

-- ── 1b. open_contact_whatsapp() must be PR #66's version before it is guarded ─
-- This file re-creates the function from #66's body. If #66 is not applied, that
-- would install #66 behind its back; so stop and say which file comes first.
DO $$
BEGIN
  IF to_regprocedure('public.open_contact_whatsapp(uuid)') IS NULL
     OR pg_get_functiondef(to_regprocedure('public.open_contact_whatsapp(uuid)')) NOT LIKE '%contact_identities%'
  THEN
    RAISE EXCEPTION
      'mfa_session_gate: apply 20261007130000_open_contact_whatsapp_phone_identity.sql first (open_contact_whatsapp is missing or is not that version); nothing was changed';
  END IF;
END
$$;

-- ── 2. Pre-flight: stop before changing anything if the rule cannot run ─────
-- Calls the real function the way a request does, which reads auth.mfa_factors
-- as the function's OWNER (not necessarily whoever pastes this file), exactly as
-- it will at run time:
--   a. for a person with no factor at all: must answer true. If the owner cannot
--      read the table (no SELECT; or row-level security on and the owner exempt
--      from it neither as a superuser, nor by BYPASSRLS, nor as the table's owner,
--      which would make a plain query see no rows and the gate inert) the call
--      raises; this block turns that into plain words and ends the transaction
--      before any policy is created.
--   b. when somebody already has a verified authenticator app: the rule must
--      answer false for that person at aal1. This is the only proof on real data
--      that the rule can see a factor; if nobody has one yet it says so and goes on.
DO $$
DECLARE
  nobody constant text := '00000000-0000-0000-0000-000000000000';
  answer boolean;
  sample uuid;
  owner_name text;
  has_rls boolean;
  exempt_by_role boolean;
  exempt_as_owner boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', nobody, true);
  PERFORM set_config('request.jwt.claims', '{"sub":"' || nobody || '","aal":"aal1"}', true);
  BEGIN
    answer := public.session_meets_mfa();
  EXCEPTION WHEN insufficient_privilege THEN
    SELECT r.rolname, c.relrowsecurity, (r.rolsuper OR r.rolbypassrls),
           (pg_has_role(r.oid, c.relowner, 'USAGE') AND NOT c.relforcerowsecurity)
      INTO owner_name, has_rls, exempt_by_role, exempt_as_owner
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner,
           pg_class c
     WHERE p.oid = 'public.session_meets_mfa()'::regprocedure
       AND c.oid = 'auth.mfa_factors'::regclass;
    RAISE EXCEPTION 'mfa_session_gate pre-flight: the role that owns the rule (%) cannot read auth.mfa_factors (%). Row-level security on that table is %; the role is exempt from it as superuser/BYPASSRLS: %; as the table''s owner: %. Without reading it the rule would see no factors and let everybody in, so nothing was changed. Run this file as the project''s postgres role.',
      owner_name, SQLERRM, CASE WHEN has_rls THEN 'on' ELSE 'off' END, exempt_by_role, exempt_as_owner;
  END;
  IF answer IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'mfa_session_gate pre-flight: the rule answered % for a person without a factor; nothing was changed', answer;
  END IF;

  SELECT f.user_id INTO sample
    FROM auth.mfa_factors f
   WHERE f.status::text = 'verified' AND f.factor_type::text = 'totp'
   LIMIT 1;
  IF sample IS NULL THEN
    RAISE NOTICE 'mfa_session_gate pre-flight: nobody has a verified authenticator app yet, so the rule could not be tried on a real one';
  ELSE
    PERFORM set_config('request.jwt.claim.sub', sample::text, true);
    PERFORM set_config('request.jwt.claims', '{"sub":"' || sample::text || '","aal":"aal1"}', true);
    answer := public.session_meets_mfa();
    IF answer IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'mfa_session_gate pre-flight: the rule answered % for a person who has a verified authenticator app and has not entered the code; the gate would let that person in; nothing was changed', answer;
    END IF;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

-- ── 3. list_subscribers(): a definer function skips policies ───────────────
-- Same body as 20260904010000; only the first check is new.
CREATE OR REPLACE FUNCTION public.list_subscribers()
RETURNS SETOF public.super_admin_subscribers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.session_meets_mfa() THEN
    RAISE EXCEPTION 'Two-factor code required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Super admin only';
  END IF;
  RETURN QUERY SELECT * FROM public.super_admin_subscribers ORDER BY company_created_at DESC;
END; $$;
REVOKE ALL ON FUNCTION public.list_subscribers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_subscribers() TO authenticated;

-- ── 3b. open_contact_whatsapp(): a definer function skips policies, too ───────
-- PR #66's body (20261007130000_open_contact_whatsapp_phone_identity.sql), copied
-- unchanged, plus ONE guard placed right after its own sign-in check, so a caller
-- with no identity still gets #66's message and everybody else the gate lets in
-- gets exactly what #66 gave. REVOKE/GRANT are #66's, repeated so a re-run can
-- never leave the function more open than #66 left it.
CREATE OR REPLACE FUNCTION public.open_contact_whatsapp(p_contact_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_contact public.contacts%ROWTYPE;
  v_conversation public.conversations%ROWTYPE;
  v_number uuid;
  v_id uuid;
  v_actual_number uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in again.'; END IF;
  IF NOT public.session_meets_mfa() THEN
    RAISE EXCEPTION 'Two-factor code required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Your workspace is not ready.'; END IF;
  SELECT * INTO v_contact FROM public.contacts
    WHERE id = p_contact_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contact not found.'; END IF;

  -- A number the contact card shows: a phone identity, or the phone on the
  -- contact record.
  IF btrim(coalesce(v_contact.phone, '')) = '' AND NOT EXISTS (
    SELECT 1 FROM public.contact_identities i
     WHERE i.tenant_id = v_tenant AND i.contact_id = p_contact_id
       AND i.kind = 'phone' AND i.normalized <> ''
  ) THEN
    RAISE EXCEPTION 'Add a WhatsApp phone number to this contact first.';
  END IF;

  IF NOT coalesce(v_contact.consent_given, false) THEN
    RAISE EXCEPTION 'Record this contact''s permission before starting a WhatsApp conversation.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_tenant
    AND NOT suspended AND subscription_status IN ('trial', 'active')) THEN
    RAISE EXCEPTION 'Sending is paused for this workspace. Check its subscription.';
  END IF;
  SELECT * INTO v_conversation FROM public.conversations
    WHERE tenant_id = v_tenant AND contact_id = p_contact_id AND channel = 'whatsapp';
  SELECT assigned_wa_number_id INTO v_number FROM public.leads
    WHERE tenant_id = v_tenant AND contact_id = p_contact_id AND assigned_wa_number_id IS NOT NULL
    ORDER BY created_at, id LIMIT 1;
  IF v_number IS NOT NULL AND v_conversation.wa_number_id IS NOT NULL
     AND v_number <> v_conversation.wa_number_id THEN
    RAISE EXCEPTION 'This contact is assigned to a different WhatsApp line. Ask an administrator to resolve its routing.';
  END IF;
  v_number := coalesce(v_number, v_conversation.wa_number_id);
  IF v_number IS NULL THEN
    SELECT id INTO v_number FROM public.wa_numbers
      WHERE tenant_id = v_tenant AND active AND is_default ORDER BY id LIMIT 1;
  END IF;
  IF v_number IS NULL OR NOT EXISTS (SELECT 1 FROM public.wa_numbers
    WHERE id = v_number AND tenant_id = v_tenant AND active) THEN
    RAISE EXCEPTION 'Choose an active default WhatsApp number in Settings first.';
  END IF;
  INSERT INTO public.conversations (tenant_id, contact_id, channel, wa_number_id, bot_enabled)
    VALUES (v_tenant, p_contact_id, 'whatsapp', v_number, false)
    ON CONFLICT (tenant_id, contact_id) WHERE channel = 'whatsapp'
    DO UPDATE SET wa_number_id = coalesce(conversations.wa_number_id, EXCLUDED.wa_number_id)
    RETURNING id, wa_number_id INTO v_id, v_actual_number;
  IF v_actual_number IS DISTINCT FROM v_number THEN
    RAISE EXCEPTION 'The conversation was opened on another WhatsApp line. Refresh and check its routing.';
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.open_contact_whatsapp(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_contact_whatsapp(uuid) TO authenticated;

-- ── 4. The policy, on every table that has row-level security ──────────────
-- The tables come from the catalogue, never from a list typed here, so a table
-- added by any migration (including one nobody remembered) is covered. It also
-- covers storage.objects. Not callable by anyone but the owner: it changes policies.
--
-- LOCKS. Creating or dropping a policy needs an ACCESS EXCLUSIVE lock on the table,
-- which makes every reader and writer of that table wait. Taken one table at a time
-- by waiting, the file would hold the locks it already has (every table before the
-- busy one) while it waited for the busy one, and the whole app would queue behind
-- it. So the function:
--   * touches only tables that do NOT already have the exact policy, so running it
--     again (or at the end of a later migration) locks nothing that is already done;
--   * takes the locks it needs on all of those tables BEFORE changing anything, in
--     one order (storage.objects first: Storage uploads hold locks the longest),
--     and takes each one with NOWAIT: a busy table makes the attempt fail at once,
--     the attempt's locks are let go at once (nobody queues behind it), it waits a
--     quarter of a second and tries again, for about 5 seconds;
--   * after that it stops with a message naming the busy table and changes nothing.
-- Then it creates the policies, holding every lock it needs, so nothing waits
-- midway and nobody can slip in between the drop and the create.
CREATE OR REPLACE FUNCTION public.apply_mfa_session_gate()
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  -- See "NOT COVERED HERE" at the top of the file. Delete a name once nothing
  -- refuses a policy on that table any more.
  left_out constant text[] := ARRAY['tenant_alert_settings', 'lead_alerts_log'];
  -- About 5 seconds in all.
  max_attempts constant integer := 20;
  pause constant double precision := 0.25;
  browser_role oid;
  every_table text[];
  todo text[];
  busy text;
  attempt integer := 0;
  one text;
BEGIN
  SELECT r.oid INTO browser_role FROM pg_catalog.pg_roles r WHERE r.rolname = 'authenticated';

  -- Every table that must have the gate, and those of them that do not have it yet.
  -- A policy counts as "has it" only if it is exactly the one this function creates:
  -- restrictive, for all commands, for the browser role, and both expressions are
  -- nothing but a call to the rule. A hand-made variant is replaced.
  SELECT coalesce(array_agg(t.qname ORDER BY t.storage_first, t.qname), '{}'),
         coalesce(array_agg(t.qname ORDER BY t.storage_first, t.qname) FILTER (WHERE NOT t.current_gate), '{}')
    INTO every_table, todo
    FROM (
      SELECT pg_catalog.format('%I.%I', n.nspname, c.relname) AS qname,
             (n.nspname <> 'storage') AS storage_first,
             EXISTS (
               SELECT 1 FROM pg_catalog.pg_policy p
                WHERE p.polrelid = c.oid
                  AND p.polname = 'mfa_session_gate'
                  AND NOT p.polpermissive
                  AND p.polcmd = '*'
                  AND p.polroles = ARRAY[browser_role]
                  AND pg_catalog.pg_get_expr(p.polqual, p.polrelid)
                        ~ '^\(\s*SELECT\s+(public\.)?session_meets_mfa\(\)\s+AS\s+session_meets_mfa\s*\)$'
                  AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)
                        ~ '^\(\s*SELECT\s+(public\.)?session_meets_mfa\(\)\s+AS\s+session_meets_mfa\s*\)$'
             ) AS current_gate
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p')
         AND ((n.nspname = 'public' AND c.relrowsecurity AND NOT (c.relname = ANY (left_out)))
              OR (n.nspname = 'storage' AND c.relname = 'objects'))
    ) t;

  IF cardinality(todo) > 0 THEN
    LOOP
      attempt := attempt + 1;
      BEGIN
        FOREACH busy IN ARRAY todo LOOP
          EXECUTE pg_catalog.format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT', busy);
        END LOOP;
        EXIT; -- every lock is held
      EXCEPTION WHEN lock_not_available THEN
        -- The locks taken in this attempt were let go with the failed block.
        IF attempt >= max_attempts THEN
          RAISE EXCEPTION 'mfa_session_gate: % is in use by another session and could not be locked after % tries over about % seconds; nothing was changed. Nothing is wrong: run this file again in a quieter hour (it is safe to run again).',
            busy, attempt, round((max_attempts * pause)::numeric)
            USING ERRCODE = 'lock_not_available';
        END IF;
        PERFORM pg_catalog.pg_sleep(pause);
      END;
    END LOOP;

    FOREACH one IN ARRAY todo LOOP
      EXECUTE pg_catalog.format('DROP POLICY IF EXISTS mfa_session_gate ON %s', one);
      EXECUTE pg_catalog.format(
        'CREATE POLICY mfa_session_gate ON %s AS RESTRICTIVE FOR ALL TO authenticated '
        'USING ((SELECT public.session_meets_mfa())) '
        'WITH CHECK ((SELECT public.session_meets_mfa()))',
        one);
    END LOOP;
  END IF;
  RETURN cardinality(every_table);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_mfa_session_gate() FROM PUBLIC, anon, authenticated, service_role;

SELECT public.apply_mfa_session_gate();

-- Fail the whole file if any table with row-level security was left without it.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(n.nspname || '.' || c.relname, ', ' ORDER BY n.nspname, c.relname)
    INTO missing
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p')
     AND c.relrowsecurity
     AND n.nspname = 'public'
     AND c.relname NOT IN ('tenant_alert_settings', 'lead_alerts_log')
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy p
        WHERE p.polrelid = c.oid
          AND p.polname = 'mfa_session_gate'
          AND NOT p.polpermissive
     );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'mfa_session_gate: tables left without the policy: %', missing;
  END IF;
END;
$$;

COMMIT;

-- ── Verification (read-only). Expect: missing = 0 and
--    gated = rls_tables - left_out + 1   (the +1 is storage.objects) ─────────
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity) AS rls_tables,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
      AND c.relname IN ('tenant_alert_settings', 'lead_alerts_log')) AS left_out,
  (SELECT count(*) FROM pg_policies
    WHERE policyname = 'mfa_session_gate' AND permissive = 'RESTRICTIVE') AS gated,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
      AND c.relname NOT IN ('tenant_alert_settings', 'lead_alerts_log')
      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
                       AND p.polname = 'mfa_session_gate' AND NOT p.polpermissive)) AS missing;
