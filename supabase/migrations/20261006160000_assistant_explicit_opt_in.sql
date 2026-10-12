-- ═════════════════════════════════════════════════════════════════════════════
-- Flas CRM — the assistant answers customers only where a company admin has
-- said it should.
--
-- Until now both switches defaulted to ON: a workspace's assistant
-- (tenant_bot_settings.enabled) and every new conversation
-- (conversations.bot_enabled). Automatic replies were something a company had
-- to notice and turn off.
--
-- This migration:
--   1. makes OFF the default for a new workspace and for a new conversation;
--   2. adds the policy a workspace opts in to, auto_enroll_new_chats: only
--      when it is on does a new conversation start with the assistant
--      answering;
--   3. records every change of either switch -- who, when, from what to what
--      -- in audit_log, from a trigger, so a change made straight through the
--      API is recorded like one made on the Chatbot page.
--
-- NOTHING is switched off for an existing workspace. A workspace whose
-- assistant is on today keeps it on, and is given auto_enroll_new_chats = true
-- so its new conversations are answered exactly as they are now. Existing
-- conversations are not touched. Which workspaces are on only because ON was
-- the default is a decision for the owner: see
-- supabase/proposals/20261006_assistant_opt_in_backfill.sql.
--
-- APPLY AFTER the application version that reads auto_enroll_new_chats is
-- deployed. Older code creates conversations without saying whether the
-- assistant answers them; once the default is OFF, that would stop new chats
-- being answered for workspaces that have opted in.
--
-- Safe to run more than once: the hand-over of existing workspaces happens
-- only when the policy column is first created.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Off unless someone says otherwise ────────────────────────────────────
ALTER TABLE public.tenant_bot_settings ALTER COLUMN enabled SET DEFAULT false;
ALTER TABLE public.conversations ALTER COLUMN bot_enabled SET DEFAULT false;

-- ── 2. The opt-in policy, and who last changed the switches ─────────────────
ALTER TABLE public.tenant_bot_settings
  ADD COLUMN IF NOT EXISTS automation_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS automation_changed_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'tenant_bot_settings'
       AND column_name = 'auto_enroll_new_chats'
  ) THEN
    ALTER TABLE public.tenant_bot_settings
      ADD COLUMN auto_enroll_new_chats boolean NOT NULL DEFAULT false;

    -- Once only: a workspace whose assistant is on has, until this moment,
    -- had every new conversation answered. It keeps that.
    UPDATE public.tenant_bot_settings SET auto_enroll_new_chats = true WHERE enabled;

    INSERT INTO public.audit_log (tenant_id, actor_id, actor_label, action, entity_type, entity_id, details)
    SELECT tenant_id, NULL, 'migration', 'assistant.automation_carried_over',
           'tenant_bot_settings', tenant_id::text,
           jsonb_build_object('enabled', true, 'auto_enroll_new_chats', true,
                              'note', 'on before opt-in was required; kept as it was')
      FROM public.tenant_bot_settings
     WHERE enabled;
  END IF;
END $$;

-- ── 3. Every change of either switch is recorded ────────────────────────────
-- SECURITY DEFINER because company users may not write audit_log themselves
-- (INSERT was revoked from them so that audit lines cannot be forged). The
-- function takes no input but the row being written, sets its own
-- search_path, and can only run as a trigger.
CREATE OR REPLACE FUNCTION public.note_assistant_automation_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    changed := NEW.enabled OR NEW.auto_enroll_new_chats;
    IF NOT changed THEN
      NEW.automation_changed_at := NULL;
      NEW.automation_changed_by := NULL;
    END IF;
  ELSE
    changed := NEW.enabled IS DISTINCT FROM OLD.enabled
            OR NEW.auto_enroll_new_chats IS DISTINCT FROM OLD.auto_enroll_new_chats;
    IF NOT changed THEN
      -- "Who changed it, and when" is never something the writer supplies.
      NEW.automation_changed_at := OLD.automation_changed_at;
      NEW.automation_changed_by := OLD.automation_changed_by;
    END IF;
  END IF;

  IF changed THEN
    NEW.automation_changed_at := now();
    NEW.automation_changed_by := auth.uid();
    INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, details)
    VALUES (
      NEW.tenant_id,
      auth.uid(),
      'assistant.automation_changed',
      'tenant_bot_settings',
      NEW.tenant_id::text,
      jsonb_build_object(
        'enabled', NEW.enabled,
        'auto_enroll_new_chats', NEW.auto_enroll_new_chats,
        'was_enabled', CASE WHEN TG_OP = 'UPDATE' THEN OLD.enabled END,
        'was_auto_enroll_new_chats', CASE WHEN TG_OP = 'UPDATE' THEN OLD.auto_enroll_new_chats END
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.note_assistant_automation_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tenant_bot_settings_automation_audit ON public.tenant_bot_settings;
CREATE TRIGGER tenant_bot_settings_automation_audit
  BEFORE INSERT OR UPDATE ON public.tenant_bot_settings
  FOR EACH ROW EXECUTE FUNCTION public.note_assistant_automation_change();

COMMENT ON COLUMN public.tenant_bot_settings.auto_enroll_new_chats IS
  'When true (and enabled), a new conversation starts with the assistant answering. Off by default; a company admin opts in.';
COMMENT ON COLUMN public.tenant_bot_settings.automation_changed_at IS
  'When enabled or auto_enroll_new_chats last changed. Set by trigger, never by the writer.';
COMMENT ON COLUMN public.tenant_bot_settings.automation_changed_by IS
  'Who last changed enabled or auto_enroll_new_chats (auth.uid()); NULL for a server-side change. Set by trigger.';

COMMIT;

-- Verification (read-only).
-- Expect: both defaults 'false'; the trigger present; and for every workspace
-- that is on, auto_enroll_new_chats = true right after the first run.
SELECT table_name, column_name, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND ((table_name = 'tenant_bot_settings' AND column_name IN ('enabled', 'auto_enroll_new_chats'))
     OR (table_name = 'conversations' AND column_name = 'bot_enabled'))
 ORDER BY 1, 2;
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'public.tenant_bot_settings'::regclass AND tgname = 'tenant_bot_settings_automation_audit';
SELECT enabled, auto_enroll_new_chats, count(*) AS workspaces
  FROM public.tenant_bot_settings GROUP BY 1, 2 ORDER BY 1, 2;
