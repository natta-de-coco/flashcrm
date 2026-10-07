-- ═════════════════════════════════════════════════════════════════════════════
-- Flas CRM — what happened to a message, kept on the message.
--
-- A message row has said only `status`. Why a send was refused, when it was
-- delivered or read, where the row came from and what kind of attachment an
-- inbound message carried were either shown once in a toast or not recorded
-- at all. These columns keep that evidence.
--
-- Every column is nullable and has no default: adding them rewrites nothing,
-- and an existing row keeps NULL, which is its honest value -- "recorded
-- before this was kept". The application writes them in a separate, optional
-- step, so it works the same before and after this is applied.
--
-- No grant or policy changes: the columns are covered by the table's existing
-- grants and by the tenant row-level-security policy on public.messages.
--
-- Safe to run more than once.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS failure_code integer,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS media jsonb;

-- Where a row came from. NOT VALID then VALIDATE, so the table is not held
-- under an exclusive lock while existing rows (all NULL) are checked.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_origin_known;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_origin_known
  CHECK (
    origin IS NULL
    OR origin IN ('inbox', 'template', 'document', 'assistant', 'webhook', 'widget', 'import', 'system')
  ) NOT VALID;
ALTER TABLE public.messages VALIDATE CONSTRAINT messages_origin_known;

COMMENT ON COLUMN public.messages.origin IS
  'Where the row came from: inbox (a person in FLAS), template, document (invoice/receipt), assistant, webhook (WhatsApp), widget (website chat), import, system. NULL = recorded before origins were kept.';
COMMENT ON COLUMN public.messages.failure_reason IS
  'Why the provider refused or failed the message, as a FLAS reason code (see src/lib/wa-delivery.ts).';
COMMENT ON COLUMN public.messages.failure_code IS
  'The provider''s own numeric error code, when it gave one.';
COMMENT ON COLUMN public.messages.sent_at IS 'When the provider accepted the message.';
COMMENT ON COLUMN public.messages.delivered_at IS 'When the provider reported it delivered.';
COMMENT ON COLUMN public.messages.read_at IS 'When the provider reported it read.';
COMMENT ON COLUMN public.messages.failed_at IS 'When the provider refused it or reported it failed.';
COMMENT ON COLUMN public.messages.media IS
  'Metadata of an attachment (kind, provider media id, mime type, file name, hash). Never the file or a URL.';

COMMIT;

-- Verification (read-only). Expect 8 rows, all nullable, and the constraint validated.
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'messages'
   AND column_name IN
       ('origin', 'failure_reason', 'failure_code', 'sent_at', 'delivered_at', 'read_at', 'failed_at', 'media')
 ORDER BY column_name;
SELECT conname, convalidated
  FROM pg_constraint
 WHERE conrelid = 'public.messages'::regclass
   AND conname = 'messages_origin_known';
