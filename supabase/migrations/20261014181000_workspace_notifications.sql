-- Personal lead alerts: service creates, recipient reads/marks read.
-- No existing history is changed. Apply before enabling the new notification UI.
BEGIN;
CREATE TABLE IF NOT EXISTS public.workspace_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(title) <= 200),
  body text NOT NULL CHECK (length(body) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS workspace_notifications_recipient_created
ON public.workspace_notifications(tenant_id, recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workspace_notifications_unread
ON public.workspace_notifications(tenant_id, recipient_user_id) WHERE read_at IS NULL;
ALTER TABLE public.workspace_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_notifications FROM PUBLIC, anon, authenticated;
DO $$
DECLARE columns_sql text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ') INTO columns_sql FROM pg_attribute
  WHERE attrelid = 'public.workspace_notifications'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE SELECT (%s), INSERT (%s), UPDATE (%s), REFERENCES (%s) ON public.workspace_notifications FROM PUBLIC, anon, authenticated', columns_sql, columns_sql, columns_sql, columns_sql);
END $$;
GRANT SELECT ON public.workspace_notifications TO authenticated;
GRANT UPDATE(read_at) ON public.workspace_notifications TO authenticated;
GRANT SELECT, INSERT ON public.workspace_notifications TO service_role;
DROP POLICY IF EXISTS workspace_notifications_own_read ON public.workspace_notifications;
CREATE POLICY workspace_notifications_own_read ON public.workspace_notifications
FOR SELECT TO authenticated USING (recipient_user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.tenant_id = workspace_notifications.tenant_id
  AND p.staff_role IN ('company_admin', 'super_admin', 'marketing_manager', 'staff')
));
DROP POLICY IF EXISTS workspace_notifications_own_mark_read ON public.workspace_notifications;
CREATE POLICY workspace_notifications_own_mark_read ON public.workspace_notifications
FOR UPDATE TO authenticated USING (recipient_user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.tenant_id = workspace_notifications.tenant_id
  AND p.staff_role IN ('company_admin', 'super_admin', 'marketing_manager', 'staff')
)) WITH CHECK (recipient_user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.tenant_id = workspace_notifications.tenant_id
  AND p.staff_role IN ('company_admin', 'super_admin', 'marketing_manager', 'staff')
));
CREATE OR REPLACE FUNCTION public.validate_workspace_notification_recipient()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.recipient_user_id
    AND p.tenant_id = NEW.tenant_id AND p.staff_role IN ('company_admin', 'super_admin', 'marketing_manager', 'staff')) THEN
    RAISE EXCEPTION 'Notification recipient does not belong to this workspace or eligible role' USING ERRCODE = '23503';
  END IF;
  IF NEW.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.leads l
    WHERE l.id = NEW.lead_id AND l.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Notification lead does not belong to this workspace' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_workspace_notification_recipient() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_workspace_notification_recipient() TO service_role;
DROP TRIGGER IF EXISTS workspace_notification_recipient_guard ON public.workspace_notifications;
CREATE TRIGGER workspace_notification_recipient_guard BEFORE INSERT ON public.workspace_notifications
FOR EACH ROW EXECUTE FUNCTION public.validate_workspace_notification_recipient();
COMMIT;
