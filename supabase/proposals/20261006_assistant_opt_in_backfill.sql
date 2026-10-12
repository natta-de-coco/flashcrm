-- ═════════════════════════════════════════════════════════════════════════════
-- PROPOSAL — not a migration. Nothing here runs by itself, and nothing in
-- part B should be run without the owner's decision.
--
-- The opt-in migration (20261006160000_assistant_explicit_opt_in.sql) switched
-- no workspace off. Some workspaces have the assistant ON only because ON was
-- the column default, or because they were seeded from the old platform-wide
-- settings: nobody at that company chose it. This file finds them, and offers
-- the statement that would switch them off.
--
-- Run part A (read-only) in the Lovable SQL editor and read the result first.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── A. Inventory (read-only) ────────────────────────────────────────────────
-- One row per workspace whose assistant is on.
--   never_edited      the instructions are still the text the table was
--                     created with -- no one at the company wrote them
--   bot_replies       how many messages the assistant has actually sent
--   last_bot_reply    when it last did
--   changed_by        NULL = no one has touched the switches since opt-in
--                     became required
--   classification
--     'chosen'        someone changed the switches, or wrote their own
--                     instructions: an explicit choice. Leave alone.
--     'in use'        never edited, but the assistant has been answering this
--                     company's customers. Switching it off changes what their
--                     customers see: ask the company, do not decide for them.
--     'default only'  never edited and has never answered anyone. ON here is
--                     only the old default. Safe to switch off.
WITH seeded AS (
  SELECT 'You are a helpful WhatsApp support assistant. Be concise, friendly and professional. Answer in the customer''s language.'::text AS instructions
), usage AS (
  SELECT tenant_id, count(*) AS bot_replies, max(created_at) AS last_bot_reply
    FROM public.messages
   WHERE sender = 'bot' AND direction = 'outbound'
   GROUP BY tenant_id
)
SELECT o.id AS tenant_id,
       o.name AS workspace,
       s.enabled,
       s.auto_enroll_new_chats,
       (s.instructions = seeded.instructions) AS never_edited,
       coalesce(u.bot_replies, 0) AS bot_replies,
       u.last_bot_reply,
       s.automation_changed_by AS changed_by,
       s.updated_at,
       CASE
         WHEN s.automation_changed_by IS NOT NULL OR s.instructions <> seeded.instructions THEN 'chosen'
         WHEN coalesce(u.bot_replies, 0) > 0 THEN 'in use'
         ELSE 'default only'
       END AS classification
  FROM public.tenant_bot_settings s
  JOIN public.organizations o ON o.id = s.tenant_id
  CROSS JOIN seeded
  LEFT JOIN usage u ON u.tenant_id = s.tenant_id
 WHERE s.enabled
 ORDER BY classification, workspace;

-- ── B. Proposed change — DO NOT RUN without the owner's decision ────────────
-- Switches off only the 'default only' workspaces: on by default, never
-- edited, never used. The trigger records each change in audit_log with a
-- NULL actor (a server-side change). 'in use' and 'chosen' are not touched.
--
-- BEGIN;
-- WITH seeded AS (
--   SELECT 'You are a helpful WhatsApp support assistant. Be concise, friendly and professional. Answer in the customer''s language.'::text AS instructions
-- )
-- UPDATE public.tenant_bot_settings s
--    SET enabled = false, auto_enroll_new_chats = false
--   FROM seeded
--  WHERE s.enabled
--    AND s.automation_changed_by IS NULL
--    AND s.instructions = seeded.instructions
--    AND NOT EXISTS (
--      SELECT 1 FROM public.messages m
--       WHERE m.tenant_id = s.tenant_id AND m.sender = 'bot' AND m.direction = 'outbound'
--    );
-- -- Check the count against part A's 'default only' rows before committing.
-- COMMIT;

-- ── C. Existing conversations (read-only) ───────────────────────────────────
-- Conversations are not changed by the migration. This shows how many still
-- have the assistant switched on per workspace, for the same decision.
SELECT c.tenant_id, o.name AS workspace,
       count(*) FILTER (WHERE c.bot_enabled) AS conversations_with_assistant_on,
       count(*) AS conversations
  FROM public.conversations c
  JOIN public.organizations o ON o.id = c.tenant_id
 GROUP BY 1, 2
 ORDER BY 3 DESC;
