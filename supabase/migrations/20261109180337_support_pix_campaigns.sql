alter table public.project_support_settings
  add column pix_key text check (pix_key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'),
  add column page_title text not null default 'Ajude o Caderno de Questões a crescer 💙'
    check (char_length(btrim(page_title)) between 1 and 120),
  add column page_message text not null default 'Estamos construindo uma plataforma de estudo independente. Se ela estiver ajudando você e quiser contribuir com a manutenção, melhorias e custos de tecnologia, seu apoio é bem-vindo.'
    check (char_length(btrim(page_message)) between 1 and 3000),
  add constraint support_enabled_has_method check (not enabled or support_url is not null or pix_key is not null),
  add constraint support_https_link check (support_url is null or (
    char_length(support_url) <= 500 and
    support_url ~* '^https://(apoia[.]se|www[.]apoia[.]se|vakinha[.]com[.]br|www[.]vakinha[.]com[.]br)/[^[:space:]]+$'
  ));

grant update (enabled, support_url, pix_key, page_title, page_message) on public.project_support_settings to authenticated;
create policy support_settings_admin_update on public.project_support_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create table public.support_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  message text not null check (char_length(btrim(message)) between 1 and 3000),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  channel text check (channel in ('notification', 'popup')),
  recipient_count integer not null default 0
);
alter table public.support_campaigns enable row level security;
revoke all on public.support_campaigns from public, anon, authenticated;
grant select on public.support_campaigns to authenticated;
grant insert (title, message), update (title, message) on public.support_campaigns to authenticated;
create policy support_campaigns_admin_read on public.support_campaigns for select to authenticated
  using ((select public.is_admin()));
create policy support_campaigns_admin_insert on public.support_campaigns for insert to authenticated
  with check ((select public.is_admin()));
create policy support_campaigns_admin_edit on public.support_campaigns for update to authenticated
  using ((select public.is_admin()) and sent_at is null)
  with check ((select public.is_admin()) and sent_at is null);

create function public.admin_send_support_campaign(campaign_id uuid, delivery text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  campaign public.support_campaigns;
  recipients integer;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Acesso restrito ao administrador.';
  end if;
  if delivery is null or delivery not in ('notification', 'popup') then
    raise exception 'Escolha um formato de envio válido.';
  end if;
  perform 1 from public.project_support_settings where id = 1 and enabled for share;
  if not found then
    raise exception 'Ative a página de apoio antes de enviar a campanha.';
  end if;
  select * into campaign from public.support_campaigns where id = campaign_id for update;
  if not found or campaign.sent_at is not null then
    raise exception 'Campanha indisponível ou já enviada.';
  end if;

  insert into public.user_notifications(user_id, category, title, body, destination, event_key, details)
  select p.id, 'support', campaign.title, campaign.message, 'apoio',
    'support:message:' || campaign.id::text, jsonb_build_object('delivery', delivery)
  from public.profiles p
  left join public.notification_preferences np on np.user_id = p.id
  where p.role <> 'admin' and coalesce(np.support, true)
  on conflict (user_id, event_key) do nothing;
  get diagnostics recipients = row_count;
  if recipients > 0 then
    update public.support_campaigns
      set sent_at = now(), channel = delivery, recipient_count = recipients
      where id = campaign.id;
  end if;
  return recipients;
end;
$$;
revoke all on function public.admin_send_support_campaign(uuid, text) from public, anon;
grant execute on function public.admin_send_support_campaign(uuid, text) to authenticated;

insert into public.support_campaigns (title, message) values (
  'Um convite para apoiar o Caderno 💙',
  'O Caderno de Questões está começando. Se quiser ajudar a manter e melhorar o projeto, conheça uma forma voluntária de contribuição. O uso continua gratuito.'
);

CREATE OR REPLACE FUNCTION public.admin_support_metrics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v integer; result jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador'; END IF;
 SELECT campaign_version INTO v FROM public.project_support_settings WHERE id=1;
 SELECT jsonb_build_object(
   'users_total',(SELECT count(*) FROM public.profiles WHERE role<>'admin'),
   'opted_out',(SELECT count(*) FROM public.profiles p JOIN public.notification_preferences np ON np.user_id=p.id WHERE p.role<>'admin' AND np.support=false),
   'notices_created',(SELECT count(*) FROM public.user_notifications WHERE category='support'),
   'notices_read',(SELECT count(*) FROM public.user_notifications WHERE category='support' AND read_at IS NOT NULL),
   'notices_unread',(SELECT count(*) FROM public.user_notifications WHERE category='support' AND read_at IS NULL),
   'campaign_version',v
 ) INTO result;
 RETURN result;
END $$;
