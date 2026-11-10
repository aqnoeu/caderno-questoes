create or replace function public.admin_notebook_candidates(p_notebook uuid, p_limit integer default 150)
returns table(question_id uuid, match_score integer, match_reason text, matched_topic text)
language plpgsql security invoker set search_path = '' as $$
declare notebook_code text;
begin
  if not coalesce(public.is_admin(), false) then raise exception 'Acesso restrito ao administrador'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 250 then raise exception 'Limite inválido'; end if;
  select code into notebook_code from public.study_notebooks where id=p_notebook;
  if not found then raise exception 'Caderno não encontrado'; end if;
  if notebook_code='oab' then
    return query
    select q.id, 95, 'Questão do Exame de Ordem'::text, 'OAB'::text
    from public.questions q
    where (
      coalesce(q.concurso,'') ~* '(^|[^[:alnum:]])oab([^[:alnum:]]|$)|exame de ordem'
      or exists (
        select 1 from jsonb_array_elements_text(
          case when jsonb_typeof(q.subjects)='array' then q.subjects else '[]'::jsonb end
        ) as tag(value) where lower(btrim(tag.value))='oab'
      )
      or exists (
        select 1 from regexp_split_to_table(coalesce(q.subject,''), '[;|·•]') as tag(value)
        where lower(btrim(tag.value))='oab'
      )
    )
      and not coalesce(q.is_hidden,false) and not coalesce(q.is_annulled,false)
      and q.correct_option is not null and q.correct_option <> '*'
      and not exists (select 1 from public.notebook_questions n where n.notebook_id=p_notebook and n.question_id=q.id)
    order by q.ano desc nulls last, q.id
    limit p_limit;
  elsif exists (select 1 from public.provisional_notebook_specs where notebook_id=p_notebook) then
    return query select * from public.admin_find_compatible_questions(p_notebook,p_limit);
  else
    raise exception 'Este caderno não tem edital cadastrado. Use a busca manual.';
  end if;
end;
$$;
revoke all on function public.admin_notebook_candidates(uuid, integer) from public, anon;
grant execute on function public.admin_notebook_candidates(uuid, integer) to authenticated;
