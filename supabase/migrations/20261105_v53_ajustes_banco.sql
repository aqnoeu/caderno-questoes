-- v53: controle atômico do limite mensal de correções de discursivas (fecha a brecha de corrida e de burla pelo navegador).
-- Nada é apagado. Só cria tabela e funções novas; só o servidor (service_role) as executa.

create table if not exists public.essay_correction_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  essay_question_id uuid,
  credit_id uuid references public.essay_correction_credits(id) on delete set null,
  created_at timestamptz not null default now(),
  refunded_at timestamptz
);
create index if not exists essay_correction_usage_user_month_idx on public.essay_correction_usage(user_id, created_at);
alter table public.essay_correction_usage enable row level security;
revoke all on public.essay_correction_usage from anon, authenticated;

create table if not exists public.essay_usage_cutover (id boolean primary key default true check (id), starts_at timestamptz not null default now());
insert into public.essay_usage_cutover(id) values (true) on conflict do nothing;
alter table public.essay_usage_cutover enable row level security;
revoke all on public.essay_usage_cutover from anon, authenticated;

create or replace function public.reserve_essay_correction(p_user uuid, p_question uuid, p_limit integer, p_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cutover timestamptz; month_start timestamptz := date_trunc('month', now()); used_count integer; credit public.essay_correction_credits%rowtype; new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('essay_correction:' || p_user::text));
  select starts_at into cutover from public.essay_usage_cutover where id = true;
  -- correções feitas antes da v53 continuam contando no mês corrente
  select (select count(*) from public.essay_attempts where user_id = p_user and corrected_at >= month_start and corrected_at < cutover)
       + (select count(*) from public.essay_correction_usage where user_id = p_user and created_at >= month_start and refunded_at is null and credit_id is null)
    into used_count;
  if used_count < p_limit then
    insert into public.essay_correction_usage(user_id, essay_question_id) values (p_user, p_question) returning id into new_id;
    return jsonb_build_object('ok', true, 'usage_id', new_id);
  end if;
  if p_token is null or btrim(p_token) = '' then return jsonb_build_object('ok', false, 'code', 'limit'); end if;
  select * into credit from public.essay_correction_credits where token = btrim(p_token) and user_id = p_user and used_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'token'); end if;
  update public.essay_correction_credits set used_at = now() where id = credit.id;
  insert into public.essay_correction_usage(user_id, essay_question_id, credit_id) values (p_user, p_question, credit.id) returning id into new_id;
  return jsonb_build_object('ok', true, 'usage_id', new_id);
end;
$$;

create or replace function public.refund_essay_correction(p_usage_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare u public.essay_correction_usage%rowtype;
begin
  select * into u from public.essay_correction_usage where id = p_usage_id and refunded_at is null for update;
  if not found then return; end if;
  update public.essay_correction_usage set refunded_at = now() where id = u.id;
  if u.credit_id is not null then update public.essay_correction_credits set used_at = null, used_for_attempt_id = null where id = u.credit_id; end if;
end;
$$;

revoke all on function public.reserve_essay_correction(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.refund_essay_correction(uuid) from public, anon, authenticated;
grant execute on function public.reserve_essay_correction(uuid, uuid, integer, text) to service_role;
grant execute on function public.refund_essay_correction(uuid) to service_role;
