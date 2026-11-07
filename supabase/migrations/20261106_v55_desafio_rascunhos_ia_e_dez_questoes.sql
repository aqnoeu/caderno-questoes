-- v55: desafio diário com 5 ou 10 questões e afirmações geradas pela IA como rascunho. Nada é apagado.

-- Desafios passam a ter tamanho próprio (5 como antes, ou 10). Os já existentes ficam com 5.
alter table public.daily_challenges add column if not exists question_count smallint not null default 5;
alter table public.daily_challenges drop constraint if exists daily_challenges_question_count_check;
alter table public.daily_challenges add constraint daily_challenges_question_count_check check (question_count in (5, 10));

-- Afirmações geradas pela IA entram como rascunho, com a origem registrada.
alter table public.challenge_questions add column if not exists review_status text not null default 'approved';
alter table public.challenge_questions add column if not exists source_kind text not null default 'manual';
alter table public.challenge_questions add column if not exists source_question_id uuid;
alter table public.challenge_questions add column if not exists source_option text;
alter table public.challenge_questions add column if not exists ai_generated boolean not null default false;
alter table public.challenge_questions add column if not exists ai_confidence numeric;
alter table public.challenge_questions add column if not exists ai_note text;
alter table public.challenge_questions drop constraint if exists challenge_questions_review_status_check;
alter table public.challenge_questions add constraint challenge_questions_review_status_check check (review_status in ('draft', 'approved', 'rejected'));
alter table public.challenge_questions drop constraint if exists challenge_questions_source_kind_check;
alter table public.challenge_questions add constraint challenge_questions_source_kind_check check (source_kind in ('manual', 'acervo', 'modelo_novo'));
create unique index if not exists challenge_questions_source_unique on public.challenge_questions(source_kind, source_question_id, correct_answer) where source_question_id is not null;

-- Limites das tabelas de posição e contagem: de 5 para 10.
alter table public.daily_challenge_questions drop constraint if exists daily_challenge_questions_position_check;
alter table public.daily_challenge_questions add constraint daily_challenge_questions_position_check check (position >= 1 and position <= 10);
alter table public.challenge_attempts drop constraint if exists challenge_attempts_correct_count_check;
alter table public.challenge_attempts add constraint challenge_attempts_correct_count_check check (correct_count >= 0 and correct_count <= 10);
alter table public.challenge_attempts drop constraint if exists challenge_attempts_error_count_check;
alter table public.challenge_attempts add constraint challenge_attempts_error_count_check check (error_count >= 0 and error_count <= 10);
alter table public.challenge_attempts drop constraint if exists challenge_attempts_current_position_check;
alter table public.challenge_attempts add constraint challenge_attempts_current_position_check check (current_position >= 0 and current_position <= 10);

create or replace function public.guard_daily_challenge_publish()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    select count(*) into v_count from public.daily_challenge_questions where challenge_id = new.id;
    if v_count <> new.question_count then raise exception 'Um desafio só pode ser publicado com exatamente % questões', new.question_count; end if;
    if exists (select 1 from public.daily_challenge_questions dq join public.challenge_questions q on q.id = dq.question_id where dq.challenge_id = new.id and (q.review_status <> 'approved')) then raise exception 'O desafio contém afirmações ainda não aprovadas'; end if;
    new.published_at := coalesce(new.published_at, now());
    update public.challenge_questions q
      set times_used = q.times_used + 1, last_used_at = new.challenge_date
      from public.daily_challenge_questions dq
      where dq.challenge_id = new.id and dq.question_id = q.id;
  end if;
  return new;
end; $$;

create or replace function public.guard_daily_challenge_questions()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_challenge uuid := coalesce(new.challenge_id, old.challenge_id); v_size smallint;
begin
  if exists (select 1 from public.daily_challenges where id = v_challenge and status = 'published') then
    raise exception 'A composição de um desafio publicado não pode ser alterada';
  end if;
  if new.position is not null then
    select question_count into v_size from public.daily_challenges where id = v_challenge;
    if new.position > coalesce(v_size, 5) then raise exception 'A posição % excede o tamanho do desafio (%)', new.position, v_size; end if;
  end if;
  return coalesce(new, old);
end; $$;

create or replace function public.submit_daily_challenge_answer(p_attempt_id uuid, p_question_id uuid, p_selected_answer boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_attempt public.challenge_attempts%rowtype; v_position smallint; v_correct_answer boolean; v_correct boolean; v_total integer; v_size smallint; v_now timestamptz := now();
begin
  select * into v_attempt from public.challenge_attempts where id=p_attempt_id and user_id=auth.uid() for update;
  if not found then raise exception 'Tentativa inválida'; end if;
  if v_attempt.status <> 'in_progress' then raise exception 'Esta tentativa não aceita novas respostas'; end if;
  if v_attempt.next_allowed_at is not null and v_attempt.next_allowed_at > v_now then raise exception 'Aguarde a correção obrigatória antes de continuar'; end if;
  select question_count into v_size from public.daily_challenges where id = v_attempt.challenge_id;
  select dq.position,q.correct_answer into v_position,v_correct_answer from public.daily_challenge_questions dq join public.challenge_questions q on q.id=dq.question_id where dq.challenge_id=v_attempt.challenge_id and dq.question_id=p_question_id;
  if v_position is null or v_position <> v_attempt.current_position + 1 then raise exception 'A questão não é a próxima do desafio'; end if;
  v_correct := p_selected_answer = v_correct_answer;
  insert into public.challenge_attempt_answers(attempt_id,question_id,selected_answer,correct) values(v_attempt.id,p_question_id,p_selected_answer,v_correct);
  if v_position = v_size and not v_correct then
    update public.challenge_attempts set current_position=v_size, correct_count=correct_count, error_count=error_count+1, status='awaiting_completion', next_allowed_at=v_now + interval '15 seconds' where id=v_attempt.id;
  elsif v_position = v_size then
    update public.challenge_attempts set current_position=v_size, correct_count=correct_count+1, status='completed', completed_at=v_now, elapsed_ms=round(extract(epoch from (v_now-started_at))*1000)::bigint, next_allowed_at=null where id=v_attempt.id;
  else
    update public.challenge_attempts set current_position=v_position, correct_count=correct_count + case when v_correct then 1 else 0 end, error_count=error_count + case when v_correct then 0 else 1 end, next_allowed_at=case when v_correct then null else v_now + interval '15 seconds' end where id=v_attempt.id;
  end if;
  select count(*) into v_total from public.challenge_attempt_answers where attempt_id=v_attempt.id and correct;
  return jsonb_build_object('correct',v_correct,'correct_answer',v_correct_answer,'position',v_position,'is_last',v_position=v_size,'awaiting_completion',v_position=v_size and not v_correct,'next_allowed_at',case when v_correct then null else v_now + interval '15 seconds' end,'correct_count',v_total,'explanation',(select explanation from public.challenge_questions where id=p_question_id),'legal_basis',(select legal_basis from public.challenge_questions where id=p_question_id));
end; $$;

create or replace function public.get_today_daily_challenge()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_challenge public.daily_challenges%rowtype; v_attempt public.challenge_attempts%rowtype;
begin
  select * into v_challenge from public.daily_challenges where challenge_date = public.current_daily_challenge_date() and status = 'published';
  if not found then return jsonb_build_object('available', false); end if;
  select * into v_attempt from public.challenge_attempts where challenge_id = v_challenge.id and user_id = auth.uid();
  return jsonb_build_object('available', true, 'challenge_id', v_challenge.id, 'challenge_date', v_challenge.challenge_date, 'total', v_challenge.question_count, 'attempt', case when found then jsonb_build_object('id',v_attempt.id,'status',v_attempt.status,'started_at',v_attempt.started_at,'completed_at',v_attempt.completed_at,'elapsed_ms',v_attempt.elapsed_ms,'correct_count',v_attempt.correct_count,'error_count',v_attempt.error_count,'current_position',v_attempt.current_position,'next_allowed_at',v_attempt.next_allowed_at) else null end, 'questions', (select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'position',dq.position,'statement',q.statement,'discipline',q.discipline,'subject',q.subject) order by dq.position),'[]'::jsonb) from public.daily_challenge_questions dq join public.challenge_questions q on q.id=dq.question_id where dq.challenge_id=v_challenge.id));
end; $$;
