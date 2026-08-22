CREATE TABLE public.wa_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  display_phone text,
  phone_number_id text NOT NULL,
  access_token text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_numbers TO authenticated;
GRANT ALL ON public.wa_numbers TO service_role;

ALTER TABLE public.wa_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage wa_numbers" ON public.wa_numbers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS wa_number_id uuid REFERENCES public.wa_numbers(id) ON DELETE SET NULL;

-- Ensure only one default number at a time
CREATE UNIQUE INDEX wa_numbers_single_default ON public.wa_numbers (is_default) WHERE is_default;