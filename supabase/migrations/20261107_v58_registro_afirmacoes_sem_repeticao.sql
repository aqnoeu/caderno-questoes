-- v58: registro interno contra repetição no banco de afirmações do desafio. Nada é apagado.
create or replace function public.challenge_statement_hash(t text)
returns text language sql immutable parallel safe set search_path = public as $$
  select md5(regexp_replace(lower(translate(coalesce(t, ''), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', '', 'g'))
$$;

alter table public.challenge_questions add column if not exists statement_hash text generated always as (public.challenge_statement_hash(statement)) stored;
create unique index if not exists challenge_questions_statement_hash_key on public.challenge_questions(statement_hash);

-- Detecta afirmações muito parecidas (mesmo conteúdo com outras palavras), ignorando as que nasceram da mesma questão de origem.
create or replace function public.find_similar_challenge_statements(p_statement text, p_threshold real default 0.75, p_exclude_source uuid default null)
returns table(id uuid, similarity real) language sql stable security definer set search_path = public as $$
  select q.id, similarity(q.statement, p_statement) as similarity
  from public.challenge_questions q
  where similarity(q.statement, p_statement) >= p_threshold
    and (p_exclude_source is null or q.source_question_id is distinct from p_exclude_source)
  order by 2 desc
  limit 3
$$;
revoke all on function public.find_similar_challenge_statements(text, real, uuid) from public, anon, authenticated;
grant execute on function public.find_similar_challenge_statements(text, real, uuid) to service_role;
