-- ═════════════════════════════════════════════════════════════════════════════
-- PROPOSAL — not a migration. Everything that runs here only reads.
--
-- The phone-number migration (20260925120000_phone_identity_one_canonical_form.sql)
-- changed how a phone number is written to its matching key ("+971…" and
-- "971…" are now the same key). It then rebuilt the rule that one number
-- belongs to one contact in a workspace -- the unique index
-- contact_identities_tenant_value_key -- but only if no two rows now shared a
-- key. If even one workspace had such a pair, it printed a warning and left
-- the index out.
--
-- That warning was easy to miss, and we cannot see the live database from
-- here. So nobody knows whether the index is there. Without it, every inbound
-- message can add another identity row for a number that is already known, and
-- one number can end up claimed by two contacts.
--
-- Run parts A, B and C in the Lovable SQL editor and read the three results.
-- Nothing in this file changes data. Part D is a comment: do not run it until
-- A says the index is missing and B returns no rows.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── A. Is the rule in place? (read-only) ────────────────────────────────────
-- One row per unique index on contact_identities, whatever it is called.
-- The rule exists when a row is unique AND valid AND its definition covers
-- (tenant_id, kind, normalized). No rows, or none of that shape, means it is
-- missing.
SELECT c.relname AS index_name,
       ix.indisunique AS is_unique,
       ix.indisvalid AS is_valid,
       pg_get_indexdef(ix.indexrelid) AS definition,
       (c.relname = 'contact_identities_tenant_value_key') AS is_the_expected_name
  FROM pg_index ix
  JOIN pg_class c ON c.oid = ix.indexrelid
 WHERE ix.indrelid = 'public.contact_identities'::regclass
   AND ix.indisunique
 ORDER BY c.relname;

-- ── B. Which numbers are held more than once? (read-only) ───────────────────
-- One row per (workspace, kind, matching key) that more than one identity row
-- holds. This is the same test the migration used, so an empty result means
-- the index can be built now.
--   contacts      1 = the same contact holds the number twice, written two
--                     ways (for instance "+971…" and "971…"). Harmless to the
--                     customer; one of the two rows has to go.
--                 2+ = different contacts claim one number. That is one
--                     customer split in two, or a number mistakenly given to
--                     the wrong person. A person has to decide which.
--   contact_ids / written_as   oldest row first (the one that resolves today)
SELECT i.tenant_id,
       o.name AS workspace,
       i.kind,
       i.normalized,
       count(*) AS identity_rows,
       count(DISTINCT i.contact_id) AS contacts,
       array_agg(i.contact_id ORDER BY i.created_at, i.id) AS contact_ids,
       array_agg(i.value ORDER BY i.created_at, i.id) AS written_as,
       min(i.created_at) AS oldest_row,
       max(i.created_at) AS newest_row
  FROM public.contact_identities i
  LEFT JOIN public.organizations o ON o.id = i.tenant_id
 WHERE i.normalized IS NOT NULL
 GROUP BY i.tenant_id, o.name, i.kind, i.normalized
HAVING count(*) > 1
 ORDER BY workspace NULLS LAST, i.kind, i.normalized;

-- ── C. The rows themselves, with what hangs off each contact (read-only) ────
-- Lets the person deciding see which record is the live one: the contact with
-- the conversations and messages is the one to keep.
WITH repeated AS (
  SELECT tenant_id, kind, normalized
    FROM public.contact_identities
   WHERE normalized IS NOT NULL
   GROUP BY tenant_id, kind, normalized
  HAVING count(*) > 1
)
SELECT i.tenant_id,
       i.kind,
       i.normalized,
       i.id AS identity_id,
       i.value AS written_as,
       i.is_primary,
       i.label,
       i.created_at AS identity_created_at,
       c.id AS contact_id,
       c.name AS contact_name,
       c.consent_given,
       (SELECT count(*) FROM public.conversations v WHERE v.contact_id = c.id) AS conversations,
       (SELECT count(*)
          FROM public.messages m
          JOIN public.conversations v ON v.id = m.conversation_id
         WHERE v.contact_id = c.id) AS messages
  FROM repeated r
  JOIN public.contact_identities i
    ON i.tenant_id = r.tenant_id AND i.kind = r.kind AND i.normalized = r.normalized
  LEFT JOIN public.contacts c ON c.id = i.contact_id
 ORDER BY i.tenant_id, i.kind, i.normalized, i.created_at, i.id;

-- ── D. Proposed change — DO NOT RUN until A shows the rule missing and B ────
-- ── returns no rows. ────────────────────────────────────────────────────────
-- This is the statement the migration would have run. It cannot succeed while
-- B still lists anything, and it must never be run to "make the error go
-- away" by deleting rows: which row to keep is a decision about a customer.
--
-- CREATE UNIQUE INDEX IF NOT EXISTS contact_identities_tenant_value_key
--   ON public.contact_identities (tenant_id, kind, normalized);
--
-- Afterwards, A should show the index as unique and valid, and B and C should
-- return nothing.
