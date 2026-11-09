create table public.essay_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'published')),
  question_type text not null check (question_type in ('discursive', 'piece')),
  statement text not null check (char_length(btrim(statement)) between 1 and 50000),
  answer_key_text text not null check (char_length(btrim(answer_key_text)) between 1 and 50000),
  concurso text not null check (char_length(btrim(concurso)) between 1 and 300),
  banca text not null check (char_length(banca) <= 200),
  ano integer check (ano between 1900 and 2200),
  question_number integer check (question_number > 0),
  discipline text not null check (char_length(discipline) <= 200),
  contest_cargo text not null check (char_length(contest_cargo) <= 300)
);

alter table public.essay_suggestions enable row level security;
revoke all on public.essay_suggestions from public, anon, authenticated;
grant select on public.essay_suggestions to authenticated;
grant insert (question_type, statement, answer_key_text, concurso, banca, ano,
  question_number, discipline, contest_cargo) on public.essay_suggestions to authenticated;
grant update (status) on public.essay_suggestions to authenticated;

create index essay_suggestions_author_idx on public.essay_suggestions (user_id, created_at desc);
create index essay_suggestions_queue_idx on public.essay_suggestions (created_at desc)
  where status in ('pending', 'approved');

create policy essay_suggestions_read on public.essay_suggestions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy essay_suggestions_submit on public.essay_suggestions for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');
create policy essay_suggestions_review on public.essay_suggestions for update to authenticated
  using ((select public.is_admin()) and status in ('pending', 'approved'))
  with check ((select public.is_admin()) and status in ('approved', 'rejected', 'published'));

create function public.publish_essay_suggestion(suggestion_id uuid, notebook uuid, essay jsonb, criteria jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  entry public.essay_questions;
  new_id uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Apenas administradores podem cadastrar sugestões.';
  end if;

  update public.essay_suggestions set status = 'published'
    where id = suggestion_id and status = 'approved' and question_type = essay->>'question_type';
  if not found then
    raise exception 'A sugestão precisa estar aprovada e disponível para cadastro.';
  end if;

  if jsonb_array_length(criteria) < 1 then
    raise exception 'Revise os critérios do espelho antes de cadastrar.';
  end if;

  entry := jsonb_populate_record(null::public.essay_questions, essay);
  insert into public.essay_questions (statement, question_number, discipline, subjects, difficulty,
    banca, ano, concurso, application_date, total_points, answer_key_text, official_commentary,
    question_type, source_file, metadata)
  values (entry.statement, entry.question_number, entry.discipline, entry.subjects, entry.difficulty,
    entry.banca, entry.ano, entry.concurso, entry.application_date, entry.total_points, entry.answer_key_text,
    entry.official_commentary, entry.question_type, entry.source_file, entry.metadata)
  returning id into new_id;

  insert into public.notebook_essays (notebook_id, essay_question_id) values (notebook, new_id);
  insert into public.essay_rubric_items (essay_question_id, section, subitem, criterion,
    expected_content, legal_basis, max_points, display_order, required)
  select new_id, r.section, r.subitem, r.criterion, r.expected_content, r.legal_basis,
    r.max_points, r.display_order, r.required
  from jsonb_populate_recordset(null::public.essay_rubric_items, criteria) as r;
end;
$$;

revoke execute on function public.publish_essay_suggestion(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.publish_essay_suggestion(uuid, uuid, jsonb, jsonb) to authenticated;
