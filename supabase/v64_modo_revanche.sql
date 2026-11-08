-- v64: Revanche independente de pontuação/resultado do ciclo original.
create table if not exists public.revenge_sessions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 notebook_id uuid not null references public.study_notebooks(id) on delete cascade,
 cycle_id uuid not null references public.study_cycles(id) on delete cascade,
 question_ids uuid[] not null default '{}',
 current_index integer not null default 0,
 state text not null default 'active' check (state in ('active','completed')),
 mastered_count integer not null default 0,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(user_id,cycle_id),
 check (current_index>=0 and mastered_count>=0)
);
create index if not exists revenge_sessions_user_notebook on public.revenge_sessions(user_id,notebook_id,created_at desc);
create table if not exists public.revenge_items (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.revenge_sessions(id) on delete cascade,
 question_id uuid not null references public.questions(id) on delete cascade,
 statements jsonb not null,
 answers jsonb not null default '[]'::jsonb,
 completed boolean not null default false,
 mastered boolean not null default false,
 provider_info jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 unique(session_id,question_id),
 check (jsonb_typeof(statements)='array' and jsonb_array_length(statements)=2),
 check (jsonb_typeof(answers)='array' and jsonb_array_length(answers)<=2)
);
alter table public.revenge_sessions enable row level security;
alter table public.revenge_items enable row level security;
-- Somente Edge Function autenticada via service_role pode ler/gabaritar itens.
revoke all on public.revenge_sessions from anon,authenticated;
revoke all on public.revenge_items from anon,authenticated;
grant all on public.revenge_sessions to service_role;
grant all on public.revenge_items to service_role;
comment on table public.revenge_sessions is 'Sessões de Revanche vinculadas a ciclos completos; não alteram answers nem study_cycles.';
comment on table public.revenge_items is 'Pares de afirmações verificadas pelo Gemini; acesso somente por Edge Function.';
