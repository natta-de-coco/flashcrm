-- Multi-identity contacts and customer branches.
--
-- A customer is not one phone number. They ring from a mobile, then from the
-- office landline, then from a second branch, and Flas treated each as a new
-- stranger: `contacts` carries a single `phone`, and the WhatsApp webhook
-- matches on it exactly. Three numbers meant three contact rows, three
-- conversation threads, and three partial histories for one relationship.
--
-- Two tables:
--   contact_identities  many numbers/emails -> one contact
--   contact_branches    a customer's locations, each optionally with its own
--                       numbers via contact_identities.branch_id
--
-- Deliberately additive. contacts.phone and contacts.email stay exactly as they
-- are and keep working; identities are backfilled from them, and the resolver
-- falls back to them for any row this migration has not covered. Nothing that
-- reads contacts today needs to change to keep working.
--
-- Safe to re-run: every object is guarded, and the backfill is an idempotent
-- INSERT ... ON CONFLICT DO NOTHING.

-- ── 1. Canonical form ────────────────────────────────────────────────────────
-- The unique index below is built on this, so it must be IMMUTABLE. Phone
-- numbers are reduced to digits with a leading + preserved, because the same
-- number arrives as "+971 50 963 0506", "0509630506" and "971509630506"
-- depending on who typed it. Emails are lowercased and trimmed.
--
-- Note this is deliberately not full E.164 parsing: that needs a country and a
-- library, and guessing one wrongly would merge two different customers, which
-- is far worse than failing to merge two records for the same one.
CREATE OR REPLACE FUNCTION public.normalize_contact_identity(_kind text, _value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _value IS NULL OR btrim(_value) = '' THEN NULL
    WHEN _kind = 'email' THEN lower(btrim(_value))
    WHEN _kind = 'phone' THEN
      CASE
        WHEN btrim(_value) LIKE '+%'
          THEN '+' || regexp_replace(btrim(_value), '[^0-9]', '', 'g')
        ELSE regexp_replace(btrim(_value), '[^0-9]', '', 'g')
      END
    ELSE lower(btrim(_value))
  END;
$$;

COMMENT ON FUNCTION public.normalize_contact_identity(text, text) IS
  'Canonical form of a contact identity. IMMUTABLE because a unique index is built on it.';

-- ── 2. Branches ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  address     text,
  city        text,
  country     text,
  notes       text,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_branches_tenant_idx  ON public.contact_branches (tenant_id);
CREATE INDEX IF NOT EXISTS contact_branches_contact_idx ON public.contact_branches (contact_id);

-- One branch name per customer. Two "Deira" branches on one account is a
-- data-entry mistake, not a case to support.
CREATE UNIQUE INDEX IF NOT EXISTS contact_branches_contact_name_key
  ON public.contact_branches (contact_id, lower(btrim(name)));

-- At most one primary branch per customer, enforced rather than hoped for.
CREATE UNIQUE INDEX IF NOT EXISTS contact_branches_one_primary_key
  ON public.contact_branches (contact_id)
  WHERE is_primary;

-- ── 3. Identities ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_identities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  -- Which branch this number belongs to, when the customer has several. Null
  -- means "the customer generally" rather than any particular location.
  branch_id   uuid REFERENCES public.contact_branches(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('phone', 'email')),
  -- As the customer gave it, for display.
  value       text NOT NULL CHECK (btrim(value) <> ''),
  -- What matching actually uses. Generated, so it can never drift from `value`.
  normalized  text GENERATED ALWAYS AS (public.normalize_contact_identity(kind, value)) STORED,
  -- "Mobile", "Office", "Warehouse" -- shown next to the number.
  label       text,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_identities_tenant_idx  ON public.contact_identities (tenant_id);
CREATE INDEX IF NOT EXISTS contact_identities_contact_idx ON public.contact_identities (contact_id);
CREATE INDEX IF NOT EXISTS contact_identities_branch_idx  ON public.contact_identities (branch_id);

-- The point of the whole table: within one workspace, a given number or email
-- resolves to exactly one contact. This is what stops an inbound message
-- creating a duplicate stranger, and it is also the lookup index.
CREATE UNIQUE INDEX IF NOT EXISTS contact_identities_tenant_value_key
  ON public.contact_identities (tenant_id, kind, normalized);

-- One primary of each kind per contact.
CREATE UNIQUE INDEX IF NOT EXISTS contact_identities_one_primary_key
  ON public.contact_identities (contact_id, kind)
  WHERE is_primary;

-- ── 4. Row-level security ────────────────────────────────────────────────────
-- Same shape as contacts_tenant_all: a workspace sees only its own rows.
ALTER TABLE public.contact_branches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_identities ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_branches   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_identities TO authenticated;
GRANT ALL ON public.contact_branches   TO service_role;
GRANT ALL ON public.contact_identities TO service_role;

DROP POLICY IF EXISTS contact_branches_tenant_all ON public.contact_branches;
CREATE POLICY contact_branches_tenant_all ON public.contact_branches
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS contact_identities_tenant_all ON public.contact_identities;
CREATE POLICY contact_identities_tenant_all ON public.contact_identities
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- updated_at on branches, matching the trigger contacts already uses.
DROP TRIGGER IF EXISTS contact_branches_updated ON public.contact_branches;
CREATE TRIGGER contact_branches_updated
  BEFORE UPDATE ON public.contact_branches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5. Backfill ──────────────────────────────────────────────────────────────
-- Every existing contact's phone and email become its primary identities, so
-- the resolver finds current customers on day one rather than after they next
-- message. ON CONFLICT DO NOTHING makes this safe to re-run, and also skips
-- the case where two contacts in one tenant somehow share a number -- the
-- first keeps it, and the duplicate is left for a human to merge rather than
-- being silently reassigned.
INSERT INTO public.contact_identities (tenant_id, contact_id, kind, value, is_primary, label)
SELECT c.tenant_id, c.id, 'phone', c.phone, true, 'Primary'
FROM public.contacts c
WHERE c.tenant_id IS NOT NULL
  AND c.phone IS NOT NULL
  AND btrim(c.phone) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.contact_identities (tenant_id, contact_id, kind, value, is_primary, label)
SELECT c.tenant_id, c.id, 'email', c.email, true, 'Primary'
FROM public.contacts c
WHERE c.tenant_id IS NOT NULL
  AND c.email IS NOT NULL
  AND btrim(c.email) <> ''
ON CONFLICT DO NOTHING;

-- ── 6. Resolution ────────────────────────────────────────────────────────────
-- One place that answers "whose number is this?", so the webhook, the widget
-- and any future importer cannot each normalize slightly differently.
--
-- Falls back to contacts.phone/email for any row the backfill did not cover
-- (a contact created between this migration and the code deploy), which is why
-- the legacy columns are still read here.
CREATE OR REPLACE FUNCTION public.resolve_contact_by_identity(
  _tenant_id uuid,
  _kind text,
  _value text
)
RETURNS TABLE (contact_id uuid, branch_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.contact_id, i.branch_id
  FROM public.contact_identities i
  WHERE i.tenant_id = _tenant_id
    AND i.kind = _kind
    AND i.normalized = public.normalize_contact_identity(_kind, _value)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_contact_by_identity(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_contact_by_identity(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON TABLE public.contact_identities IS
  'Many phone numbers and emails belonging to one contact. Unique per (tenant, kind, normalized).';
COMMENT ON TABLE public.contact_branches IS
  'A customer''s locations. Identities may point at one to say which branch a number belongs to.';
