-- Sistema 2.0: fila de análise autônoma e rastreável.
-- Não altera a tabela atual public.questions nem publica conteúdo aos alunos.
create extension if not exists pg_net;
create extension if not exists pg_cron;
create extension if not exists pgcrypto;

create table if not exists public.system2_ai_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  max_per_day integer not null default 30 check (max_per_day between 1 and 500),
  min_interval_minutes integer not null default 5 check (min_interval_minutes between 1 and 1440),
  function_url text,
  cron_secret text not null default encode(gen_random_bytes(24), 'hex'),
  last_started_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.system2_ai_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.system2_ai_runs (
  id uuid primary key default gen_random_uuid(),
  question_id uuid references public.questions_v2(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger_source text not null check (trigger_source in ('scheduled', 'manual')),
  status text not null check (status in ('processing', 'approved', 'needs_review', 'failed', 'skipped')),
  error_message text,
  result_summary jsonb not null default '{}'::jsonb
);

alter table public.questions_v2 add column if not exists ai_result jsonb not null default '{}'::jsonb;
create index if not exists system2_ai_runs_started_idx on public.system2_ai_runs(started_at desc);
create index if not exists system2_ai_runs_question_idx on public.system2_ai_runs(question_id, started_at desc);

alter table public.system2_ai_settings enable row level security;
alter table public.system2_ai_runs enable row level security;
drop policy if exists "system2_ai_settings_admin" on public.system2_ai_settings;
create policy "system2_ai_settings_admin" on public.system2_ai_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "system2_ai_runs_admin" on public.system2_ai_runs;
create policy "system2_ai_runs_admin" on public.system2_ai_runs for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.claim_system2_ai_question(p_trigger text default 'scheduled')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  settings public.system2_ai_settings%rowtype;
  item public.questions_v2%rowtype;
  run_id uuid;
  today_count integer;
begin
  select * into settings from public.system2_ai_settings where id = true for update;
  if not settings.enabled then return jsonb_build_object('claimed', false, 'reason', 'A automação está pausada.'); end if;
  if settings.last_started_at is not null and settings.last_started_at > now() - make_interval(mins => settings.min_interval_minutes) then return jsonb_build_object('claimed', false, 'reason', 'Aguardando o intervalo configurado.'); end if;
  select count(*) into today_count from public.system2_ai_runs where started_at >= date_trunc('day', now()) and status in ('processing', 'approved', 'needs_review', 'failed');
  if today_count >= settings.max_per_day then return jsonb_build_object('claimed', false, 'reason', 'Limite diário de análises atingido.'); end if;
  select * into item from public.questions_v2 where status = 'pending_ai' order by created_at asc for update skip locked limit 1;
  if not found then return jsonb_build_object('claimed', false, 'reason', 'Não há questões pendentes.'); end if;
  update public.questions_v2 set status = 'processing_ai', ai_attempts = ai_attempts + 1, ai_last_error = null where id = item.id;
  insert into public.system2_ai_runs(question_id, trigger_source, status) values (item.id, case when p_trigger = 'manual' then 'manual' else 'scheduled' end, 'processing') returning id into run_id;
  update public.system2_ai_settings set last_started_at = now(), updated_at = now() where id = true;
  return jsonb_build_object('claimed', true, 'run_id', run_id, 'question_id', item.id, 'statement', item.statement, 'alternatives', item.alternatives, 'answer_key_option', item.answer_key_option);
end;
$$;
revoke all on function public.claim_system2_ai_question(text) from public, anon, authenticated;
grant execute on function public.claim_system2_ai_question(text) to service_role;

create or replace function public.trigger_system2_ai_worker()
returns void language plpgsql security definer set search_path = public as $$
declare settings public.system2_ai_settings%rowtype;
begin
  select * into settings from public.system2_ai_settings where id = true;
  if settings.enabled and nullif(settings.function_url, '') is not null then
    perform net.http_post(
      url := settings.function_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-system2-cron-key', settings.cron_secret),
      body := jsonb_build_object('trigger', 'scheduled')
    );
  end if;
end;
$$;
revoke all on function public.trigger_system2_ai_worker() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'system2-ai-worker') then
    perform cron.schedule('system2-ai-worker', '*/5 * * * *', 'select public.trigger_system2_ai_worker();');
  end if;
end $$;
