CREATE OR REPLACE FUNCTION public.admin_assign_provisional_questions(
 p_notebook uuid,p_question_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_status text; accepted integer:=0; invalid_count integer:=0; request_count integer;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador'; END IF;
 IF p_question_ids IS NULL OR array_length(p_question_ids,1) IS NULL THEN RAISE EXCEPTION 'Selecione questões para autorizar'; END IF;
 request_count:=array_length(p_question_ids,1);
 IF request_count>100 THEN RAISE EXCEPTION 'Limite de 100 questões por solicitação'; END IF;
 PERFORM 1 FROM public.study_notebooks WHERE id=p_notebook FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Caderno não encontrado'; END IF;
 SELECT review_status INTO current_status FROM public.provisional_notebook_specs WHERE notebook_id=p_notebook FOR UPDATE;
 IF current_status='rejected' THEN RAISE EXCEPTION 'Caderno indisponível para revisão'; END IF;
 -- Administrator makes the final selection; questions must be published and valid.
 SELECT count(*) INTO invalid_count FROM (SELECT DISTINCT unnest(p_question_ids) id) t
 LEFT JOIN public.questions q ON q.id=t.id
 WHERE q.id IS NULL OR q.is_hidden OR q.is_annulled OR q.correct_option IS NULL OR q.correct_option='*';
 IF invalid_count>0 THEN RAISE EXCEPTION 'Uma ou mais questões estão ocultas, anuladas ou incompletas'; END IF;
 INSERT INTO public.notebook_questions(notebook_id,question_id,origin)
 SELECT p_notebook, t.id,'borrowed' FROM (SELECT DISTINCT unnest(p_question_ids) id) t
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS accepted=ROW_COUNT;
 RETURN jsonb_build_object('linked',accepted,'notebook_id',p_notebook);
END $$;
REVOKE ALL ON FUNCTION public.admin_assign_provisional_questions(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_provisional_questions(uuid,uuid[]) TO authenticated;

create or replace function public.release_external_question_import(import_row_id uuid, expected_revision uuid, notebook uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  entry public.external_question_imports;
  p jsonb;
  import_id uuid;
  result_id uuid;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Acesso restrito ao administrador.'; end if;
  select * into entry from public.external_question_imports where id = import_row_id and revision = expected_revision for update;
  if not found or entry.status <> 'ready' or entry.reviewed_at is null or cardinality(entry.missing_fields) > 0 then
    raise exception 'A importação precisa estar conferida e sem pendências.';
  end if;
  p := entry.payload;

  if entry.modality = 'objective' then
    insert into public.question_imports (
      file_name, concurso, banca, ano, cargo, notebook_id, total_extracted, total_selected, import_metadata
    ) values (
      entry.batch_name, p->>'concurso', p->>'banca', (p->>'ano')::integer, nullif(p->>'cargo', ''),
      notebook, 1, 1, jsonb_build_object('external_import_id', entry.id)
    ) returning id into import_id;
    insert into public.questions_v2 (
      import_id, question_number, statement, alternatives, answer_key_option, discipline, subjects,
      difficulty, legal_basis, central_rule, correct_answer_explanation, option_error_analysis,
      status, ai_stage, analysis_steps, raw_payload
    ) values (
      import_id, (p->>'question_number')::integer, p->>'statement', p->'alternatives', p->>'answer_key_option',
      p->>'discipline', p->'subjects', p->>'difficulty', p->>'legal_basis', p->>'central_rule',
      p->>'correct_answer_explanation', p->'option_error_analysis', 'approved', 3,
      '{"classification":"complete","wrong_options":"complete","correct_answer":"complete"}'::jsonb,
      jsonb_build_object('external_import_id', entry.id)
    ) returning id into result_id;
  else
    if notebook is null then raise exception 'Selecione um caderno existente para este item.'; end if;
    insert into public.essay_questions (
      statement, question_number, discipline, subjects, difficulty, banca, ano, concurso, total_points,
      answer_key_text, official_commentary, question_type, source_file, metadata
    ) values (
      p->>'statement', (p->>'question_number')::integer, p->>'discipline',
      (select string_agg(value, ' · ' order by ordinality) from jsonb_array_elements_text(p->'subjects') with ordinality),
      p->>'difficulty', p->>'banca', (p->>'ano')::integer, p->>'concurso', (p->>'total_points')::numeric,
      p->>'answer_key_text', p->>'official_commentary', entry.modality, entry.batch_name,
      jsonb_build_object('external_import_id', entry.id)
    ) returning id into result_id;
    insert into public.notebook_essays (notebook_id, essay_question_id) values (notebook, result_id);
    insert into public.essay_rubric_items (
      essay_question_id, section, subitem, criterion, expected_content, legal_basis, max_points, display_order, required
    )
    select result_id, value->>'section', value->>'subitem', value->>'criterion', value->>'expected_content',
      value->>'legal_basis', (value->>'max_points')::numeric, ordinality - 1, coalesce((value->>'required')::boolean, true)
    from jsonb_array_elements(p->'rubrics') with ordinality;
  end if;

  update public.external_question_imports set status = 'released', released_id = result_id where id = entry.id;
  return result_id;
end;
$$;

create or replace function public.queue_objective_suggestion(suggestion_id uuid, notebook uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  suggestion public.essay_suggestions;
  imported_id uuid;
  question_id uuid;
begin

  if not coalesce(public.is_admin(), false) then
    raise exception 'Apenas administradores podem encaminhar sugestões.';
  end if;

  update public.essay_suggestions set status = 'published'
    where id = suggestion_id and question_type = 'objective' and status = 'approved'
    returning * into suggestion;
  if not found then
    raise exception 'A sugestão precisa estar aprovada e disponível.';
  end if;

  insert into public.question_imports (
    file_name, concurso, ano, banca, cargo, notebook_id, total_extracted, total_selected, import_metadata
  ) values (
    'Sugestão de aluno', suggestion.concurso, suggestion.ano, suggestion.banca,
    nullif(suggestion.contest_cargo, ''), notebook, 1, 1,
    jsonb_build_object('suggestion_id', suggestion.id)
  ) returning id into imported_id;

  insert into public.questions_v2 (
    import_id, question_number, statement, alternatives, answer_key_option, status, raw_payload
  )
  select imported_id, suggestion.question_number, suggestion.statement,
    jsonb_agg(jsonb_build_object('letter', substr('ABCDEFGH', idx::integer, 1), 'text', option_text) order by idx),
    suggestion.answer_key_text, 'pending_ai', jsonb_build_object('suggestion_id', suggestion.id)
  from unnest(suggestion.objective_options) with ordinality as options(option_text, idx)
  returning id into question_id;

  return question_id;
end
$$;

-- Keep older clients from creating official notebooks as a side effect of importing.
create or replace function public.notebook_resolve_v63(
 p_concurso text, p_cargo text default '', p_subjects text[] default array[]::text[],
 p_expected_count integer default 0
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare destination jsonb;
begin
  destination := public.notebook_preview_v63(p_concurso, p_cargo, p_subjects);
  if destination->>'notebook_id' is null then
    raise exception 'Selecione um caderno existente. A importação não cria cadernos.';
  end if;
  return destination || '{"created":false,"borrowed":0}'::jsonb;
end;
$$;

create function public.admin_notebook_candidates(p_notebook uuid, p_limit integer default 150)
returns table(question_id uuid, match_score integer, match_reason text, matched_topic text)
language plpgsql security invoker set search_path = '' as $$
declare notebook_code text;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Acesso restrito ao administrador'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 250 then raise exception 'Limite inválido'; end if;
  select code into notebook_code from public.study_notebooks where id=p_notebook;
  if not found then raise exception 'Caderno não encontrado'; end if;
  if exists (select 1 from public.provisional_notebook_specs where notebook_id=p_notebook) then
    return query select * from public.admin_find_compatible_questions(p_notebook,p_limit);
  elsif notebook_code='oab' then
    return query
    select q.id, 95, 'Questão do Exame de Ordem'::text, 'OAB'::text
    from public.questions q
    where coalesce(q.concurso,'') ~* '(^|[^[:alnum:]])oab([^[:alnum:]]|$)|exame de ordem'
      and not coalesce(q.is_hidden,false) and not coalesce(q.is_annulled,false)
      and q.correct_option is not null and q.correct_option <> '*'
      and not exists (select 1 from public.notebook_questions n where n.notebook_id=p_notebook and n.question_id=q.id)
    order by q.ano desc nulls last, q.id
    limit p_limit;
  else
    raise exception 'Este caderno não tem edital cadastrado. Use a busca manual.';
  end if;
end;
$$;
revoke all on function public.admin_notebook_candidates(uuid, integer) from public, anon;
grant execute on function public.admin_notebook_candidates(uuid, integer) to authenticated;
