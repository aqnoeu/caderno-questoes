create function public.valid_objective_options(options text[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    array_ndims(options) = 1 and array_lower(options, 1) = 1
    and cardinality(options) between 2 and 8
    and not exists (
      select from unnest(options) as item(value)
      where value is null or char_length(btrim(value)) not between 1 and 10000
    ), false
  )
$$;

alter table public.essay_suggestions
  add column objective_options text[],
  drop constraint essay_suggestions_question_type_check,
  add constraint essay_suggestions_question_type_check
    check (question_type in ('discursive', 'piece', 'objective')),
  add constraint essay_suggestions_objective_check check (
    case when question_type = 'objective' then
      public.valid_objective_options(objective_options)
      and answer_key_text ~ '^[A-H]$'
      and strpos('ABCDEFGH', answer_key_text) <= cardinality(objective_options)
      and ano is not null and ano <= 2100
      and question_number is not null and char_length(btrim(banca)) > 0
    else objective_options is null end
  );
grant insert (objective_options) on public.essay_suggestions to authenticated;

create function public.queue_objective_suggestion(suggestion_id uuid, notebook uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  suggestion public.essay_suggestions;
  imported_id uuid;
  question_id uuid;
begin
  if notebook is null then
    raise exception 'Informe o caderno de destino.';
  end if;

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
revoke execute on function public.queue_objective_suggestion(uuid, uuid) from public, anon;
grant execute on function public.queue_objective_suggestion(uuid, uuid) to authenticated;
