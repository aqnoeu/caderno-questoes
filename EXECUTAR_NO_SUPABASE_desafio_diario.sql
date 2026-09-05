-- Desafio Diário: banco próprio, uma tentativa por usuário e correção protegida no banco.
create table if not exists public.challenge_questions (
  id uuid primary key default gen_random_uuid(),
  statement text not null check (char_length(trim(statement)) > 0),
  correct_answer boolean not null,
  discipline text,
  subject text,
  explanation text,
  legal_basis text,
  active boolean not null default true,
  times_used integer not null default 0 check (times_used >= 0),
  last_used_at date,
  administratively_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge_date date not null unique,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_challenge_questions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.daily_challenges(id) on delete cascade,
  question_id uuid not null references public.challenge_questions(id) on delete restrict,
  position smallint not null check (position between 1 and 5),
  created_at timestamptz not null default now(),
  unique(challenge_id, position),
  unique(challenge_id, question_id)
);

create table if not exists public.challenge_attempts (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.daily_challenges(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  elapsed_ms bigint,
  correct_count smallint not null default 0 check (correct_count between 0 and 5),
  error_count smallint not null default 0 check (error_count between 0 and 5),
  current_position smallint not null default 0 check (current_position between 0 and 5),
  next_allowed_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress', 'awaiting_completion', 'completed', 'disqualified')),
  disqualified_at timestamptz,
  disqualification_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(challenge_id, user_id)
);

create table if not exists public.challenge_attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.challenge_attempts(id) on delete cascade,
  question_id uuid not null references public.challenge_questions(id) on delete restrict,
  selected_answer boolean not null,
  correct boolean not null,
  answered_at timestamptz not null default now(),
  unique(attempt_id, question_id)
);

create index if not exists challenge_questions_active_idx on public.challenge_questions(active, administratively_available);
create index if not exists daily_challenge_questions_challenge_idx on public.daily_challenge_questions(challenge_id, position);
create index if not exists challenge_attempts_challenge_ranking_idx on public.challenge_attempts(challenge_id, elapsed_ms, error_count, completed_at) where status = 'completed';
create index if not exists challenge_attempts_user_idx on public.challenge_attempts(user_id, started_at desc);

create or replace function public.touch_daily_challenge_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists touch_challenge_questions_updated_at on public.challenge_questions;
create trigger touch_challenge_questions_updated_at before update on public.challenge_questions for each row execute function public.touch_daily_challenge_updated_at();
drop trigger if exists touch_daily_challenges_updated_at on public.daily_challenges;
create trigger touch_daily_challenges_updated_at before update on public.daily_challenges for each row execute function public.touch_daily_challenge_updated_at();
drop trigger if exists touch_challenge_attempts_updated_at on public.challenge_attempts;
create trigger touch_challenge_attempts_updated_at before update on public.challenge_attempts for each row execute function public.touch_daily_challenge_updated_at();

-- Um desafio publicado é imutável na composição e sempre tem exatamente cinco perguntas.
create or replace function public.guard_daily_challenge_questions()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_challenge uuid := coalesce(new.challenge_id, old.challenge_id);
begin
  if exists (select 1 from public.daily_challenges where id = v_challenge and status = 'published') then
    raise exception 'A composição de um desafio publicado não pode ser alterada';
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists guard_daily_challenge_questions on public.daily_challenge_questions;
create trigger guard_daily_challenge_questions before insert or update or delete on public.daily_challenge_questions for each row execute function public.guard_daily_challenge_questions();

create or replace function public.guard_daily_challenge_publish()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    select count(*) into v_count from public.daily_challenge_questions where challenge_id = new.id;
    if v_count <> 5 then raise exception 'Um desafio só pode ser publicado com exatamente 5 questões'; end if;
    new.published_at := coalesce(new.published_at, now());
    update public.challenge_questions q
      set times_used = q.times_used + 1, last_used_at = new.challenge_date
      from public.daily_challenge_questions dq
      where dq.challenge_id = new.id and dq.question_id = q.id;
  end if;
  return new;
end; $$;
drop trigger if exists guard_daily_challenge_publish on public.daily_challenges;
create trigger guard_daily_challenge_publish before update on public.daily_challenges for each row execute function public.guard_daily_challenge_publish();

alter table public.challenge_questions enable row level security;
alter table public.daily_challenges enable row level security;
alter table public.daily_challenge_questions enable row level security;
alter table public.challenge_attempts enable row level security;
alter table public.challenge_attempt_answers enable row level security;

drop policy if exists "challenge_questions_admin" on public.challenge_questions;
create policy "challenge_questions_admin" on public.challenge_questions for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "daily_challenges_admin" on public.daily_challenges;
create policy "daily_challenges_admin" on public.daily_challenges for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "daily_challenge_questions_admin" on public.daily_challenge_questions;
create policy "daily_challenge_questions_admin" on public.daily_challenge_questions for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "challenge_attempts_admin" on public.challenge_attempts;
create policy "challenge_attempts_admin" on public.challenge_attempts for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "challenge_attempts_own_read" on public.challenge_attempts;
create policy "challenge_attempts_own_read" on public.challenge_attempts for select to authenticated using (user_id = auth.uid());
drop policy if exists "challenge_attempt_answers_admin" on public.challenge_attempt_answers;
create policy "challenge_attempt_answers_admin" on public.challenge_attempt_answers for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "challenge_attempt_answers_own_read" on public.challenge_attempt_answers;
create policy "challenge_attempt_answers_own_read" on public.challenge_attempt_answers for select to authenticated using (attempt_id in (select id from public.challenge_attempts where user_id = auth.uid()));

create or replace function public.current_daily_challenge_date()
returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date; $$;

-- Retorna somente enunciados; a resposta correta nunca é enviada antes da escolha do aluno.
create or replace function public.get_today_daily_challenge()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_challenge public.daily_challenges%rowtype; v_attempt public.challenge_attempts%rowtype;
begin
  select * into v_challenge from public.daily_challenges where challenge_date = public.current_daily_challenge_date() and status = 'published';
  if not found then return jsonb_build_object('available', false); end if;
  select * into v_attempt from public.challenge_attempts where challenge_id = v_challenge.id and user_id = auth.uid();
  return jsonb_build_object('available', true, 'challenge_id', v_challenge.id, 'challenge_date', v_challenge.challenge_date, 'attempt', case when found then jsonb_build_object('id',v_attempt.id,'status',v_attempt.status,'started_at',v_attempt.started_at,'completed_at',v_attempt.completed_at,'elapsed_ms',v_attempt.elapsed_ms,'correct_count',v_attempt.correct_count,'error_count',v_attempt.error_count,'current_position',v_attempt.current_position,'next_allowed_at',v_attempt.next_allowed_at) else null end, 'questions', (select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'position',dq.position,'statement',q.statement,'discipline',q.discipline,'subject',q.subject) order by dq.position),'[]'::jsonb) from public.daily_challenge_questions dq join public.challenge_questions q on q.id=dq.question_id where dq.challenge_id=v_challenge.id));
end; $$;

create or replace function public.start_today_daily_challenge()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_challenge_id uuid; v_attempt public.challenge_attempts%rowtype;
begin
  select id into v_challenge_id from public.daily_challenges where challenge_date = public.current_daily_challenge_date() and status = 'published';
  if v_challenge_id is null then raise exception 'Não há desafio publicado para hoje'; end if;
  insert into public.challenge_attempts(challenge_id,user_id) values(v_challenge_id,auth.uid()) on conflict(challenge_id,user_id) do nothing;
  select * into v_attempt from public.challenge_attempts where challenge_id=v_challenge_id and user_id=auth.uid();
  return jsonb_build_object('attempt_id',v_attempt.id,'status',v_attempt.status,'started_at',v_attempt.started_at,'current_position',v_attempt.current_position,'next_allowed_at',v_attempt.next_allowed_at);
end; $$;

create or replace function public.submit_daily_challenge_answer(p_attempt_id uuid, p_question_id uuid, p_selected_answer boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_attempt public.challenge_attempts%rowtype; v_position smallint; v_correct_answer boolean; v_correct boolean; v_total integer; v_now timestamptz := now();
begin
  select * into v_attempt from public.challenge_attempts where id=p_attempt_id and user_id=auth.uid() for update;
  if not found then raise exception 'Tentativa inválida'; end if;
  if v_attempt.status <> 'in_progress' then raise exception 'Esta tentativa não aceita novas respostas'; end if;
  if v_attempt.next_allowed_at is not null and v_attempt.next_allowed_at > v_now then raise exception 'Aguarde a correção obrigatória antes de continuar'; end if;
  select dq.position,q.correct_answer into v_position,v_correct_answer from public.daily_challenge_questions dq join public.challenge_questions q on q.id=dq.question_id where dq.challenge_id=v_attempt.challenge_id and dq.question_id=p_question_id;
  if v_position is null or v_position <> v_attempt.current_position + 1 then raise exception 'A questão não é a próxima do desafio'; end if;
  v_correct := p_selected_answer = v_correct_answer;
  insert into public.challenge_attempt_answers(attempt_id,question_id,selected_answer,correct) values(v_attempt.id,p_question_id,p_selected_answer,v_correct);
  if v_position = 5 and not v_correct then
    update public.challenge_attempts set current_position=5, correct_count=correct_count, error_count=error_count+1, status='awaiting_completion', next_allowed_at=v_now + interval '15 seconds' where id=v_attempt.id;
  elsif v_position = 5 then
    update public.challenge_attempts set current_position=5, correct_count=correct_count+1, status='completed', completed_at=v_now, elapsed_ms=round(extract(epoch from (v_now-started_at))*1000)::bigint, next_allowed_at=null where id=v_attempt.id;
  else
    update public.challenge_attempts set current_position=v_position, correct_count=correct_count + case when v_correct then 1 else 0 end, error_count=error_count + case when v_correct then 0 else 1 end, next_allowed_at=case when v_correct then null else v_now + interval '15 seconds' end where id=v_attempt.id;
  end if;
  select count(*) into v_total from public.challenge_attempt_answers where attempt_id=v_attempt.id and correct;
  return jsonb_build_object('correct',v_correct,'correct_answer',v_correct_answer,'position',v_position,'is_last',v_position=5,'awaiting_completion',v_position=5 and not v_correct,'next_allowed_at',case when v_correct then null else v_now + interval '15 seconds' end,'correct_count',v_total,'explanation',(select explanation from public.challenge_questions where id=p_question_id),'legal_basis',(select legal_basis from public.challenge_questions where id=p_question_id));
end; $$;

create or replace function public.finish_daily_challenge_attempt(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_attempt public.challenge_attempts%rowtype; v_now timestamptz := now();
begin
  select * into v_attempt from public.challenge_attempts where id=p_attempt_id and user_id=auth.uid() for update;
  if not found then raise exception 'Tentativa inválida'; end if;
  if v_attempt.status='completed' then return jsonb_build_object('completed',true,'elapsed_ms',v_attempt.elapsed_ms,'correct_count',v_attempt.correct_count,'error_count',v_attempt.error_count); end if;
  if v_attempt.status <> 'awaiting_completion' or v_attempt.next_allowed_at > v_now then raise exception 'A correção obrigatória ainda não terminou'; end if;
  update public.challenge_attempts set status='completed', completed_at=v_now, elapsed_ms=round(extract(epoch from (v_now-started_at))*1000)::bigint, next_allowed_at=null where id=v_attempt.id returning * into v_attempt;
  return jsonb_build_object('completed',true,'elapsed_ms',v_attempt.elapsed_ms,'correct_count',v_attempt.correct_count,'error_count',v_attempt.error_count);
end; $$;

create or replace function public.get_daily_challenge_ranking(p_challenge_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_challenge_id uuid := p_challenge_id;
begin
  if v_challenge_id is null then select id into v_challenge_id from public.daily_challenges where challenge_date=public.current_daily_challenge_date() and status='published'; end if;
  if v_challenge_id is null then return jsonb_build_object('entries','[]'::jsonb,'mine',null); end if;
  return jsonb_build_object('entries',(select coalesce(jsonb_agg(jsonb_build_object('position',position,'name',name,'elapsed_ms',elapsed_ms,'correct_count',correct_count,'error_count',error_count) order by position),'[]'::jsonb) from (select * from (select row_number() over(order by a.elapsed_ms asc,a.error_count asc,a.completed_at asc) position,coalesce(nullif(p.display_name,''),split_part(coalesce(p.email,'Usuário'),'@',1),'Usuário') name,a.elapsed_ms,a.correct_count,a.error_count,a.user_id from public.challenge_attempts a left join public.profiles p on p.id=a.user_id where a.challenge_id=v_challenge_id and a.status='completed') ranked order by position limit 50) top_ranked),'mine',(select jsonb_build_object('position',position,'name',name,'elapsed_ms',elapsed_ms,'correct_count',correct_count,'error_count',error_count) from (select row_number() over(order by a.elapsed_ms asc,a.error_count asc,a.completed_at asc) position,coalesce(nullif(p.display_name,''),split_part(coalesce(p.email,'Usuário'),'@',1),'Usuário') name,a.elapsed_ms,a.correct_count,a.error_count,a.user_id from public.challenge_attempts a left join public.profiles p on p.id=a.user_id where a.challenge_id=v_challenge_id and a.status='completed') ranked where user_id=auth.uid()));
end; $$;

create or replace function public.publish_daily_challenge(p_challenge_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Acesso restrito'; end if;
  update public.daily_challenges set status='published' where id=p_challenge_id and status='draft';
  if not found then raise exception 'Desafio não encontrado ou já publicado'; end if;
end; $$;

-- O perfil zera o desempenho real: respostas e ciclos do próprio usuário.
create or replace function public.reset_my_study_history()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user_id uuid := auth.uid(); v_answers integer := 0; v_cycles integer := 0;
begin
  if v_user_id is null then raise exception 'Autenticação necessária'; end if;
  delete from public.answers where user_id = v_user_id;
  get diagnostics v_answers = row_count;
  delete from public.study_cycles where user_id = v_user_id;
  get diagnostics v_cycles = row_count;
  return jsonb_build_object('answers_removed', v_answers, 'cycles_removed', v_cycles);
end; $$;

revoke all on function public.get_today_daily_challenge() from public;
revoke all on function public.start_today_daily_challenge() from public;
revoke all on function public.submit_daily_challenge_answer(uuid,uuid,boolean) from public;
revoke all on function public.finish_daily_challenge_attempt(uuid) from public;
revoke all on function public.get_daily_challenge_ranking(uuid) from public;
revoke all on function public.publish_daily_challenge(uuid) from public;
revoke all on function public.reset_my_study_history() from public;
grant execute on function public.get_today_daily_challenge(), public.start_today_daily_challenge(), public.submit_daily_challenge_answer(uuid,uuid,boolean), public.finish_daily_challenge_attempt(uuid), public.get_daily_challenge_ranking(uuid), public.publish_daily_challenge(uuid), public.reset_my_study_history() to authenticated;
