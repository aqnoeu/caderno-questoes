-- Ciclos persistentes por usuário: a composição e o progresso não dependem do navegador.
alter table public.profiles add column if not exists display_name text;

alter table public.study_cycles add column if not exists question_ids uuid[] not null default '{}';
alter table public.study_cycles add column if not exists progress jsonb not null default '[]'::jsonb;
alter table public.study_cycles add column if not exists current_position integer not null default 0;
alter table public.study_cycles add column if not exists selected_option text;
alter table public.study_cycles add column if not exists is_checked boolean not null default false;
alter table public.study_cycles add column if not exists banca text;
alter table public.study_cycles add column if not exists ano integer;
alter table public.study_cycles add column if not exists concurso text;
alter table public.study_cycles add column if not exists answer_count integer not null default 0;
alter table public.study_cycles add column if not exists correct_count integer not null default 0;
alter table public.study_cycles add column if not exists wrong_count integer not null default 0;
alter table public.study_cycles add column if not exists skipped_count integer not null default 0;
alter table public.study_cycles add column if not exists closed_at timestamptz;
alter table public.study_cycles add column if not exists summary jsonb not null default '{}'::jsonb;
create index if not exists study_cycles_active_user_idx on public.study_cycles (user_id, started_at desc) where completed_at is null;

-- Permite ao dono zerar o próprio histórico no Perfil.
drop policy if exists "answers_delete_own" on public.answers;
create policy "answers_delete_own" on public.answers for delete to authenticated using (user_id = auth.uid());

-- O usuário edita nome/e-mail no perfil, mas não pode elevar o próprio role.
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'A permissão do perfil só pode ser alterada por administrador';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_role_before_update on public.profiles;
create trigger protect_profile_role_before_update before update on public.profiles
for each row execute function public.protect_profile_role();
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
