-- ═════════════════════════════════════════════════════════════════════════════
-- Index every foreign key that did not have one.
--
-- Found by auditing the schema this migration set produces (see
-- supabase/verify/audit-schema.mjs). Two problems, both invisible today and
-- both certain later:
--
-- 1. SEVENTEEN tables carry a tenant_id with no index behind it. Every RLS
--    policy in this database filters on tenant_id, so every read of those
--    tables is a sequential scan of the whole table. At five contacts nobody
--    notices. At fifty thousand, across a few dozen companies, the inbox and
--    the invoice list are the first things to crawl -- and the cause looks
--    like "the app is slow" rather than a missing index.
--
-- 2. Forty-nine foreign keys had no covering index. Postgres has to check
--    every child row when a parent is deleted, and forty-one tables cascade
--    from organizations. Deleting one company means a sequential scan of each.
--
-- Purely additive: CREATE INDEX IF NOT EXISTS changes no behaviour and no
-- data. Safe to run on a live database; on tables this size it is instant.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE INDEX IF NOT EXISTS ai_provider_keys_created_by_idx ON public.ai_provider_keys (created_by);
CREATE INDEX IF NOT EXISTS ai_provider_keys_tenant_id_idx ON public.ai_provider_keys (tenant_id);
CREATE INDEX IF NOT EXISTS ai_usage_log_user_id_idx ON public.ai_usage_log (user_id);
CREATE INDEX IF NOT EXISTS api_keys_tenant_id_idx ON public.api_keys (tenant_id);
CREATE INDEX IF NOT EXISTS bank_accounts_tenant_id_idx ON public.bank_accounts (tenant_id);
CREATE INDEX IF NOT EXISTS campaign_plans_created_by_idx ON public.campaign_plans (created_by);
CREATE INDEX IF NOT EXISTS connection_retry_log_account_id_idx ON public.connection_retry_log (account_id);
CREATE INDEX IF NOT EXISTS content_posts_author_id_idx ON public.content_posts (author_id);
CREATE INDEX IF NOT EXISTS deletion_requests_requested_by_idx ON public.deletion_requests (requested_by);
CREATE INDEX IF NOT EXISTS deletion_requests_tenant_id_idx ON public.deletion_requests (tenant_id);
CREATE INDEX IF NOT EXISTS document_activity_payment_id_idx ON public.document_activity (payment_id);
CREATE INDEX IF NOT EXISTS document_activity_tenant_id_idx ON public.document_activity (tenant_id);
CREATE INDEX IF NOT EXISTS document_files_document_id_idx ON public.document_files (document_id);
CREATE INDEX IF NOT EXISTS document_files_tenant_id_idx ON public.document_files (tenant_id);
CREATE INDEX IF NOT EXISTS document_versions_tenant_id_idx ON public.document_versions (tenant_id);
CREATE INDEX IF NOT EXISTS email_delivery_log_user_id_idx ON public.email_delivery_log (user_id);
CREATE INDEX IF NOT EXISTS invoice_templates_tenant_id_idx ON public.invoice_templates (tenant_id);
CREATE INDEX IF NOT EXISTS invoices_created_by_idx ON public.invoices (created_by);
CREATE INDEX IF NOT EXISTS invoices_tenant_id_idx ON public.invoices (tenant_id);
CREATE INDEX IF NOT EXISTS kpi_alerts_target_id_idx ON public.kpi_alerts (target_id);
CREATE INDEX IF NOT EXISTS lead_routing_rules_wa_number_id_idx ON public.lead_routing_rules (wa_number_id);
CREATE INDEX IF NOT EXISTS leads_assigned_to_idx ON public.leads (assigned_to);
CREATE INDEX IF NOT EXISTS leads_assigned_wa_number_id_idx ON public.leads (assigned_wa_number_id);
CREATE INDEX IF NOT EXISTS leads_contact_id_idx ON public.leads (contact_id);
CREATE INDEX IF NOT EXISTS leads_site_id_idx ON public.leads (site_id);
CREATE INDEX IF NOT EXISTS payment_allocations_payment_id_idx ON public.payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS payment_allocations_tenant_id_idx ON public.payment_allocations (tenant_id);
CREATE INDEX IF NOT EXISTS payments_contact_id_idx ON public.payments (contact_id);
CREATE INDEX IF NOT EXISTS profiles_tenant_id_idx ON public.profiles (tenant_id);
CREATE INDEX IF NOT EXISTS reminders_created_by_idx ON public.reminders (created_by);
CREATE INDEX IF NOT EXISTS sales_document_items_product_id_idx ON public.sales_document_items (product_id);
CREATE INDEX IF NOT EXISTS sales_document_items_tenant_id_idx ON public.sales_document_items (tenant_id);
CREATE INDEX IF NOT EXISTS sales_documents_bank_account_id_idx ON public.sales_documents (bank_account_id);
CREATE INDEX IF NOT EXISTS sales_documents_lead_id_idx ON public.sales_documents (lead_id);
CREATE INDEX IF NOT EXISTS sales_documents_original_invoice_id_idx ON public.sales_documents (original_invoice_id);
CREATE INDEX IF NOT EXISTS sales_documents_quotation_id_idx ON public.sales_documents (quotation_id);
CREATE INDEX IF NOT EXISTS sales_documents_salesperson_id_idx ON public.sales_documents (salesperson_id);
CREATE INDEX IF NOT EXISTS sales_documents_template_id_idx ON public.sales_documents (template_id);
CREATE INDEX IF NOT EXISTS seo_articles_author_id_idx ON public.seo_articles (author_id);
CREATE INDEX IF NOT EXISTS seo_articles_tenant_id_idx ON public.seo_articles (tenant_id);
CREATE INDEX IF NOT EXISTS seo_articles_wp_site_id_idx ON public.seo_articles (wp_site_id);
CREATE INDEX IF NOT EXISTS social_connection_tests_triggered_by_idx ON public.social_connection_tests (triggered_by);
CREATE INDEX IF NOT EXISTS social_test_results_tenant_id_idx ON public.social_test_results (tenant_id);
CREATE INDEX IF NOT EXISTS tax_rates_tenant_id_idx ON public.tax_rates (tenant_id);
CREATE INDEX IF NOT EXISTS team_invites_invited_by_idx ON public.team_invites (invited_by);
CREATE INDEX IF NOT EXISTS team_invites_tenant_id_idx ON public.team_invites (tenant_id);
CREATE INDEX IF NOT EXISTS tenant_smtp_config_created_by_idx ON public.tenant_smtp_config (created_by);
CREATE INDEX IF NOT EXISTS wa_templates_wa_number_id_idx ON public.wa_templates (wa_number_id);
CREATE INDEX IF NOT EXISTS wordpress_sites_tenant_id_idx ON public.wordpress_sites (tenant_id);

-- These four carry a tenant_id that is not declared as a foreign key, so the
-- FK sweep above misses them. They are the social tables -- the ones that grow
-- fastest once accounts are actually connected.
CREATE INDEX IF NOT EXISTS social_accounts_tenant_id_idx      ON public.social_accounts (tenant_id);
CREATE INDEX IF NOT EXISTS social_posts_tenant_id_idx         ON public.social_posts (tenant_id);
CREATE INDEX IF NOT EXISTS social_interactions_tenant_id_idx  ON public.social_interactions (tenant_id);
CREATE INDEX IF NOT EXISTS social_account_scans_tenant_id_idx ON public.social_account_scans (tenant_id);

COMMIT;

-- ─── Sanity check ───────────────────────────────────────────────────────────
-- Expect 0 -- no foreign key left without a covering index:
-- SELECT count(*) FROM pg_constraint con
--  WHERE con.contype='f' AND con.connamespace='public'::regnamespace
--    AND NOT EXISTS (SELECT 1 FROM pg_index i
--                     WHERE i.indrelid=con.conrelid AND i.indkey[0]=con.conkey[1]);
