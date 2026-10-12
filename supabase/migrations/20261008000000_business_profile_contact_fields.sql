-- Add contact and tax fields to business_profiles
ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS mobile_phone text,
  ADD COLUMN IF NOT EXISTS landline_phone text,
  ADD COLUMN IF NOT EXISTS whatsapp_number text,
  ADD COLUMN IF NOT EXISTS tax_registration_number text,
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'AE',
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
