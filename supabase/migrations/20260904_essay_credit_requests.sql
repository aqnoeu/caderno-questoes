create table if not exists public.essay_correction_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);
create index if not exists essay_correction_requests_user_idx on public.essay_correction_requests(user_id, status, created_at desc);
alter table public.essay_correction_requests enable row level security;
create policy "essay_credit_requests_own" on public.essay_correction_requests
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "essay_credit_requests_admin" on public.essay_correction_requests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
