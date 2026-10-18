-- Requires reviewed alert storage, workspace_notifications and email delivery audit.
-- Adds local persistence only: no sends, backfills, customer-row updates or deletes.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.workspace_notifications, public.lead_alerts_log, public.email_delivery_log
  IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.workspace_notifications WHERE lead_id IS NOT NULL
    GROUP BY tenant_id,recipient_user_id,lead_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Lead alert duplicate notifications exist; review before indexing. No rows were deleted.' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lead_alerts_log WHERE lead_id IS NOT NULL
    GROUP BY tenant_id,lead_id,alert_channel,
      CASE WHEN alert_channel='email' THEN lower(btrim(recipient)) ELSE btrim(recipient) END HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Lead alert duplicate diagnostics exist; review before deduplicating. No rows were deleted.' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.email_delivery_log
    WHERE template='internal_sales_lead_alert' AND provider='platform_smtp' AND provider_msg_id LIKE 'alert_unsent_%'
    GROUP BY tenant_id,lower(btrim(recipient)),provider_msg_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Lead alert duplicate email diagnostics exist; review before deduplicating. No rows were deleted.' USING ERRCODE='55000';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS workspace_notifications_lead_recipient_unique
  ON public.workspace_notifications (tenant_id,recipient_user_id,lead_id);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am a ON a.oid=c.relam
    WHERE i.indexrelid='public.workspace_notifications_lead_recipient_unique'::regclass
      AND i.indrelid='public.workspace_notifications'::regclass AND i.indisunique AND i.indisvalid AND i.indisready
      AND NOT i.indnullsnotdistinct AND i.indimmediate
      AND a.amname='btree' AND i.indnkeyatts=3 AND i.indnatts=3 AND i.indpred IS NULL AND i.indexprs IS NULL
      AND i.indkey::text=(SELECT string_agg(attnum::text,' ' ORDER BY CASE attname WHEN 'tenant_id' THEN 1 WHEN 'recipient_user_id' THEN 2 ELSE 3 END)
        FROM pg_attribute WHERE attrelid='public.workspace_notifications'::regclass
          AND attname IN ('tenant_id','recipient_user_id','lead_id') AND NOT attisdropped)
  ) THEN
    RAISE EXCEPTION 'Lead alert notification index differs; review schema drift.' USING ERRCODE='55000';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.record_sales_lead_alert(
  _tenant_id uuid, _lead_id uuid, _title text, _body text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  settings public.tenant_alert_settings%ROWTYPE;
  recipient_ids uuid[];
  email_recipients text[];
  recipient_email text;
  whatsapp_phone text;
  notification_count integer;
  inserted_count integer;
  diagnostics_pending boolean := false;
  not_emailed constant text := 'Email sending is not connected yet, so this alert was not emailed.';
BEGIN
  IF _tenant_id IS NULL OR _lead_id IS NULL OR _title IS NULL OR _body IS NULL
    OR btrim(_title)='' OR btrim(_body)='' OR length(_title)>200 OR length(_body)>1000 THEN
    RAISE EXCEPTION 'A lead alert requires its workspace, lead and bounded text.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id=_lead_id AND tenant_id=_tenant_id) THEN
    RAISE EXCEPTION 'Lead alert does not belong to this workspace.' USING ERRCODE='23503';
  END IF;
  -- Hash collisions only add serialization; no caller-controlled lock/session state.
  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':'||_lead_id::text,0));
  SELECT * INTO settings FROM public.tenant_alert_settings WHERE tenant_id=_tenant_id;
  IF settings.lead_alerts_enabled IS FALSE THEN
    RETURN jsonb_build_object('notification_count',0,'created_notification_count',0,'email_recipient_count',0,'diagnostics_pending',false);
  END IF;
  SELECT coalesce(array_agg(DISTINCT lower(btrim(address))),'{}'::text[]) INTO email_recipients
  FROM unnest(coalesce(settings.alert_email_addresses,'{}'::text[])) address
  WHERE address IS NOT NULL AND btrim(address)<>'';
  -- Whole DB query, no PostgREST/application profile cap or stale recipient input.
  SELECT coalesce(array_agg(p.id ORDER BY p.id),'{}'::uuid[]) INTO recipient_ids
  FROM public.profiles p WHERE p.tenant_id=_tenant_id
    AND p.staff_role IN ('company_admin','super_admin','marketing_manager','staff')
    AND (p.staff_role IN ('company_admin','super_admin') OR lower(btrim(p.email))=ANY(email_recipients));
  IF cardinality(email_recipients)=0 THEN
    SELECT coalesce(array_agg(DISTINCT lower(btrim(p.email))),'{}'::text[]) INTO email_recipients
    FROM public.profiles p WHERE p.tenant_id=_tenant_id
      AND p.staff_role IN ('company_admin','super_admin') AND p.email IS NOT NULL AND btrim(p.email)<>'';
  END IF;
  INSERT INTO public.workspace_notifications(tenant_id,recipient_user_id,lead_id,title,body)
  SELECT _tenant_id,id,_lead_id,_title,_body FROM unnest(recipient_ids) id
  ON CONFLICT(tenant_id,recipient_user_id,lead_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  SELECT count(*) INTO notification_count FROM public.workspace_notifications
  WHERE tenant_id=_tenant_id AND lead_id=_lead_id AND recipient_user_id=ANY(recipient_ids);
  -- A diagnostic outage must not undo a real notification. The savepoint rolls
  -- back all diagnostic inserts, making a later capture a clean, safe retry.
  BEGIN
    FOREACH recipient_email IN ARRAY email_recipients LOOP
      INSERT INTO public.lead_alerts_log(tenant_id,lead_id,alert_channel,recipient,subject,status,error)
      SELECT _tenant_id,_lead_id,'email',recipient_email,_title,'failed',not_emailed
      WHERE NOT EXISTS (SELECT 1 FROM public.lead_alerts_log WHERE tenant_id=_tenant_id
        AND lead_id=_lead_id AND alert_channel='email' AND lower(btrim(recipient))=recipient_email);
      IF NOT EXISTS (SELECT 1 FROM public.email_delivery_log WHERE tenant_id=_tenant_id
        AND lower(btrim(recipient))=recipient_email AND template='internal_sales_lead_alert'
        AND provider='platform_smtp' AND provider_msg_id='alert_unsent_'||_lead_id::text) THEN
        PERFORM public.log_email_delivery(_tenant_id,NULL,recipient_email,'flas@mobidigisol.com',_title,
          'internal_sales_lead_alert','platform_smtp','alert_unsent_'||_lead_id::text,
          'failed',not_emailed,jsonb_build_object('error',not_emailed));
      END IF;
    END LOOP;
    whatsapp_phone := nullif(btrim(settings.alert_whatsapp_phone),'');
    IF settings.alert_whatsapp_enabled IS TRUE AND whatsapp_phone IS NOT NULL THEN
      INSERT INTO public.lead_alerts_log(tenant_id,lead_id,alert_channel,recipient,subject,status,error)
      SELECT _tenant_id,_lead_id,'whatsapp',whatsapp_phone,_title,'failed','FLAS_WHATSAPP_ALERT_PIPELINE_UNAVAILABLE'
      WHERE NOT EXISTS (SELECT 1 FROM public.lead_alerts_log WHERE tenant_id=_tenant_id
        AND lead_id=_lead_id AND alert_channel='whatsapp' AND btrim(recipient)=whatsapp_phone);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    diagnostics_pending := true;
  END;
  RETURN jsonb_build_object('notification_count',notification_count,'created_notification_count',inserted_count,
    'email_recipient_count',cardinality(email_recipients),'diagnostics_pending',diagnostics_pending);
END $$;
REVOKE ALL ON FUNCTION public.record_sales_lead_alert(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_sales_lead_alert(uuid,uuid,text,text) TO service_role;
COMMIT;
