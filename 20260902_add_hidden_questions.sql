alter table public.questions
  add column if not exists is_hidden boolean not null default false;
