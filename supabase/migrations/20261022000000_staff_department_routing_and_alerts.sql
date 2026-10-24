-- ==============================================================================
-- Migration: 20261022000000_staff_department_routing_and_alerts.sql
-- Description:
--   1. Staff Department & Number Management (Sales, Reception, Maintenance,
--      IT Support, Technician, Department Head).
--   2. Customizable WhatsApp Alert Template for Staff Notifications.
--   3. Department labels and legacy grouping fields (no delayed worker).
-- Unapplied PR #99 migration, reviewed and repaired before release.
-- ==============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Create table for Staff Department Numbers
CREATE TABLE IF NOT EXISTS public.tenant_staff_routing_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text NOT NULL,
  department text NOT NULL CHECK (
    department IN ('sales', 'reception', 'maintenance', 'it_support', 'technician', 'department_head', 'other')
  ),
  role_title text,
  notify_on_lead boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for tenant and department lookups
CREATE INDEX IF NOT EXISTS idx_staff_routing_tenant_dept
  ON public.tenant_staff_routing_numbers (tenant_id, department, is_active);

-- Enable RLS
ALTER TABLE public.tenant_staff_routing_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_routing_numbers_tenant_isolation" ON public.tenant_staff_routing_numbers;
CREATE POLICY "staff_routing_numbers_tenant_isolation"
  ON public.tenant_staff_routing_numbers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
      AND p.tenant_id = tenant_staff_routing_numbers.tenant_id
      AND p.staff_role IN ('company_admin', 'super_admin'))
  );
-- Other permissive policies cannot widen the admin/company boundary.
DROP POLICY IF EXISTS staff_routing_admin_gate ON public.tenant_staff_routing_numbers;
CREATE POLICY staff_routing_admin_gate ON public.tenant_staff_routing_numbers
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
    AND p.tenant_id = tenant_staff_routing_numbers.tenant_id
    AND p.staff_role IN ('company_admin', 'super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
    AND p.tenant_id = tenant_staff_routing_numbers.tenant_id
    AND p.staff_role IN ('company_admin', 'super_admin')));

-- Recipients are server controlled. Remove legacy table AND column grants.
REVOKE ALL ON public.tenant_staff_routing_numbers FROM PUBLIC, anon, authenticated;
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenant_staff_routing_numbers'
  LOOP
    EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.tenant_staff_routing_numbers FROM PUBLIC, anon, authenticated',
      c.column_name, c.column_name, c.column_name, c.column_name);
  END LOOP;
END $$;
GRANT SELECT ON public.tenant_staff_routing_numbers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_staff_routing_numbers TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS staff_routing_tenant_phone_unique
  ON public.tenant_staff_routing_numbers (tenant_id, (regexp_replace(phone, '[^0-9]', '', 'g')));
ALTER TABLE public.tenant_staff_routing_numbers ALTER COLUMN notify_on_lead SET DEFAULT false;

-- 2. Extend tenant_bot_settings with Staff Alert Template & Coexistence Settings
ALTER TABLE public.tenant_bot_settings
  ADD COLUMN IF NOT EXISTS staff_alert_template text DEFAULT '🚨 *New Customer Request - {{department}}*\n👤 *Customer:* {{customer_name}}\n📞 *Phone:* {{customer_phone}}\n🏢 *Department:* {{department}}\n📝 *Requirements:* {{customer_requirements}}\n⏰ *Time:* {{timestamp}}',
  ADD COLUMN IF NOT EXISTS staff_alert_whatsapp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_alert_actor_id uuid,
  ADD COLUMN IF NOT EXISTS auto_department_handoff_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS debounce_window_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS multi_crm_coexistence_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.tenant_bot_settings
  ALTER COLUMN staff_alert_whatsapp_enabled SET DEFAULT false,
  ALTER COLUMN auto_department_handoff_enabled SET DEFAULT false,
  ALTER COLUMN debounce_window_seconds SET DEFAULT 0,
  ALTER COLUMN multi_crm_coexistence_enabled SET DEFAULT false;

-- 3. Extend conversations with bot debounce & lock tracking
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_bot_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_department text;

NOTIFY pgrst, 'reload schema';
COMMIT;
