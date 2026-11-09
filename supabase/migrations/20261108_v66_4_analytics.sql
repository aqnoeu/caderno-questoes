CREATE FUNCTION public.admin_platform_metrics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE output jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador'; END IF;
 SELECT jsonb_build_object(
  'students',(SELECT count(*) FROM public.profiles WHERE role<>'admin'),
  'admins',(SELECT count(*) FROM public.profiles WHERE role='admin'),
  'notebooks',(SELECT count(*) FROM public.study_notebooks),
  'provisional',(SELECT count(*) FROM public.study_notebooks WHERE kind='provisional'),
  'pending',(SELECT count(*) FROM public.provisional_notebook_specs WHERE review_status='pending'),
  'published_notebooks',(SELECT count(*) FROM public.study_notebooks WHERE visibility='official'),
  'questions',(SELECT count(*) FROM public.questions WHERE NOT coalesce(is_hidden,false) AND NOT coalesce(is_annulled,false)),
  'all_questions',(SELECT count(*) FROM public.questions),
  'essays',(SELECT count(*) FROM public.essay_questions),
  'cycles',(SELECT count(*) FROM public.study_cycles),
  'memberships',(SELECT count(*) FROM public.user_notebooks),
  'new_students_30d',(SELECT count(*) FROM public.profiles WHERE role<>'admin' AND created_at>=now()-interval '30 days'),
  'new_notebooks_30d',(SELECT count(*) FROM public.study_notebooks WHERE created_at>=now()-interval '30 days')
 ) INTO output;
 RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.admin_platform_metrics() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_metrics() TO authenticated;