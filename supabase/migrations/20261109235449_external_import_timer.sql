create table public.external_import_timer (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  interval_minutes integer not null default 2 check (interval_minutes between 1 and 60),
  last_started_at timestamptz,
  cron_secret uuid not null default gen_random_uuid()
);
insert into public.external_import_timer default values;
alter table public.external_import_timer enable row level security;
revoke all on public.external_import_timer from public, anon, authenticated;
grant select (id, enabled, interval_minutes, last_started_at),
  update (enabled, interval_minutes) on public.external_import_timer to authenticated;
grant select on public.external_import_timer to service_role;
create policy external_timer_admin_read on public.external_import_timer for select to authenticated
  using ((select public.is_admin()));
create policy external_timer_admin_update on public.external_import_timer for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

alter table public.external_question_imports
  add column review_claim uuid,
  add column review_claim_until timestamptz,
  add column review_retry_at timestamptz,
  add column review_error text;

create or replace function public.reset_external_import_review()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.payload, new.modality) is distinct from (old.payload, old.modality) then
    if old.status = 'released' then raise exception 'Importação já encaminhada.'; end if;
    new.revision := gen_random_uuid();
    new.status := 'pending';
    new.missing_fields := '{}';
    new.reviewed_at := null;
    new.review_claim := null;
    new.review_claim_until := null;
    new.review_retry_at := null;
    new.review_error := null;
  end if;
  return new;
end;
$$;

create function public.claim_external_import_review(p_id uuid default null)
returns setof public.external_question_imports
language plpgsql security definer set search_path = '' as $$
declare
  timer public.external_import_timer;
  selected_id uuid;
begin
  select * into timer from public.external_import_timer where id for update;
  if p_id is null and (not timer.enabled or timer.last_started_at >
    now() - make_interval(mins => timer.interval_minutes)) then return; end if;

  select id into selected_id from public.external_question_imports
  where status = 'pending'
    and (p_id is null or id = p_id)
    and (review_claim_until is null or review_claim_until <= now())
    and (p_id is not null or review_retry_at is null or review_retry_at <= now())
  order by created_at, id
  for update skip locked limit 1;
  if not found then return; end if;

  update public.external_import_timer set last_started_at = now() where id;
  return query update public.external_question_imports
    set review_claim = gen_random_uuid(), review_claim_until = now() + interval '4 minutes',
      review_error = null
    where id = selected_id returning *;
end;
$$;
revoke all on function public.claim_external_import_review(uuid) from public, anon, authenticated;
grant execute on function public.claim_external_import_review(uuid) to service_role;

create function public.trigger_external_import_review()
returns void language plpgsql security definer set search_path = '' as $$
declare timer public.external_import_timer;
begin
  select * into timer from public.external_import_timer where id;
  if timer.enabled and (timer.last_started_at is null or timer.last_started_at <=
    now() - make_interval(mins => timer.interval_minutes))
    and exists (select 1 from public.external_question_imports
      where status = 'pending'
        and (review_claim_until is null or review_claim_until <= now())
        and (review_retry_at is null or review_retry_at <= now())) then
    perform net.http_post(
      url := 'https://nzmlnwhlrilcpttpahfd.supabase.co/functions/v1/check-external-import',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-import-cron-key', timer.cron_secret),
      body := '{}'::jsonb, timeout_milliseconds := 120000
    );
  end if;
end;
$$;
revoke all on function public.trigger_external_import_review() from public, anon, authenticated;
select cron.schedule('external-import-review', '* * * * *', 'select public.trigger_external_import_review();');
