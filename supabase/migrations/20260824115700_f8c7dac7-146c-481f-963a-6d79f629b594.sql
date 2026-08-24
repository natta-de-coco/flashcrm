ALTER TABLE public.wa_numbers
  ADD COLUMN IF NOT EXISTS alerts_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deliverability_min numeric NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS read_rate_min numeric NOT NULL DEFAULT 50;