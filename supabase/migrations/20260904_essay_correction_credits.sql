-- Quatro correções por mês; créditos extras são emitidos individualmente pelo administrador.
create table if not exists public.essay_correction_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  used_for_attempt_id uuid references public.essay_attempts(id) on delete set null
);
create index if not exists essay_correction_credits_user_idx on public.essay_correction_credits(user_id, used_at);
alter table public.essay_correction_credits enable row level security;
create policy "essay_correction_credits_admin" on public.essay_correction_credits
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
