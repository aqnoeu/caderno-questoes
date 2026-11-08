-- Uma execução = questão completa. Intervalo e limite diário somente ENTRE questões.
alter table public.system2_ai_settings
  add column if not exists active_question_id uuid,
  add column if not exists active_run_id uuid,
  add column if not exists active_claimed_at timestamptz,
  add column if not exists last_finished_at timestamptz;

create or replace function public.claim_system2_full_question(
  p_trigger text default 'scheduled',
  p_question_id uuid default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 settings public.system2_ai_settings%rowtype;
 item public.questions_v2%rowtype;
 v_run uuid;
 v_daily integer;
 v_touched_today boolean;
begin
 if p_trigger not in ('scheduled','manual') then
  raise exception 'Gatilho inválido';
 end if;
 select * into settings from public.system2_ai_settings where id=true for update;
 if not found then raise exception 'Configuração de automação não encontrada'; end if;
 if not settings.enabled and p_trigger='scheduled' then
  return jsonb_build_object('claimed',false,'reason','Automação pausada');
 end if;
 -- A primeira chamada mantém a posse da questão até concluir as três etapas.
 if settings.active_question_id is not null then
  if settings.active_claimed_at > now()-interval '12 minutes' then
   return jsonb_build_object('claimed',false,'reason','Uma questão já está sendo analisada','question_id',settings.active_question_id);
  end if;
  -- Recupera execuções que excederam o tempo limite, sem perder etapas concluídas.
  update public.system2_ai_runs set status='failed',finished_at=now(),
   error_message='Execução interrompida; retomada a partir da última etapa salva'
   where id=settings.active_run_id and status='processing';
  update public.questions_v2 set status='pending_ai',next_attempt_at=now(),
   ai_last_error='Execução interrompida; etapas anteriores preservadas'
   where id=settings.active_question_id and status='processing_ai' and ai_stage<3;
  update public.system2_ai_settings set active_question_id=null,active_run_id=null,
   active_claimed_at=null,last_finished_at=now(),updated_at=now() where id=true;
  return jsonb_build_object('claimed',false,'reason','Execução anterior recuperada; retomada após o intervalo');
 end if;
 if settings.last_finished_at is not null and
  settings.last_finished_at > now()-make_interval(mins=>settings.min_interval_minutes) then
  return jsonb_build_object('claimed',false,'reason','Intervalo entre questões em andamento');
 end if;
 if p_question_id is not null then
  select * into item from public.questions_v2 where id=p_question_id
   and status in ('pending_ai','processing_ai') and ai_stage<3
   and (next_attempt_at is null or next_attempt_at<=now())
   for update skip locked;
 else
  -- Concluir QUESTÕES INICIADAS antes de chamar novas: primeiro a mais antiga.
  select * into item from public.questions_v2
   where status in ('pending_ai','processing_ai') and ai_stage<3
    and (next_attempt_at is null or next_attempt_at<=now())
   order by case when ai_stage>0 then 0 else 1 end,created_at asc
   for update skip locked limit 1;
 end if;
 if not found then return jsonb_build_object('claimed',false,'reason','Nenhuma questão pronta para análise'); end if;
 select count(distinct question_id) into v_daily from public.system2_ai_runs
  where started_at>=date_trunc('day',now()) and started_at<date_trunc('day',now())+interval '1 day'
   and question_id is not null and status in ('processing','approved','needs_review','failed');
 select exists(select 1 from public.system2_ai_runs where question_id=item.id
  and started_at>=date_trunc('day',now()) and started_at<date_trunc('day',now())+interval '1 day')
  into v_touched_today;
 if v_daily>=settings.max_per_day and not v_touched_today then
  return jsonb_build_object('claimed',false,'reason','Limite diário de questões atingido');
 end if;
 update public.questions_v2 set status='processing_ai',ai_attempts=ai_attempts+1,
  ai_last_error=null,next_attempt_at=null where id=item.id;
 insert into public.system2_ai_runs(question_id,trigger_source,status,result_summary)
  values(item.id,p_trigger,'processing',
  jsonb_build_object('starting_stage',item.ai_stage+1,'mode','complete_question'))
  returning id into v_run;
 update public.system2_ai_settings set active_question_id=item.id,active_run_id=v_run,
  active_claimed_at=now(),last_started_at=now(),updated_at=now() where id=true;
 return jsonb_build_object('claimed',true,'question_id',item.id,'run_id',v_run,
  'starting_stage',item.ai_stage+1,'daily_unique_questions',v_daily);
end
$$;

create or replace function public.finish_system2_full_question(
 p_question_id uuid,
 p_run_id uuid,
 p_run_status text,
 p_summary jsonb default '{}'::jsonb,
 p_error text default null
) returns boolean
language plpgsql security definer set search_path=public as $$
declare settings public.system2_ai_settings%rowtype;
begin
 if p_run_status not in ('approved','needs_review','failed') then raise exception 'Status de finalização inválido'; end if;
 select * into settings from public.system2_ai_settings where id=true for update;
 if settings.active_question_id is distinct from p_question_id
   or settings.active_run_id is distinct from p_run_id then
   return false;
 end if;
 update public.system2_ai_runs set status=p_run_status,finished_at=now(),
  result_summary=coalesce(p_summary,'{}'::jsonb),error_message=p_error
  where id=p_run_id and question_id=p_question_id;
 update public.system2_ai_settings set active_question_id=null,active_run_id=null,
   active_claimed_at=null,last_finished_at=now(),updated_at=now() where id=true;
 return true;
end
$$;
revoke all on function public.claim_system2_full_question(text,uuid) from public,anon,authenticated;
revoke all on function public.finish_system2_full_question(uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_system2_full_question(text,uuid) to service_role;
grant execute on function public.finish_system2_full_question(uuid,uuid,text,jsonb,text) to service_role;
