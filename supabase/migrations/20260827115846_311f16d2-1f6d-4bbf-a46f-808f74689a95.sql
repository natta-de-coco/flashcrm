REVOKE EXECUTE ON FUNCTION public.next_document_number(uuid, text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_document_number(uuid, text) TO service_role;