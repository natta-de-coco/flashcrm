-- ═════════════════════════════════════════════════════════════════════════════
-- Flas CRM — "Open WhatsApp" accepts a number the contact card shows.
--
-- open_contact_whatsapp (20260927210000) refused a contact whose phone was
-- blank in contacts.phone. But a contact created with only an email, who then
-- has a number added from the contact card, holds that number only as a phone
-- identity in contact_identities -- addContactIdentity writes nothing to
-- contacts.phone. The card shows the number; the button said "Add a WhatsApp
-- phone number to this contact first."
--
-- This redefines the function. The only thing that changes is how it decides
-- the contact has a number: it has one when ANY of these is true --
--
--   - it has a phone identity (the primary one, or any other: a number added
--     from the card is not primary until someone makes it so, so asking for a
--     primary one would still refuse the flow above);
--   - contacts.phone, the legacy column, is filled in (contacts typed in by
--     hand or imported from a file hold their number only there).
--
-- A phone identity with no digits in it ("call the office") is not a number.
--
-- Every other check is the function's own and is unchanged, in the same order:
-- signed in, a workspace, the contact is this workspace's, recorded consent,
-- the subscription is not paused, the contact's routing, an active default
-- number. So are the grants: signed-in users only; nobody anonymous.
--
-- Identities are read only within the caller's own workspace and for this
-- contact. The function runs as its owner, so that filter is written out here
-- rather than left to row-level security.
--
-- Apply AFTER 20260927210000_open_contact_whatsapp.sql: this file stops with a
-- message, and changes nothing, if that migration is missing. The application
-- is not changed: before this is applied, the button behaves as it did.
--
-- Safe to run more than once.
--
-- Rollback: run the CREATE OR REPLACE FUNCTION statement, and the REVOKE and
-- GRANT under it, from 20260927210000_open_contact_whatsapp.sql again.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.open_contact_whatsapp(uuid)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'conversations_whatsapp_contact_unique'
     )
  THEN
    RAISE EXCEPTION
      'Apply 20260927210000_open_contact_whatsapp.sql first: open_contact_whatsapp or its conversation index is missing.';
  END IF;
END $$;

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

COMMIT;

-- Verification (read-only). Expect one row: runs_as_owner = true,
-- signed_in_user_may_call = true, visitor_may_call = false,
-- mentions_phone_identities = true.
SELECT p.proname AS function,
       p.prosecdef AS runs_as_owner,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS signed_in_user_may_call,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS visitor_may_call,
       (pg_get_functiondef(p.oid) LIKE '%contact_identities%') AS mentions_phone_identities
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'open_contact_whatsapp';
