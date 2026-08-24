ALTER TABLE public.messages ADD COLUMN translated_body text;
ALTER TABLE public.messages ADD COLUMN detected_language text;

GRANT SELECT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

-- RLS is already enabled; no new policies needed because the existing
-- policy covers the new columns.