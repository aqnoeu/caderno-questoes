-- Perfis e permissões persistidos no Supabase.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cada novo usuário recebe perfil comum; o e-mail definido recebe administração inicial.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when lower(coalesce(new.email, '')) = 'pfarolfe@gmail.com' then 'admin' else 'user' end
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Cria perfis dos usuários já existentes e promove o administrador inicial.
insert into public.profiles (id, email, role)
select id, email, case when lower(coalesce(email, '')) = 'pfarolfe@gmail.com' then 'admin' else 'user' end
from auth.users
on conflict (id) do update set
  email = excluded.email,
  role = case when lower(excluded.email) = 'pfarolfe@gmail.com' then 'admin' else public.profiles.role end;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Metadados do acervo. A migration é compatível com a base já existente.
alter table public.questions add column if not exists banca text;
alter table public.questions add column if not exists ano integer;
alter table public.questions add column if not exists concurso text;
alter table public.questions add column if not exists is_hidden boolean not null default false;
create index if not exists questions_banca_idx on public.questions (banca);
create index if not exists questions_ano_idx on public.questions (ano);
create index if not exists questions_concurso_idx on public.questions (concurso);

-- Histórico mínimo de ciclos para que o painel do aluno apresente dados reais.
create table if not exists public.study_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  total_questions integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  discipline text,
  subject text
);
create index if not exists study_cycles_user_idx on public.study_cycles (user_id, completed_at desc);
alter table public.study_cycles enable row level security;
drop policy if exists "study_cycles_own" on public.study_cycles;
create policy "study_cycles_own" on public.study_cycles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "study_cycles_admin_read" on public.study_cycles;
create policy "study_cycles_admin_read" on public.study_cycles
  for select to authenticated using (public.is_admin());

-- Políticas efetivas: as políticas antigas são substituídas, mas nenhum dado é removido.
-- Usuário comum lê apenas questões visíveis e registra apenas as próprias respostas.
alter table public.questions enable row level security;
do $$
declare policy_name text;
begin
  for policy_name in select policyname from pg_policies where schemaname = 'public' and tablename = 'questions'
  loop execute format('drop policy if exists %I on public.questions', policy_name); end loop;
end $$;
create policy "questions_read_visible" on public.questions
  for select to authenticated using (not is_hidden or public.is_admin());
create policy "questions_admin_all" on public.questions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.answers enable row level security;
do $$
declare policy_name text;
begin
  for policy_name in select policyname from pg_policies where schemaname = 'public' and tablename = 'answers'
  loop execute format('drop policy if exists %I on public.answers', policy_name); end loop;
end $$;
create policy "answers_select_own" on public.answers
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "answers_insert_own" on public.answers
  for insert to authenticated with check (user_id = auth.uid());
create policy "answers_admin_read" on public.answers
  for select to authenticated using (public.is_admin());
