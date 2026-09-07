-- ═════════════════════════════════════════════════════════════════════════════
-- Flas CRM — tenant isolation & security hardening
-- Written 2026-09-01, verified against the ACTUAL migration history in this
-- repo (not just the 2026-08-29 audit doc, which had gone stale on a few
-- items — wa_numbers/contacts/products/platform_apps/audit_log already had
-- correct tenant-scoped RLS by the time this was written; this migration only
-- touches what's still genuinely broken).
--
-- Idempotent. Safe to re-run. Run AFTER all prior migrations.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. conversations — no tenant_id at all today. Backfill from the contact.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

UPDATE public.conversations c
   SET tenant_id = ct.tenant_id
  FROM public.contacts ct
 WHERE c.contact_id = ct.id AND c.tenant_id IS NULL AND ct.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversations_tenant_idx ON public.conversations (tenant_id);
CREATE INDEX IF NOT EXISTS conversations_contact_idx ON public.conversations (contact_id);
CREATE INDEX IF NOT EXISTS conversations_wa_number_idx ON public.conversations (wa_number_id);

DROP POLICY IF EXISTS "conversations_team_all" ON public.conversations;
DROP POLICY IF EXISTS "conversations_tenant_all" ON public.conversations;
CREATE POLICY "conversations_tenant_all" ON public.conversations FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. messages — no tenant_id at all today. Backfill from the conversation.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

UPDATE public.messages m
   SET tenant_id = c.tenant_id
  FROM public.conversations c
 WHERE m.conversation_id = c.id AND m.tenant_id IS NULL AND c.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_tenant_idx ON public.messages (tenant_id);

DROP POLICY IF EXISTS "messages_team_all" ON public.messages;
DROP POLICY IF EXISTS "messages_tenant_all" ON public.messages;
CREATE POLICY "messages_tenant_all" ON public.messages FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. reminders — no tenant_id at all today. Backfill via conversation, then contact.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

UPDATE public.reminders r
   SET tenant_id = c.tenant_id
  FROM public.conversations c
 WHERE r.conversation_id = c.id AND r.tenant_id IS NULL AND c.tenant_id IS NOT NULL;

UPDATE public.reminders r
   SET tenant_id = ct.tenant_id
  FROM public.contacts ct
 WHERE r.contact_id = ct.id AND r.tenant_id IS NULL AND ct.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reminders_tenant_due_idx ON public.reminders (tenant_id, due_at);
CREATE INDEX IF NOT EXISTS reminders_conversation_idx ON public.reminders (conversation_id);
CREATE INDEX IF NOT EXISTS reminders_contact_idx ON public.reminders (contact_id);
CREATE INDEX IF NOT EXISTS reminders_assigned_idx ON public.reminders (assigned_to);

DROP POLICY IF EXISTS "Team can manage reminders" ON public.reminders;
DROP POLICY IF EXISTS "reminders_tenant_all" ON public.reminders;
CREATE POLICY "reminders_tenant_all" ON public.reminders FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. campaigns — no tenant_id at all today. Backfill via the creator's profile.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

UPDATE public.campaigns camp
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE camp.created_by = p.id AND camp.tenant_id IS NULL AND p.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS campaigns_tenant_idx ON public.campaigns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campaigns_created_by_idx ON public.campaigns (created_by);

DROP POLICY IF EXISTS "Team can manage campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_tenant_all" ON public.campaigns;
CREATE POLICY "campaigns_tenant_all" ON public.campaigns FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. webhook_events — no tenant_id today; RLS is allow-all. Historical rows
--    can't be reliably backfilled (payload shape varies by source), so they
--    stay NULL and are visible only to super admins. New rows must be written
--    with tenant_id by the app going forward (see code changes).
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS webhook_events_tenant_idx ON public.webhook_events (tenant_id, created_at DESC);

DROP POLICY IF EXISTS "Team can read webhook events" ON public.webhook_events;
DROP POLICY IF EXISTS "Team can update webhook events" ON public.webhook_events;
DROP POLICY IF EXISTS "webhook_events_read_tenant" ON public.webhook_events;
CREATE POLICY "webhook_events_read_tenant" ON public.webhook_events FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "webhook_events_update_tenant" ON public.webhook_events;
CREATE POLICY "webhook_events_update_tenant" ON public.webhook_events FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. wa_templates — tenant_id column exists (added 2026-08-22) but the RLS
--    policies were never updated off their original allow-all state, and the
--    UNIQUE(name) constraint is global instead of per-tenant.
-- ═════════════════════════════════════════════════════════════════════════════
UPDATE public.wa_templates SET tenant_id = (
  SELECT p.tenant_id FROM public.profiles p WHERE p.tenant_id IS NOT NULL LIMIT 1
) WHERE tenant_id IS NULL;

DROP POLICY IF EXISTS "Team can read templates" ON public.wa_templates;
DROP POLICY IF EXISTS "Admins can manage templates" ON public.wa_templates;
DROP POLICY IF EXISTS "wa_templates_read_tenant" ON public.wa_templates;
CREATE POLICY "wa_templates_read_tenant" ON public.wa_templates FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS "wa_templates_admin_manage" ON public.wa_templates;
CREATE POLICY "wa_templates_admin_manage" ON public.wa_templates FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wa_templates_name_key') THEN
    ALTER TABLE public.wa_templates DROP CONSTRAINT wa_templates_name_key;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS wa_templates_tenant_name_key ON public.wa_templates (tenant_id, name);

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. user_roles — the 2026-08-20 "roles_read_all" policy (USING(true)) was
--    never revisited. Every user's platform role is currently readable by
--    every other authenticated user.
-- ═════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "roles_read_all" ON public.user_roles;
DROP POLICY IF EXISTS "roles_read_self_or_admin" ON public.user_roles;
CREATE POLICY "roles_read_self_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.is_super_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. team_invites — any tenant member (not just admins) can create invites,
--    and nothing stops them setting staff_role='super_admin' on the invite.
-- ═════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Tenant members can manage own invites" ON public.team_invites;
DROP POLICY IF EXISTS "team_invites_read_tenant" ON public.team_invites;
CREATE POLICY "team_invites_read_tenant" ON public.team_invites FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS "team_invites_admin_write" ON public.team_invites;
CREATE POLICY "team_invites_admin_write" ON public.team_invites FOR ALL TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.staff_role = 'company_admin'
    ))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND staff_role <> 'super_admin'
    AND (public.has_role(auth.uid(), 'admin') OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.staff_role = 'company_admin'
    ))
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 9. organizations — "orgs_admin_write" checks "is this user an admin
--    anywhere" (the legacy app_role system) instead of "is this user an
--    admin of THIS org". Any admin in any tenant can currently update any
--    other tenant's organization row (plan, suspended, paddle ids...).
-- ═════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "orgs_admin_write" ON public.organizations;
DROP POLICY IF EXISTS "orgs_own_tenant_admin_write" ON public.organizations;
CREATE POLICY "orgs_own_tenant_admin_write" ON public.organizations FOR UPDATE TO authenticated
  USING (
    id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.staff_role = 'company_admin'
    ))
  )
  WITH CHECK (
    id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.staff_role = 'company_admin'
    ))
  );
DROP POLICY IF EXISTS "orgs_super_admin_all" ON public.organizations;
CREATE POLICY "orgs_super_admin_all" ON public.organizations FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- 10. platform_apps.client_secret — RLS is already tenant-scoped correctly,
--     but any signed-in member of the tenant (not just admins) can currently
--     SELECT the raw client_secret column. Restrict the column grant; the
--     app only ever reads the secret server-side via supabaseAdmin (service
--     role), which keeps GRANT ALL regardless of this change.
-- ═════════════════════════════════════════════════════════════════════════════
REVOKE SELECT ON public.platform_apps FROM authenticated;
GRANT SELECT (id, tenant_id, provider, client_id, label, created_at, updated_at)
  ON public.platform_apps TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 11. audit_log — tenant scoping is already correct, but nothing stops an
--     authenticated client from calling the REST/JS API directly (bypassing
--     our server functions) and inserting a row with an arbitrary actor_id,
--     forging who did what. All real app writes already go through
--     supabaseAdmin (service_role, unaffected by this revoke).
-- ═════════════════════════════════════════════════════════════════════════════
REVOKE INSERT ON public.audit_log FROM authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 12. handle_new_user — the very first person to ever sign up on a fresh
--     deployment is silently granted the legacy 'admin' app_role. Only
--     matters until a real admin signs up, but a customer beating you to it
--     on a fresh environment inherits admin. Gate it on platform_super_admins
--     instead of "count(*) = 0".
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.platform_super_admins WHERE lower(email) = lower(NEW.email)
  ) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin'::public.app_role) ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'agent'::public.app_role) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 13. Webhook idempotency (Meta/Paddle/Shopify all currently retry-unsafe).
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.webhook_dedup (
  event_source text NOT NULL,
  event_id     text NOT NULL,
  seen_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_source, event_id)
);
CREATE INDEX IF NOT EXISTS webhook_dedup_seen_idx ON public.webhook_dedup (seen_at);
GRANT SELECT, INSERT ON public.webhook_dedup TO service_role;
ALTER TABLE public.webhook_dedup ENABLE ROW LEVEL SECURITY;
-- No policy for authenticated => deny by default; only service_role touches this.

COMMIT;

-- ─── Sanity checks (run AFTER commit; all counts should be 0 except where noted) ──
-- SELECT COUNT(*) AS conv_orphans     FROM public.conversations WHERE tenant_id IS NULL;
-- SELECT COUNT(*) AS msg_orphans      FROM public.messages       WHERE tenant_id IS NULL;
-- SELECT COUNT(*) AS reminder_orphans FROM public.reminders      WHERE tenant_id IS NULL;
-- SELECT COUNT(*) AS campaign_orphans FROM public.campaigns      WHERE tenant_id IS NULL;
-- -- webhook_events orphans are EXPECTED for rows created before this migration:
-- SELECT COUNT(*) AS webhook_orphans_pre_migration FROM public.webhook_events WHERE tenant_id IS NULL;
