create table public.external_question_imports (
  id uuid primary key default gen_random_uuid(),
  batch_name text not null check (char_length(btrim(batch_name)) between 1 and 300),
  modality text not null check (modality in ('objective', 'discursive', 'piece')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 150000),
  revision uuid not null default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'incomplete', 'ready', 'released')),
  missing_fields text[] not null default '{}',
  reviewed_at timestamptz,
  released_id uuid,
  created_at timestamptz not null default now()
);

alter table public.external_question_imports enable row level security;
revoke all on public.external_question_imports from public, anon, authenticated;
grant select on public.external_question_imports to authenticated;
grant insert (batch_name, modality, payload), update (payload)
  on public.external_question_imports to authenticated;
grant select, insert, update on public.external_question_imports to service_role;
create policy external_import_admin_read on public.external_question_imports for select to authenticated
  using ((select public.is_admin()));
create policy external_import_admin_insert on public.external_question_imports for insert to authenticated
  with check ((select public.is_admin()));
create policy external_import_admin_update on public.external_question_imports for update to authenticated
  using ((select public.is_admin()) and status <> 'released')
  with check ((select public.is_admin()));
create index external_import_status_idx on public.external_question_imports (status, created_at desc);

create function public.reset_external_import_review()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.payload, new.modality) is distinct from (old.payload, old.modality) then
    if old.status = 'released' then raise exception 'Importação já encaminhada.'; end if;
    new.revision := gen_random_uuid();
    new.status := 'pending';
    new.missing_fields := '{}';
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;
create trigger reset_external_import_review before update on public.external_question_imports
  for each row execute function public.reset_external_import_review();

-- Objective payload uses questions_v2 fields and contest metadata.
-- Essay payload uses essay_questions fields, with subjects as an array and rubrics as an array.
create function public.release_external_question_import(import_row_id uuid, expected_revision uuid, notebook uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  entry public.external_question_imports;
  p jsonb;
  import_id uuid;
  result_id uuid;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Acesso restrito ao administrador.'; end if;
  if notebook is null then raise exception 'Informe o caderno de destino.'; end if;
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
revoke execute on function public.release_external_question_import(uuid, uuid, uuid) from public, anon;
grant execute on function public.release_external_question_import(uuid, uuid, uuid) to authenticated;
