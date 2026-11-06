-- Análise pedagógica em três etapas: classificação, diagnóstico por alternativa
-- e explicação final. Mantém o novo acervo isolado do banco atual.
alter table public.questions_v2 add column if not exists ai_stage smallint not null default 0 check (ai_stage between 0 and 3);
alter table public.questions_v2 add column if not exists analysis_steps jsonb not null default '{"classification":"pending","wrong_options":"pending","correct_answer":"pending"}'::jsonb;
alter table public.questions_v2 add column if not exists option_error_analysis jsonb not null default '{}'::jsonb;
alter table public.questions_v2 add column if not exists correct_answer_explanation text;
alter table public.questions_v2 add column if not exists is_test boolean not null default false;
alter table public.questions_v2 add column if not exists promoted_question_id uuid references public.questions(id) on delete set null;
create index if not exists questions_v2_pipeline_stage_idx on public.questions_v2(status, ai_stage, next_attempt_at);

-- v53: renomeia a assinatura antiga (só p_trigger) para não ficar duas funções com o mesmo nome,
-- o que tornaria ambígua a chamada feita pelo agendamento. Nada é apagado.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'claim_system2_ai_question' and pronargs = 1 and pronamespace = 'public'::regnamespace) then
    alter function public.claim_system2_ai_question(text) rename to claim_system2_ai_question_antiga;
  end if;
end $$;

create or replace function public.claim_system2_ai_question(p_trigger text default 'scheduled', p_question_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare settings public.system2_ai_settings%rowtype; item public.questions_v2%rowtype; run_id uuid; today_count integer;
begin
  select * into settings from public.system2_ai_settings where id = true for update;
  if not settings.enabled and p_trigger <> 'manual' then return jsonb_build_object('claimed', false, 'reason', 'A automação está pausada.'); end if;
  if p_trigger <> 'manual' and settings.last_started_at is not null and settings.last_started_at > now() - make_interval(mins => settings.min_interval_minutes) then return jsonb_build_object('claimed', false, 'reason', 'Aguardando o intervalo configurado.'); end if;
  select count(*) into today_count from public.system2_ai_runs where started_at >= date_trunc('day', now()) and status in ('processing', 'approved', 'needs_review', 'failed');
  if today_count >= settings.max_per_day then return jsonb_build_object('claimed', false, 'reason', 'Limite diário de análises atingido.'); end if;
  if p_question_id is not null then
    select * into item from public.questions_v2 where id = p_question_id and status in ('pending_ai','processing_ai','needs_review') and ai_stage < 3 for update skip locked;
  else
    select * into item from public.questions_v2 where status in ('pending_ai','processing_ai') and ai_stage < 3 and (next_attempt_at is null or next_attempt_at <= now()) order by created_at asc for update skip locked limit 1;
  end if;
  if not found then return jsonb_build_object('claimed', false, 'reason', 'Não há questão disponível para esta etapa.'); end if;
  update public.questions_v2 set status = 'processing_ai', ai_attempts = ai_attempts + 1, ai_last_error = null, next_attempt_at = null where id = item.id;
  insert into public.system2_ai_runs(question_id, trigger_source, status, result_summary) values (item.id, case when p_trigger = 'manual' then 'manual' else 'scheduled' end, 'processing', jsonb_build_object('stage', item.ai_stage + 1)) returning id into run_id;
  update public.system2_ai_settings set last_started_at = now(), updated_at = now() where id = true;
  return jsonb_build_object('claimed', true, 'run_id', run_id, 'question_id', item.id, 'stage', item.ai_stage + 1);
end;
$$;
revoke all on function public.claim_system2_ai_question(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_system2_ai_question(text, uuid) to service_role;

create or replace function public.promote_question_v2(p_question_id uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare q public.questions_v2%rowtype; new_id uuid; subject_text text;
begin
  if not public.is_admin() then raise exception 'Acesso restrito'; end if;
  select * into q from public.questions_v2 where id = p_question_id and status = 'approved' and is_test = false for update;
  if not found then raise exception 'A questão não está aprovada para promoção'; end if;
  if q.promoted_question_id is not null then return q.promoted_question_id; end if;
  select string_agg(value, ' · ') into subject_text from jsonb_array_elements_text(q.subjects) value;
  insert into public.questions (user_id, statement, alternatives, correct_option, discipline, subject, explanation, normalized_statement, original_number, is_annulled, difficulty_initial, difficulty_current, ai_confidence, ai_analyzed_at, banca, ano, concurso, is_hidden)
  select auth.uid(), q.statement, q.alternatives, q.answer_key_option, q.discipline, subject_text, coalesce(q.correct_answer_explanation, q.central_rule, ''), lower(q.statement), q.question_number, q.answer_key_option = '*', coalesce(q.difficulty, 'media'), coalesce(q.difficulty, 'media'), q.ai_confidence, q.ai_processed_at, i.banca, i.ano, i.concurso, false from public.question_imports i where i.id = q.import_id
  returning id into new_id;
  update public.questions_v2 set promoted_question_id = new_id, updated_at = now() where id = q.id;
  return new_id;
end;
$$;
revoke all on function public.promote_question_v2(uuid) from public, anon;
grant execute on function public.promote_question_v2(uuid) to authenticated;
