-- One WhatsApp thread per contact, matching the inbound router's existing model.
-- Stop for manual review if historical duplicates exist; never merge/delete messages here.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_whatsapp_contact_unique
ON public.conversations (tenant_id, contact_id) WHERE channel = 'whatsapp';

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
  IF v_contact.phone IS NULL OR btrim(v_contact.phone) = '' THEN
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
