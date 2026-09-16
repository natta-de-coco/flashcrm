GRANT EXECUTE ON FUNCTION public.list_subscribers() TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_contact_reachability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  normalized_phone text;
BEGIN
  NEW.email := NULLIF(lower(btrim(COALESCE(NEW.email, ''))), '');
  normalized_phone := NULLIF(regexp_replace(COALESCE(NEW.phone, ''), '[\s\-().]', '', 'g'), '');
  IF normalized_phone LIKE '00%' THEN
    normalized_phone := '+' || substr(normalized_phone, 3);
  END IF;
  -- WhatsApp and other channels deliver bare digits; add the plus rather than
  -- rejecting, or a first-time customer never reaches the inbox.
  IF normalized_phone IS NOT NULL
     AND normalized_phone NOT LIKE '+%'
     AND normalized_phone ~ '^[1-9][0-9]{7,14}$' THEN
    normalized_phone := '+' || normalized_phone;
  END IF;
  NEW.phone := normalized_phone;

  -- A website chat visitor is known by name only until they share a number or
  -- an address, so a name is also a valid way to identify a contact.
  IF NEW.phone IS NULL AND NEW.email IS NULL
     AND NULLIF(btrim(COALESCE(NEW.name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A contact needs at least a name, a phone or an email.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.phone IS NOT NULL AND NEW.phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'Phone number must use E.164 format, for example +971501234567.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.email IS NOT NULL AND NEW.email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Email address is not valid.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_reachability_guard ON public.contacts;
CREATE TRIGGER contacts_reachability_guard
BEFORE INSERT OR UPDATE OF phone, email ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.enforce_contact_reachability();