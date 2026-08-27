-- =========================================================
-- Flash CRM billing foundation
-- =========================================================

CREATE TYPE public.sales_doc_kind AS ENUM ('quotation','invoice','credit_note','proforma');
CREATE TYPE public.sales_doc_status AS ENUM (
  'draft','pending_approval','sent','viewed','partially_paid','paid',
  'overdue','cancelled','refunded','accepted','rejected','expired','converted'
);
CREATE TYPE public.payment_method AS ENUM ('cash','bank_transfer','credit_card','cheque','online','other');

-- ---------- settings ----------
CREATE TABLE public.billing_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_name text,
  trade_name text,
  address text,
  country text,
  phone text,
  email text,
  website text,
  vat_number text,
  registration_number text,
  logo_url text,
  signatory_name text,
  signatory_position text,
  signature_url text,
  stamp_url text,
  default_currency text NOT NULL DEFAULT 'AED',
  timezone text NOT NULL DEFAULT 'Asia/Dubai',
  tax_enabled boolean NOT NULL DEFAULT true,
  tax_label text NOT NULL DEFAULT 'VAT',
  default_tax_rate numeric(6,3) NOT NULL DEFAULT 5,
  tax_inclusive boolean NOT NULL DEFAULT false,
  numbering jsonb NOT NULL DEFAULT '{
    "invoice":{"prefix":"INV","padding":6,"include_year":true,"start":1,"reset_annually":true},
    "quotation":{"prefix":"QUO","padding":5,"include_year":true,"start":1,"reset_annually":true},
    "credit_note":{"prefix":"CN","padding":5,"include_year":true,"start":1,"reset_annually":true},
    "proforma":{"prefix":"PI","padding":5,"include_year":true,"start":1,"reset_annually":true},
    "receipt":{"prefix":"REC","padding":5,"include_year":true,"start":1,"reset_annually":true}
  }'::jsonb,
  watermark_enabled boolean NOT NULL DEFAULT true,
  watermark_opacity numeric(4,3) NOT NULL DEFAULT 0.06,
  watermark_scale numeric(4,2) NOT NULL DEFAULT 0.55,
  pdf_security jsonb NOT NULL DEFAULT '{"allow_printing":true,"allow_copying":true,"allow_modification":false,"allow_annotations":false}'::jsonb,
  default_terms text,
  default_notes text,
  default_payment_terms text DEFAULT 'Net 30',
  show_qr_verification boolean NOT NULL DEFAULT true,
  show_flash_branding boolean NOT NULL DEFAULT true,
  approval_mode text NOT NULL DEFAULT 'none',
  discount_approval_threshold numeric(6,3) NOT NULL DEFAULT 10,
  custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  reminder_rules jsonb NOT NULL DEFAULT '[{"days":-3},{"days":0},{"days":3},{"days":7},{"days":15}]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_settings TO authenticated;
GRANT ALL ON public.billing_settings TO service_role;
ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing_settings tenant" ON public.billing_settings FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE TRIGGER billing_settings_updated BEFORE UPDATE ON public.billing_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  bank_name text NOT NULL,
  account_name text,
  account_number text,
  iban text,
  swift text,
  branch text,
  currency text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO authenticated;
GRANT ALL ON public.bank_accounts TO service_role;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_accounts tenant" ON public.bank_accounts FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE TRIGGER bank_accounts_updated BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  rate numeric(6,3) NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_rates TO authenticated;
GRANT ALL ON public.tax_rates TO service_role;
ALTER TABLE public.tax_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tax_rates tenant" ON public.tax_rates FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TABLE public.invoice_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  style text NOT NULL DEFAULT 'modern',
  primary_color text NOT NULL DEFAULT '#0F5132',
  secondary_color text NOT NULL DEFAULT '#111827',
  accent_color text NOT NULL DEFAULT '#16A34A',
  font_family text NOT NULL DEFAULT 'helvetica',
  logo_scale numeric(4,2) NOT NULL DEFAULT 1,
  logo_position text NOT NULL DEFAULT 'left',
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  section_order jsonb NOT NULL DEFAULT '["company","customer","details","items","totals","bank","terms","signature","footer"]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_templates TO authenticated;
GRANT ALL ON public.invoice_templates TO service_role;
ALTER TABLE public.invoice_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_templates tenant" ON public.invoice_templates FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE TRIGGER invoice_templates_updated BEFORE UPDATE ON public.invoice_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- numbering ----------
CREATE TABLE public.document_sequences (
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  period text NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, doc_type, period)
);
GRANT SELECT ON public.document_sequences TO authenticated;
GRANT ALL ON public.document_sequences TO service_role;
ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "document_sequences read" ON public.document_sequences FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

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
  period text;
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
  period := CASE WHEN reset_annually THEN to_char(now(), 'YYYY') ELSE 'all' END;

  INSERT INTO public.document_sequences (tenant_id, doc_type, period, last_number)
  VALUES (_tenant_id, _doc_type, period, GREATEST(start_at, 1))
  ON CONFLICT (tenant_id, doc_type, period)
  DO UPDATE SET last_number = public.document_sequences.last_number + 1
  RETURNING last_number INTO n;

  RETURN prefix
    || CASE WHEN include_year THEN '-' || to_char(now(), 'YYYY') ELSE '' END
    || '-' || lpad(n::text, padding, '0');
END;
$$;

-- ---------- documents ----------
CREATE TABLE public.sales_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind public.sales_doc_kind NOT NULL,
  doc_number text NOT NULL,
  status public.sales_doc_status NOT NULL DEFAULT 'draft',
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  quotation_id uuid REFERENCES public.sales_documents(id) ON DELETE SET NULL,
  original_invoice_id uuid REFERENCES public.sales_documents(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.invoice_templates(id) ON DELETE SET NULL,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  salesperson_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  issue_date date NOT NULL DEFAULT (now()::date),
  due_date date,
  valid_until date,
  currency text NOT NULL DEFAULT 'AED',
  payment_terms text,
  reference text,
  po_number text,
  tax_inclusive boolean NOT NULL DEFAULT false,
  tax_label text NOT NULL DEFAULT 'VAT',
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  item_discount_total numeric(14,2) NOT NULL DEFAULT 0,
  invoice_discount numeric(14,2) NOT NULL DEFAULT 0,
  taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_total numeric(14,2) NOT NULL DEFAULT 0,
  shipping numeric(14,2) NOT NULL DEFAULT 0,
  additional_charges numeric(14,2) NOT NULL DEFAULT 0,
  adjustment numeric(14,2) NOT NULL DEFAULT 0,
  grand_total numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  balance numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  terms text,
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  company_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_id text,
  verification_token text,
  share_token text,
  pdf_hash text,
  version integer NOT NULL DEFAULT 1,
  reminders_paused boolean NOT NULL DEFAULT false,
  last_sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  acceptance jsonb,
  cancelled_at timestamptz,
  cancel_reason text,
  finalized_at timestamptz,
  finalized_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, doc_number)
);
CREATE INDEX sales_documents_tenant_kind_idx ON public.sales_documents (tenant_id, kind, issue_date DESC);
CREATE INDEX sales_documents_status_idx ON public.sales_documents (tenant_id, status);
CREATE INDEX sales_documents_contact_idx ON public.sales_documents (contact_id);
CREATE UNIQUE INDEX sales_documents_share_token_idx ON public.sales_documents (share_token) WHERE share_token IS NOT NULL;
CREATE UNIQUE INDEX sales_documents_verify_token_idx ON public.sales_documents (verification_token) WHERE verification_token IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_documents TO authenticated;
GRANT ALL ON public.sales_documents TO service_role;
ALTER TABLE public.sales_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_documents read" ON public.sales_documents FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "sales_documents insert" ON public.sales_documents FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "sales_documents update drafts" ON public.sales_documents FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "sales_documents delete drafts" ON public.sales_documents FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND finalized_at IS NULL);
CREATE TRIGGER sales_documents_updated BEFORE UPDATE ON public.sales_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Protect finalized financial values from client-side edits.
CREATE OR REPLACE FUNCTION public.guard_finalized_document()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.finalized_at IS NOT NULL AND current_setting('role', true) <> 'service_role' THEN
    IF NEW.doc_number IS DISTINCT FROM OLD.doc_number
      OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
      OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
      OR NEW.tax_total IS DISTINCT FROM OLD.tax_total
      OR NEW.invoice_discount IS DISTINCT FROM OLD.invoice_discount
      OR NEW.grand_total IS DISTINCT FROM OLD.grand_total
      OR NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot
      OR NEW.company_snapshot IS DISTINCT FROM OLD.company_snapshot THEN
      RAISE EXCEPTION 'Finalized documents cannot be modified. Create a revision, credit note or cancellation.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sales_documents_guard BEFORE UPDATE ON public.sales_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_finalized_document();

CREATE TABLE public.sales_document_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.sales_documents(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  name_snapshot text NOT NULL,
  sku_snapshot text,
  description_snapshot text,
  image_snapshot text,
  quantity numeric(14,3) NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'pcs',
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  discount_value numeric(14,2) NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'percent',
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate numeric(6,3) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  line_total numeric(14,2) NOT NULL DEFAULT 0,
  serial_number text,
  warranty text,
  service_period text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_document_items_doc_idx ON public.sales_document_items (document_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_document_items TO authenticated;
GRANT ALL ON public.sales_document_items TO service_role;
ALTER TABLE public.sales_document_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_document_items tenant" ON public.sales_document_items FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TABLE public.document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.sales_documents(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  pdf_hash text,
  finalized_at timestamptz,
  finalized_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);
GRANT SELECT, INSERT ON public.document_versions TO authenticated;
GRANT ALL ON public.document_versions TO service_role;
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "document_versions read" ON public.document_versions FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "document_versions insert" ON public.document_versions FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TABLE public.document_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.sales_documents(id) ON DELETE CASCADE,
  payment_id uuid,
  kind text NOT NULL DEFAULT 'invoice_pdf',
  storage_path text NOT NULL,
  file_hash text,
  version integer NOT NULL DEFAULT 1,
  byte_size integer,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.document_files TO authenticated;
GRANT ALL ON public.document_files TO service_role;
ALTER TABLE public.document_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "document_files read" ON public.document_files FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "document_files insert" ON public.document_files FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ---------- payments ----------
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  receipt_number text,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'AED',
  paid_at date NOT NULL DEFAULT (now()::date),
  method public.payment_method NOT NULL DEFAULT 'bank_transfer',
  reference text,
  bank text,
  notes text,
  attachment_url text,
  credit_amount numeric(14,2) NOT NULL DEFAULT 0,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receipt_number)
);
CREATE INDEX payments_tenant_idx ON public.payments (tenant_id, paid_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments tenant" ON public.payments FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TABLE public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.sales_documents(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_allocations_doc_idx ON public.payment_allocations (document_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_allocations TO authenticated;
GRANT ALL ON public.payment_allocations TO service_role;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_allocations tenant" ON public.payment_allocations FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

-- ---------- activity timeline ----------
CREATE TABLE public.document_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.sales_documents(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  event text NOT NULL,
  actor_id uuid,
  actor_label text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_activity_doc_idx ON public.document_activity (document_id, created_at DESC);
GRANT SELECT, INSERT ON public.document_activity TO authenticated;
GRANT ALL ON public.document_activity TO service_role;
ALTER TABLE public.document_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "document_activity read" ON public.document_activity FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "document_activity insert" ON public.document_activity FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());