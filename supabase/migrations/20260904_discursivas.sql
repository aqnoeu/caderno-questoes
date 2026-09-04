-- Modalidade discursiva. A peça prático-profissional fica expressamente fora deste modelo.
create table if not exists public.essay_questions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_hidden boolean not null default false,
  statement text not null,
  question_number integer,
  discipline text,
  subjects text,
  difficulty text not null default 'media' check (difficulty in ('facil','media','dificil')),
  banca text,
  ano integer,
  concurso text,
  application_date date,
  total_points numeric(6,2) not null default 0,
  answer_key_text text,
  official_commentary text,
  source_reference text,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists essay_questions_catalog_idx on public.essay_questions (concurso, banca, ano);

create table if not exists public.essay_rubric_items (
  id uuid primary key default gen_random_uuid(),
  essay_question_id uuid not null references public.essay_questions(id) on delete cascade,
  section text,
  subitem text,
  criterion text not null,
  expected_content text,
  legal_basis text,
  max_points numeric(6,2) not null default 0,
  display_order integer not null default 0,
  required boolean not null default false
);

create table if not exists public.essay_attempts (
  id uuid primary key default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  essay_question_id uuid not null references public.essay_questions(id) on delete cascade,
  answer_text text not null default '',
  submitted_at timestamptz,
  corrected_at timestamptz,
  score numeric(6,2),
  percentage numeric(6,2),
  ai_feedback jsonb,
  status text not null default 'draft' check (status in ('draft','submitted','corrected')),
  version integer not null default 1,
  unique(user_id, essay_question_id, version)
);
create index if not exists essay_attempts_user_idx on public.essay_attempts (user_id, essay_question_id, updated_at desc);

create table if not exists public.essay_attempt_criteria (
  id uuid primary key default gen_random_uuid(),
  essay_attempt_id uuid not null references public.essay_attempts(id) on delete cascade,
  essay_rubric_item_id uuid not null references public.essay_rubric_items(id) on delete cascade,
  achieved_points numeric(6,2) not null default 0,
  status text not null check (status in ('hit','partial','missed')),
  feedback text,
  evidence_excerpt text,
  display_order integer not null default 0
);

alter table public.essay_questions enable row level security;
alter table public.essay_rubric_items enable row level security;
alter table public.essay_attempts enable row level security;
alter table public.essay_attempt_criteria enable row level security;

create policy "essay_questions_read_visible" on public.essay_questions for select to authenticated using (not is_hidden or public.is_admin());
create policy "essay_questions_admin_write" on public.essay_questions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "essay_rubric_read" on public.essay_rubric_items for select to authenticated using (exists (select 1 from public.essay_questions q where q.id = essay_question_id and (not q.is_hidden or public.is_admin())));
create policy "essay_rubric_admin_write" on public.essay_rubric_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "essay_attempts_own" on public.essay_attempts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "essay_attempt_criteria_own" on public.essay_attempt_criteria for select to authenticated using (exists (select 1 from public.essay_attempts a where a.id = essay_attempt_id and a.user_id = auth.uid()));
create policy "essay_attempt_criteria_insert_own" on public.essay_attempt_criteria for insert to authenticated with check (exists (select 1 from public.essay_attempts a where a.id = essay_attempt_id and a.user_id = auth.uid()));
