-- No quotation or invoice can be saved: "column reference \"period\" is ambiguous".
--
-- next_document_number declares a plpgsql variable named `period`, and
-- document_sequences has a column named `period`. In the ON CONFLICT target --
--
--     ON CONFLICT (tenant_id, doc_type, period)
--
-- -- plpgsql substitutes its own variables, so `period` there resolves to both
-- the variable and the column and Postgres refuses the whole statement. Every
-- call fails, which means every Save draft and every Finalise & number fails,
-- and the raw database message is what the user sees.
--
-- The fix is the variable's name. Nothing else about the function changes, so
-- existing numbers and sequences are untouched.
--
-- Safe to run more than once.
CREATE OR REPLACE FUNCTION public.next_document_number(_tenant_id uuid, _doc_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg jsonb;
  prefix text;
  padding int;
  include_year boolean;
  reset_annually boolean;
  start_at int;
  _period text;   -- was `period`, which is also a column of document_sequences
  n int;
BEGIN
  SELECT numbering -> _doc_type INTO cfg FROM public.billing_settings WHERE tenant_id = _tenant_id;
  IF cfg IS NULL THEN
    cfg := jsonb_build_object('prefix', upper(left(_doc_type,3)), 'padding', 6, 'include_year', true, 'start', 1, 'reset_annually', true);
  END IF;
  prefix := COALESCE(cfg->>'prefix', upper(left(_doc_type,3)));
  padding := COALESCE((cfg->>'padding')::int, 6);
  include_year := COALESCE((cfg->>'include_year')::boolean, true);
  reset_annually := COALESCE((cfg->>'reset_annually')::boolean, true);
  start_at := COALESCE((cfg->>'start')::int, 1);
  _period := CASE WHEN reset_annually THEN to_char(now(), 'YYYY') ELSE 'all' END;

  INSERT INTO public.document_sequences (tenant_id, doc_type, period, last_number)
  VALUES (_tenant_id, _doc_type, _period, GREATEST(start_at, 1))
  ON CONFLICT (tenant_id, doc_type, period)
  DO UPDATE SET last_number = public.document_sequences.last_number + 1
  RETURNING last_number INTO n;

  RETURN prefix
    || CASE WHEN include_year THEN '-' || to_char(now(), 'YYYY') ELSE '' END
    || '-' || lpad(n::text, padding, '0');
END;
$$;

-- Known, deliberately NOT changed here: the year and the annual reset use
-- now() in UTC rather than the workspace timezone, so a Dubai invoice raised
-- just after midnight on 1 January carries the previous year. That is a
-- behaviour change at a year boundary and belongs in its own migration, not in
-- an emergency fix.

-- ── Verification (run after this) ───────────────────────────────────────────
-- Take any workspace id and ask for a number. It should return, not error:
--   SELECT public.next_document_number(
--     (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1), 'quotation');
--   -- expected: something like QUO-2026-000001
--
-- Then confirm the sequence advanced rather than duplicating:
--   SELECT tenant_id, doc_type, period, last_number FROM public.document_sequences ORDER BY 1,2,3;
