-- ==============================================================================
-- Migration: 20261022000000_staff_department_routing_and_alerts.sql
-- Description:
--   1. Staff Department & Number Management (Sales, Reception, Maintenance,
--      IT Support, Technician, Department Head).
--   2. Customizable WhatsApp Alert Template for Staff Notifications.
--   3. Rapid-inbound message debouncing & multi-CRM coexistence support.
-- ==============================================================================

BEGIN;

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
  notify_on_lead boolean NOT NULL DEFAULT true,
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
  FOR ALL
  TO authenticated
  USING (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

GRANT ALL ON public.tenant_staff_routing_numbers TO authenticated;
GRANT ALL ON public.tenant_staff_routing_numbers TO service_role;

-- 2. Extend tenant_bot_settings with Staff Alert Template & Coexistence Settings
ALTER TABLE public.tenant_bot_settings
  ADD COLUMN IF NOT EXISTS staff_alert_template text DEFAULT '🚨 *New Customer Request - {{department}}*\n👤 *Customer:* {{customer_name}}\n📞 *Phone:* {{customer_phone}}\n🏢 *Department:* {{department}}\n📝 *Requirements:* {{customer_requirements}}\n⏰ *Time:* {{timestamp}}',
  ADD COLUMN IF NOT EXISTS staff_alert_whatsapp_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_department_handoff_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS debounce_window_seconds integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS multi_crm_coexistence_enabled boolean NOT NULL DEFAULT true;

-- 3. Extend conversations with bot debounce & lock tracking
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_bot_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_department text;

COMMIT;
