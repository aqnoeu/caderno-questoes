-- v66.4: optional development support; no payment handling or payment data stored
CREATE TABLE public.project_support_settings (
 id integer PRIMARY KEY DEFAULT 1 CHECK (id=1),
 enabled boolean NOT NULL DEFAULT false,
 support_url text,
 campaign_version integer NOT NULL DEFAULT 1 CHECK (campaign_version>0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.project_support_settings(id) VALUES(1);
ALTER TABLE public.project_support_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_support_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.project_support_settings TO authenticated;
CREATE POLICY support_settings_authenticated ON public.project_support_settings FOR SELECT TO authenticated USING (true);

ALTER TABLE public.notification_preferences ADD COLUMN support boolean NOT NULL DEFAULT true;
ALTER TABLE public.user_notifications DROP CONSTRAINT user_notifications_category_check;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_category_check
 CHECK (category IN ('new_questions','revenge','achievement','study','admin_review','notebook_status','support'));
ALTER TABLE public.user_notifications DROP CONSTRAINT user_notifications_destination_check;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_destination_check
 CHECK (destination IN ('estudos','revanche','desempenho','inicio','admin_notebooks','apoio'));

CREATE FUNCTION public.admin_configure_project_support(p_url text,p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row record; new_version integer; normalized text;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador'; END IF;
 normalized:=nullif(trim(coalesce(p_url,'')),'');
 IF normalized IS NOT NULL AND (
   length(normalized)>500 OR
   normalized !~* '^https://(apoia[.]se|www[.]apoia[.]se|vakinha[.]com[.]br|www[.]vakinha[.]com[.]br)/[^[:space:]]+$'
 ) THEN RAISE EXCEPTION 'Use um link HTTPS de campanha APOIA.se ou Vakinha'; END IF;
 IF p_enabled AND normalized IS NULL THEN RAISE EXCEPTION 'Configure primeiro um link de apoio'; END IF;
 SELECT * INTO old_row FROM public.project_support_settings WHERE id=1 FOR UPDATE;
 new_version:=old_row.campaign_version+CASE WHEN old_row.support_url IS DISTINCT FROM normalized THEN 1 ELSE 0 END;
 UPDATE public.project_support_settings
  SET support_url=normalized,enabled=p_enabled,campaign_version=new_version,updated_at=now()
  WHERE id=1;
 RETURN jsonb_build_object('enabled',p_enabled,'support_url',normalized,'campaign_version',new_version);
END $$;
REVOKE ALL ON FUNCTION public.admin_configure_project_support(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_configure_project_support(text,boolean) TO authenticated;

CREATE FUNCTION public.admin_send_support_notice()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE settings record; inserted_count integer;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador'; END IF;
 SELECT * INTO settings FROM public.project_support_settings WHERE id=1 FOR UPDATE;
 IF NOT settings.enabled OR settings.support_url IS NULL THEN
  RAISE EXCEPTION 'Ative um link de apoio antes de enviar a mensagem';
 END IF;
 INSERT INTO public.user_notifications(user_id,category,title,body,destination,event_key,details)
 SELECT p.id,'support','Um convite para apoiar o Caderno 💙',
  'O Caderno de Questões está começando. Se quiser ajudar a manter e melhorar o projeto, conheça uma forma voluntária de contribuição. O uso continua gratuito.',
  'apoio','support:campaign:'||settings.campaign_version::text,
  jsonb_build_object('version',settings.campaign_version)
 FROM public.profiles p
 LEFT JOIN public.notification_preferences np ON np.user_id=p.id
 WHERE p.role<>'admin' AND coalesce(np.support,true)
 ON CONFLICT(user_id,event_key) DO NOTHING;
 GET DIAGNOSTICS inserted_count=ROW_COUNT;
 RETURN jsonb_build_object('created',inserted_count,'campaign_version',settings.campaign_version);
END $$;
REVOKE ALL ON FUNCTION public.admin_send_support_notice() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_send_support_notice() TO authenticated;

CREATE FUNCTION public.admin_support_metrics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v integer; result jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador'; END IF;
 SELECT campaign_version INTO v FROM public.project_support_settings WHERE id=1;
 SELECT jsonb_build_object(
   'users_total',(SELECT count(*) FROM public.profiles WHERE role<>'admin'),
   'opted_out',(SELECT count(*) FROM public.profiles p JOIN public.notification_preferences np ON np.user_id=p.id WHERE p.role<>'admin' AND np.support=false),
   'notices_created',(SELECT count(*) FROM public.user_notifications WHERE category='support' AND event_key='support:campaign:'||v::text),
   'notices_read',(SELECT count(*) FROM public.user_notifications WHERE category='support' AND event_key='support:campaign:'||v::text AND read_at IS NOT NULL),
   'notices_unread',(SELECT count(*) FROM public.user_notifications WHERE category='support' AND event_key='support:campaign:'||v::text AND read_at IS NULL),
   'campaign_version',v
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_support_metrics() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_support_metrics() TO authenticated;
