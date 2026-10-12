CREATE OR REPLACE FUNCTION public.next_document_number(_tenant_id uuid, _doc_type text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg jsonb;
  prefix text;
  padding int;
  include_year boolean;
  reset_annually boolean;
  start_at int;
  v_period text;
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
  v_period := CASE WHEN reset_annually THEN to_char(now(), 'YYYY') ELSE 'all' END;

  INSERT INTO public.document_sequences (tenant_id, doc_type, period, last_number)
  VALUES (_tenant_id, _doc_type, v_period, GREATEST(start_at, 1))
  ON CONFLICT (tenant_id, doc_type, period)
  DO UPDATE SET last_number = public.document_sequences.last_number + 1
  RETURNING last_number INTO n;

  RETURN prefix
    || CASE WHEN include_year THEN '-' || to_char(now(), 'YYYY') ELSE '' END
    || '-' || lpad(n::text, padding, '0');
END;
$function$;