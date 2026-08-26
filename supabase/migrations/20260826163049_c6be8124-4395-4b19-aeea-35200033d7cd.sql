CREATE TABLE IF NOT EXISTS public.oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  platform text NOT NULL,
  state text NOT NULL UNIQUE,
  redirect_uri text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS oauth_states_state_idx ON public.oauth_states(state);
GRANT SELECT, INSERT ON public.oauth_states TO authenticated;
GRANT ALL ON public.oauth_states TO service_role;
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Team manages own oauth states" ON public.oauth_states;
CREATE POLICY "Team manages own oauth states" ON public.oauth_states
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());