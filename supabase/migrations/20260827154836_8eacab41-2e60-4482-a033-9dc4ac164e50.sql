-- Trigger function should not be callable through the API at all
REVOKE ALL ON FUNCTION public.apply_super_admin_allowlist() FROM PUBLIC, anon, authenticated;

-- Platform-owner check is used inside access rules, so signed-in users need it,
-- but anonymous visitors never do.
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

-- Verification codes: explicit deny-by-default policy so the table is never
-- readable through the API; only server-side code (service role) touches it.
DROP POLICY IF EXISTS "no api access to otp codes" ON public.signup_otps;
CREATE POLICY "no api access to otp codes" ON public.signup_otps
  FOR SELECT TO authenticated USING (false);