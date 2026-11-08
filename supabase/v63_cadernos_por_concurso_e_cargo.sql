-- v63: cadernos por concurso e cargo, nunca por ano/edicao da prova.
alter table public.study_notebooks add column if not exists identity_key text;
alter table public.study_notebooks add column if not exists cargo text;
alter table public.study_notebooks add column if not exists is_auto_generated boolean not null default false;
create unique index if not exists idx_study_notebook_identity_v63
  on public.study_notebooks(identity_key) where identity_key is not null;
alter table public.notebook_questions add column if not exists origin text not null default 'own';
alter table public.notebook_questions drop constraint if exists notebook_questions_origin_check;
alter table public.notebook_questions add constraint notebook_questions_origin_check check (origin in ('own','borrowed'));

create or replace function public.notebook_identity_v63(p_concurso text,p_cargo text)
returns text language plpgsql immutable set search_path='public' as $$
declare
 n text;
 c text;
begin
 n:=lower(translate(coalesce(p_concurso,''),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'));
 n:=regexp_replace(n,'[[:punct:]]',' ','g');
 n:=regexp_replace(n,'\m([12][0-9]{3}|[0-9]{1,3}(a|o|ª|º))\M','','g');
 n:=regexp_replace(n,'\m(edicao|edital|ano|prova|aplicacao|exame numero|concurso publico)\M','','g');
 n:=regexp_replace(n,'[[:space:]]+',' ','g');
 n:=btrim(n);
 if n ~ '(^| )(oab|exame de ordem|ordem dos advogados do brasil)( |$)' then return 'oab'; end if;
 c:=lower(translate(coalesce(p_cargo,''),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'));
 c:=btrim(regexp_replace(regexp_replace(c,'[[:punct:]]',' ','g'),'[[:space:]]+',' ','g'));
 if n='' then return ''; end if;
 if c='' then return ''; end if;
 return 'concurso:'||n||'|cargo:'||c;
end;
$$;

create or replace function public.notebook_preview_v63(
 p_concurso text,
 p_cargo text default '',
 p_subjects text[] default array[]::text[]
) returns jsonb language plpgsql security invoker set search_path='public' as $$
declare
 k text; existing record; proposed text;
begin
 if not public.is_admin() then raise exception 'Acesso restrito ao administrador'; end if;
 k:=public.notebook_identity_v63(p_concurso,p_cargo);
 if k='' then return jsonb_build_object('ready',false,'reason','Informe o nome do concurso e o cargo para identificar o caderno.','identity_key',k); end if;
 if k='oab' then
  select id,title,code into existing from public.study_notebooks where code='oab' limit 1;
 else
  select id,title,code into existing from public.study_notebooks where identity_key=k limit 1;
 end if;
 if existing.id is not null then
  return jsonb_build_object('ready',true,'matched',true,'notebook_id',existing.id,'title',existing.title,'identity_key',k,'borrowing',false);
 end if;
 proposed:=case when k='oab' then 'OAB' else concat(btrim(p_cargo),' — ',btrim(regexp_replace(regexp_replace(regexp_replace(p_concurso,'\\m(19|20)[0-9]{2}\\M','','g'),'\\m[0-9]{1,3}[ºª]\\M','','g'),'[[:space:]]+',' ','g'))) end;
 return jsonb_build_object('ready',true,'matched',false,'notebook_id',null,'title',proposed,'identity_key',k,'borrowing',coalesce(array_length(p_subjects,1),0)>0);
end;
$$;

create or replace function public.notebook_resolve_v63(
 p_concurso text,
 p_cargo text default '',
 p_subjects text[] default array[]::text[]
) returns jsonb language plpgsql security invoker set search_path='public' as $$
declare
 preview jsonb; k text; v_id uuid; created boolean:=false; borrowed integer:=0;
begin
 if not public.is_admin() then raise exception 'Acesso restrito ao administrador'; end if;
 preview:=public.notebook_preview_v63(p_concurso,p_cargo,p_subjects);
 if not coalesce((preview->>'ready')::boolean,false) then raise exception '%',preview->>'reason'; end if;
 k:=preview->>'identity_key';
 perform pg_advisory_xact_lock(hashtext('notebook:'||k));
 if k='oab' then
  select id into v_id from public.study_notebooks where code='oab' limit 1;
 else
  select id into v_id from public.study_notebooks where identity_key=k limit 1;
 end if;
 if v_id is null then
  insert into public.study_notebooks(code,title,kind,visibility,source_concurso,cargo,identity_key,is_auto_generated)
  values('auto-'||substr(md5(k),1,22),preview->>'title','contest','official',
         btrim(p_concurso),nullif(btrim(p_cargo),''),k,true)
  returning id into v_id;
  created:=true;

  -- Aproveitamento SOMENTE ao criar caderno com menos de 10 questoes.
  -- Apenas questoes publicadas com materia ou assunto explicitamente correspondente.
  if coalesce(array_length(p_subjects,1),0)>0 then
    with matched as (
      select distinct q.id
      from public.questions q
      join public.notebook_questions source on source.question_id=q.id
      where q.is_hidden=false and coalesce(q.is_annulled,false)=false
        and q.correct_option is not null and q.correct_option<>'*'
        and exists (
          select 1 from unnest(p_subjects) term
          where length(btrim(term))>=4 and (
            lower(btrim(q.discipline))=lower(btrim(term))
            or lower(btrim(coalesce(q.subject,'')))=lower(btrim(term))
            or exists (
              select 1 from jsonb_array_elements_text(
                case when jsonb_typeof(q.subjects)='array' then q.subjects else '[]'::jsonb end
              ) x(value) where lower(btrim(x.value))=lower(btrim(term))
            )
          )
        )
      order by q.id
      limit 10
    ), inserted as (
      insert into public.notebook_questions(notebook_id,question_id,origin)
      select v_id,id,'borrowed' from matched on conflict do nothing returning 1
    )
    select count(*) into borrowed from inserted;
  end if;
 end if;
 return jsonb_build_object('ready',true,'notebook_id',v_id,'title',coalesce(preview->>'title',
   (select title from public.study_notebooks where id=v_id)),
   'created',created,'borrowed',borrowed,'identity_key',k);
end;
$$;

-- OAB é caderno especial independente de numero de exame, edicao e banca.
update public.study_notebooks set identity_key='oab' where code='oab' and identity_key is null;

grant execute on function public.notebook_identity_v63(text,text) to authenticated;
grant execute on function public.notebook_preview_v63(text,text,text[]) to authenticated;
grant execute on function public.notebook_resolve_v63(text,text,text[]) to authenticated;
