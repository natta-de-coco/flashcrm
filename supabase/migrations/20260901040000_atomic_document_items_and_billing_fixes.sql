-- Invoice line-item edits were a DELETE then a separate INSERT from the
-- client — a crash or dropped connection between the two calls could leave
-- an invoice with zero items. Wrap both in one atomic function.
BEGIN;

CREATE OR REPLACE FUNCTION public.replace_sales_document_items(
  _document_id uuid,
  _tenant_id uuid,
  _items jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- SECURITY DEFINER bypasses RLS, so this check IS the tenant boundary —
  -- never trust _tenant_id from the caller without it.
  IF _tenant_id <> public.current_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'You can only edit documents in your own workspace';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sales_documents d
     WHERE d.id = _document_id AND d.tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'Document not found for this tenant';
  END IF;

  DELETE FROM public.sales_document_items WHERE document_id = _document_id;

  INSERT INTO public.sales_document_items (
    tenant_id, document_id, product_id, position, name_snapshot, sku_snapshot,
    description_snapshot, image_snapshot, quantity, unit, unit_price,
    discount_value, discount_type, discount_amount, tax_rate, tax_amount,
    line_total, serial_number, warranty, service_period, notes
  )
  SELECT
    _tenant_id, _document_id, r.product_id, r.position, r.name_snapshot, r.sku_snapshot,
    r.description_snapshot, r.image_snapshot, r.quantity, r.unit, r.unit_price,
    r.discount_value, r.discount_type, r.discount_amount, r.tax_rate, r.tax_amount,
    r.line_total, r.serial_number, r.warranty, r.service_period, r.notes
  FROM jsonb_to_recordset(_items) AS r(
    product_id uuid, position integer, name_snapshot text, sku_snapshot text,
    description_snapshot text, image_snapshot text, quantity numeric, unit text,
    unit_price numeric, discount_value numeric, discount_type text, discount_amount numeric,
    tax_rate numeric, tax_amount numeric, line_total numeric, serial_number text,
    warranty text, service_period text, notes text
  );
END; $$;
REVOKE ALL ON FUNCTION public.replace_sales_document_items(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_sales_document_items(uuid, uuid, jsonb) TO authenticated, service_role;

COMMIT;
