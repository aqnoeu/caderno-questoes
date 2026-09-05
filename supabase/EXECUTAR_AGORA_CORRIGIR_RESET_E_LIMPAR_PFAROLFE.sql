-- Correção do botão "Zerar ciclos e desempenho".
-- Esta query mantém os demais usuários intactos e limpa somente pfarolfe@gmail.com agora.

drop policy if exists "answers_delete_own" on public.answers;
create policy "answers_delete_own" on public.answers
  for delete to authenticated using (user_id = auth.uid());

create or replace function public.reset_my_study_history()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_answers integer := 0;
  v_cycles integer := 0;
begin
  if v_user_id is null then
    raise exception 'Autenticação necessária';
  end if;

  delete from public.answers where user_id = v_user_id;
  get diagnostics v_answers = row_count;
  delete from public.study_cycles where user_id = v_user_id;
  get diagnostics v_cycles = row_count;

  return jsonb_build_object('answers_removed', v_answers, 'cycles_removed', v_cycles);
end;
$$;

revoke all on function public.reset_my_study_history() from public;
grant execute on function public.reset_my_study_history() to authenticated;

-- Limpeza imediata da conta administradora atual.
delete from public.answers
where user_id = (select id from auth.users where lower(email) = 'pfarolfe@gmail.com');

delete from public.study_cycles
where user_id = (select id from auth.users where lower(email) = 'pfarolfe@gmail.com');
