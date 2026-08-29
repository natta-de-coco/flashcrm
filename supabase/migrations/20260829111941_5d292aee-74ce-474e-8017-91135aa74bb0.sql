CREATE POLICY "Service processes manage auth email attempts"
ON public.auth_email_attempts
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);