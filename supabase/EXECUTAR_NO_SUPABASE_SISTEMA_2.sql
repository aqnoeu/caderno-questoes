-- SISTEMA 2.0 — execute uma única vez no SQL Editor do Supabase.
-- Cria um pipeline isolado e não modifica a tabela public.questions existente.
create table if not exists public.question_imports (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  file_name text not null, concurso text not null, edicao text, ano integer not null check (ano between 1900 and 2100), banca text not null, cargo text, application_date date,
  total_extracted integer not null default 0, total_selected integer not null default 0, import_metadata jsonb not null default '{}'::jsonb
);
create table if not exists public.questions_v2 (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  import_id uuid not null references public.question_imports(id) on delete cascade, question_number integer not null, statement text not null,
  alternatives jsonb not null default '[]'::jsonb, extraction_warnings jsonb not null default '[]'::jsonb, source_page_range text,
  status text not null default 'pending_ai' check (status in ('pending_ai','processing_ai','needs_review','approved')),
  discipline text, subjects jsonb not null default '[]'::jsonb, subtopics jsonb not null default '[]'::jsonb, legal_concepts jsonb not null default '[]'::jsonb, alternatives_analysis jsonb not null default '[]'::jsonb,
  legal_basis text, central_rule text, legal_reasoning text, study_content text, ai_confidence numeric(4,3), ai_attempts integer not null default 0, ai_last_error text, ai_processed_at timestamptz, raw_payload jsonb not null default '{}'::jsonb
);
create index if not exists question_imports_catalog_idx on public.question_imports(concurso, edicao, ano, banca);
create index if not exists questions_v2_status_idx on public.questions_v2(status, created_at);
create index if not exists questions_v2_import_idx on public.questions_v2(import_id, question_number);
create or replace function public.touch_sistema2_updated_at() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists touch_question_imports_updated_at on public.question_imports;
create trigger touch_question_imports_updated_at before update on public.question_imports for each row execute function public.touch_sistema2_updated_at();
drop trigger if exists touch_questions_v2_updated_at on public.questions_v2;
create trigger touch_questions_v2_updated_at before update on public.questions_v2 for each row execute function public.touch_sistema2_updated_at();
alter table public.question_imports enable row level security;
alter table public.questions_v2 enable row level security;
drop policy if exists "question_imports_admin_all" on public.question_imports;
create policy "question_imports_admin_all" on public.question_imports for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "questions_v2_admin_all" on public.questions_v2;
create policy "questions_v2_admin_all" on public.questions_v2 for all to authenticated using (public.is_admin()) with check (public.is_admin());
