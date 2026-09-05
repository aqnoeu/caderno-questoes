-- Tags configuráveis para organizar os cards por concurso.
create table if not exists public.contest_tags (
  contest text primary key,
  label text not null,
  color text not null default '#eaf2ff',
  text_color text not null default '#1458c6',
  updated_at timestamptz not null default now()
);

alter table public.contest_tags enable row level security;
drop policy if exists "contest_tags_read" on public.contest_tags;
create policy "contest_tags_read" on public.contest_tags
  for select to authenticated using (true);
drop policy if exists "contest_tags_admin_write" on public.contest_tags;
create policy "contest_tags_admin_write" on public.contest_tags
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
