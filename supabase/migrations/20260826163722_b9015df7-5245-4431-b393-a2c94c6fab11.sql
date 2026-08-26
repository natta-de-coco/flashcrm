ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
GRANT SELECT (last_seen_at) ON public.profiles TO authenticated;
GRANT UPDATE (last_seen_at) ON public.profiles TO authenticated;