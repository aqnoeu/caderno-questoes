create function public.admin_delete_notebook(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.is_admin(), false) then
    raise exception 'Acesso restrito ao administrador.';
  end if;

  perform 1 from public.study_notebooks where id = p_id for update;
  if not found then
    raise exception 'Caderno não encontrado.';
  end if;

  if exists (select 1 from public.study_plans where notebook_id = p_id)
    or exists (select 1 from public.revenge_sessions where notebook_id = p_id) then
    raise exception 'Este caderno tem planejamento ou histórico de Revanche. A exclusão apagaria esses registros.';
  end if;

  delete from public.study_notebooks where id = p_id;
end;
$$;

revoke all on function public.admin_delete_notebook(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_notebook(uuid) to authenticated;
