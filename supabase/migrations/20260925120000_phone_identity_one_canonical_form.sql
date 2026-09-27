-- One canonical form for a phone number.
--
-- normalize_contact_identity kept a leading "+" when the value had one and
-- dropped it when it did not:
--
--   '+971501234567'  ->  '+971501234567'
--   '971501234567'   ->  '971501234567'     -- the same human, a different key
--
-- WhatsApp sends the sender as bare digits ('971501234567'), while a contact
-- added by hand or imported is stored in E.164 with the plus. So the number a
-- customer messages from never resolved to the contact the team had already
-- created: every conversation started a second contact, and the history, the
-- recorded consent and the routing rule sat on the record the other half of the
-- product was not reading.
--
-- Safe to run more than once. It reports collisions instead of failing, so a
-- workspace that already has the same number on two contacts is listed for a
-- human decision rather than losing one silently.
BEGIN;

-- ── 1. The canonical form is the digits ─────────────────────────────────────
-- A leading "00" is the international access code written out, so it is the
-- same number as the one with a "+". A single leading "0" is a national trunk
-- prefix and cannot be resolved without knowing the country, so it is left
-- alone: the contact form already requires E.164.
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
      regexp_replace(
        regexp_replace(btrim(_value), '[^0-9]', '', 'g'),
        '^00', '', ''
      )
    ELSE lower(btrim(_value))
  END;
$$;

COMMENT ON FUNCTION public.normalize_contact_identity(text, text) IS
  'Canonical form of a contact identity: digits only for a phone (no +, no 00 prefix), lowercased for an email. IMMUTABLE because a unique index is built on it.';

-- ── 2. Recompute the stored column ──────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION does not recompute values already stored, so the
-- generated column is dropped and re-added. Dropping it drops the unique index
-- built on it; that index is rebuilt in step 4, once we know it can be.
ALTER TABLE public.contact_identities DROP COLUMN IF EXISTS normalized;

ALTER TABLE public.contact_identities
  ADD COLUMN normalized text
  GENERATED ALWAYS AS (public.normalize_contact_identity(kind, value)) STORED;

COMMENT ON COLUMN public.contact_identities.normalized IS
  'What matching actually uses. Generated, so it can never drift from `value`.';

-- ── 3. Resolution is deterministic ──────────────────────────────────────────
-- While any workspace still has the same number on two contacts, the oldest
-- identity wins every time rather than whichever row the planner reached first.
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
  ORDER BY i.created_at, i.id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_contact_by_identity(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_contact_by_identity(uuid, text, text)
  TO authenticated, service_role;

-- ── 4. Rebuild the uniqueness guarantee, or say why it cannot be rebuilt ────
DO $$
DECLARE
  _collisions integer;
BEGIN
  SELECT count(*) INTO _collisions FROM (
    SELECT tenant_id, kind, normalized
    FROM public.contact_identities
    WHERE normalized IS NOT NULL
    GROUP BY 1, 2, 3
    HAVING count(*) > 1
  ) d;

  IF _collisions > 0 THEN
    RAISE WARNING
      'phone identity migration: % identity group(s) now resolve to the same number on more than one row; unique index NOT created. List them with: SELECT tenant_id, kind, normalized, array_agg(contact_id) AS contacts, array_agg(value) AS forms FROM public.contact_identities WHERE normalized IS NOT NULL GROUP BY 1,2,3 HAVING count(*) > 1;',
      _collisions;
    RETURN;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS contact_identities_tenant_value_key
    ON public.contact_identities (tenant_id, kind, normalized);
END $$;

COMMIT;

-- ── Verification (run after the commit) ─────────────────────────────────────
-- Both forms must now produce the same key:
--   SELECT public.normalize_contact_identity('phone', '+971 50 123 4567') AS plus,
--          public.normalize_contact_identity('phone', '971501234567')     AS bare,
--          public.normalize_contact_identity('phone', '00971501234567')   AS zero_zero;
--   -- expected: 971501234567 for all three
--
-- Was the uniqueness guarantee rebuilt?
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname = 'public' AND indexname = 'contact_identities_tenant_value_key';
--   -- no row means the WARNING above fired: merge the listed contacts, then run
--   -- CREATE UNIQUE INDEX contact_identities_tenant_value_key
--   --   ON public.contact_identities (tenant_id, kind, normalized);
--
-- Which customers were split in two by the old normalization?
--   SELECT c.tenant_id, i.normalized, array_agg(DISTINCT c.id) AS contacts,
--          array_agg(DISTINCT c.name) AS names
--   FROM public.contact_identities i
--   JOIN public.contacts c ON c.id = i.contact_id
--   WHERE i.kind = 'phone'
--   GROUP BY 1, 2
--   HAVING count(DISTINCT c.id) > 1;
