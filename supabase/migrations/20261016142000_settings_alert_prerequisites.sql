-- Narrow live prerequisite for Settings lead alerts. No drip/routing/SLA changes.
-- Create only missing alert storage and close browser writes in one transaction.
-- Existing rows are untouched. Stop on unexpected schema/policies; do not repair
-- customer rows or silently accept a differently shaped historical table.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_temp;

CREATE TABLE IF NOT EXISTS public.tenant_alert_settings (
  tenant_id uuid PRIMARY KEY,
  lead_alerts_enabled boolean NOT NULL DEFAULT true,
  alert_email_addresses text[] NOT NULL DEFAULT '{}',
  alert_whatsapp_enabled boolean NOT NULL DEFAULT false,
  alert_whatsapp_phone text,
  quote_threshold_alert boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.lead_alerts_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  alert_channel text NOT NULL CHECK (alert_channel IN ('email', 'whatsapp', 'in_app')),
  recipient text NOT NULL,
  subject text,
  -- Historical schema compatibility; the server explicitly records unsent alerts
  -- as failed. This migration creates no evidence and sends no messages.
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE drift text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('tenant_alert_settings', 'lead_alerts_log')
      AND c.relkind <> 'r'
  ) THEN
    RAISE EXCEPTION 'Alert prerequisite schema drift: expected ordinary tables' USING ERRCODE = '55000';
  END IF;

  WITH expected(relation_name, column_name, type_name, required, default_expr) AS (VALUES
    ('tenant_alert_settings','tenant_id','uuid',true,NULL::text),
    ('tenant_alert_settings','lead_alerts_enabled','boolean',true,'true'),
    ('tenant_alert_settings','alert_email_addresses','text[]',true,'''{}''::text[]'),
    ('tenant_alert_settings','alert_whatsapp_enabled','boolean',true,'false'),
    ('tenant_alert_settings','alert_whatsapp_phone','text',false,NULL),
    ('tenant_alert_settings','quote_threshold_alert','boolean',true,'true'),
    ('tenant_alert_settings','created_at','timestamp with time zone',true,'now()'),
    ('tenant_alert_settings','updated_at','timestamp with time zone',true,'now()'),
    ('lead_alerts_log','id','uuid',true,'gen_random_uuid()'),
    ('lead_alerts_log','tenant_id','uuid',true,NULL),
    ('lead_alerts_log','lead_id','uuid',false,NULL),
    ('lead_alerts_log','alert_channel','text',true,NULL),
    ('lead_alerts_log','recipient','text',true,NULL),
    ('lead_alerts_log','subject','text',false,NULL),
    ('lead_alerts_log','status','text',true,'''sent''::text'),
    ('lead_alerts_log','error','text',false,NULL),
    ('lead_alerts_log','created_at','timestamp with time zone',true,'now()')
  ), actual AS (
    SELECT c.relname AS relation_name, a.attname AS column_name,
      format_type(a.atttypid,a.atttypmod) AS type_name, a.attnotnull AS required,
      pg_get_expr(d.adbin,d.adrelid) AS default_expr, a.attidentity, a.attgenerated
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname IN ('tenant_alert_settings','lead_alerts_log')
      AND a.attnum>0 AND NOT a.attisdropped
  )
  SELECT string_agg(coalesce(e.relation_name,a.relation_name)||'.'||coalesce(e.column_name,a.column_name),', ' ORDER BY coalesce(e.relation_name,a.relation_name),coalesce(e.column_name,a.column_name)) INTO drift
  FROM expected e FULL JOIN actual a USING(relation_name,column_name)
  WHERE e.column_name IS NULL OR a.column_name IS NULL
    OR a.type_name IS DISTINCT FROM e.type_name OR a.required IS DISTINCT FROM e.required
    OR a.default_expr IS DISTINCT FROM e.default_expr
    OR a.attidentity<>'' OR a.attgenerated<>'';
  IF drift IS NOT NULL THEN
    RAISE EXCEPTION 'Alert prerequisite column/default drift: %', drift USING ERRCODE = '55000';
  END IF;

  WITH expected(relation_name, definition) AS (VALUES
    ('tenant_alert_settings','PRIMARY KEY (tenant_id)'),
    ('lead_alerts_log','PRIMARY KEY (id)'),
    ('lead_alerts_log','FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL'),
    ('lead_alerts_log','CHECK ((alert_channel = ANY (ARRAY[''email''::text, ''whatsapp''::text, ''in_app''::text])))'),
    ('lead_alerts_log','CHECK ((status = ANY (ARRAY[''sent''::text, ''failed''::text])))')
  ), actual AS (
    SELECT c.relname AS relation_name, con.conname,
      pg_get_constraintdef(con.oid) AS definition, con.convalidated
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('tenant_alert_settings','lead_alerts_log')
      AND con.contype<>'n'
  )
  SELECT string_agg(coalesce(e.relation_name,a.relation_name)||':'||coalesce(a.conname,'missing constraint'),', ') INTO drift
  FROM expected e FULL JOIN actual a ON a.relation_name=e.relation_name
    AND a.definition=e.definition
  WHERE e.relation_name IS NULL OR a.relation_name IS NULL OR NOT a.convalidated;
  IF drift IS NOT NULL OR (
    SELECT count(*) FROM pg_constraint WHERE conrelid IN ('public.tenant_alert_settings'::regclass,'public.lead_alerts_log'::regclass) AND contype<>'n'
  ) <> 5 THEN
    RAISE EXCEPTION 'Alert prerequisite constraint drift: %',coalesce(drift,'unexpected duplicate constraints') USING ERRCODE = '55000';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND (
    (tablename='tenant_alert_settings' AND policyname NOT IN ('tenant_alert_settings_isolation','tenant_alert_settings_admin_read')) OR
    (tablename='lead_alerts_log' AND policyname NOT IN ('lead_alerts_log_isolation','lead_alerts_log_admin_read'))
  )) THEN
    RAISE EXCEPTION 'Alert prerequisite policy drift: review unknown alert policy before applying' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN ('public.tenant_alert_settings'::regclass,'public.lead_alerts_log'::regclass) AND NOT tgisinternal)
    OR EXISTS (SELECT 1 FROM pg_index WHERE indrelid IN ('public.tenant_alert_settings'::regclass,'public.lead_alerts_log'::regclass) AND indisunique AND NOT indisprimary) THEN
    RAISE EXCEPTION 'Alert prerequisite schema drift: unexpected trigger or unique index' USING ERRCODE = '55000';
  END IF;

  IF to_regclass('public.idx_lead_alerts_tenant_created') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid
    JOIN pg_am am ON am.oid=idx.relam
    WHERE i.indexrelid=to_regclass('public.idx_lead_alerts_tenant_created')
      AND i.indrelid='public.lead_alerts_log'::regclass AND am.amname='btree'
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND i.indnkeyatts=2 AND i.indnatts=2 AND i.indpred IS NULL AND i.indexprs IS NULL
      AND i.indoption::text='0 3'
      AND i.indkey::text=(SELECT string_agg(attnum::text,' ' ORDER BY CASE attname WHEN 'tenant_id' THEN 1 ELSE 2 END)
        FROM pg_attribute WHERE attrelid='public.lead_alerts_log'::regclass AND attname IN ('tenant_id','created_at') AND NOT attisdropped)
  ) THEN
    RAISE EXCEPTION 'Alert prerequisite index drift: idx_lead_alerts_tenant_created differs' USING ERRCODE = '55000';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lead_alerts_tenant_created ON public.lead_alerts_log (tenant_id, created_at DESC);
ALTER TABLE public.tenant_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_alerts_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_alert_settings, public.lead_alerts_log FROM PUBLIC, anon, authenticated;
DO $$
DECLARE relation_name text; columns_sql text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['tenant_alert_settings','lead_alerts_log'] LOOP
    SELECT string_agg(quote_ident(attname),', ') INTO columns_sql FROM pg_attribute
    WHERE attrelid=format('public.%I',relation_name)::regclass AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE SELECT (%s), INSERT (%s), UPDATE (%s), REFERENCES (%s) ON public.%I FROM PUBLIC, anon, authenticated',columns_sql,columns_sql,columns_sql,columns_sql,relation_name);
  END LOOP;
END $$;
GRANT SELECT ON public.tenant_alert_settings, public.lead_alerts_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_alert_settings TO service_role;
GRANT SELECT, INSERT ON public.lead_alerts_log TO service_role;
DROP POLICY IF EXISTS tenant_alert_settings_isolation ON public.tenant_alert_settings;
DROP POLICY IF EXISTS lead_alerts_log_isolation ON public.lead_alerts_log;
DROP POLICY IF EXISTS tenant_alert_settings_admin_read ON public.tenant_alert_settings;
CREATE POLICY tenant_alert_settings_admin_read ON public.tenant_alert_settings
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.tenant_id=tenant_alert_settings.tenant_id
    AND p.staff_role IN ('company_admin','super_admin')
));
DROP POLICY IF EXISTS lead_alerts_log_admin_read ON public.lead_alerts_log;
CREATE POLICY lead_alerts_log_admin_read ON public.lead_alerts_log
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.tenant_id=lead_alerts_log.tenant_id
    AND p.staff_role IN ('company_admin','super_admin')
));
COMMIT;
