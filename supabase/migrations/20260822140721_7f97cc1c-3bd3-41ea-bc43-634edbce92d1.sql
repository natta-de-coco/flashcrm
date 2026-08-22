REVOKE SELECT ON public.wa_numbers FROM authenticated;
GRANT SELECT (id, label, display_phone, phone_number_id, is_default, active, created_at) ON public.wa_numbers TO authenticated;

CREATE POLICY "Team can view number basics" ON public.wa_numbers
  FOR SELECT TO authenticated
  USING (true);