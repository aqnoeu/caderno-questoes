CREATE OR REPLACE FUNCTION public.admin_platform_metrics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE output jsonb;
BEGIN
 IF NOT coalesce(public.is_admin(),false) THEN RAISE EXCEPTION 'Acesso restrito ao administrador'; END IF;
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
  'students_with_notebooks',(SELECT count(DISTINCT u.user_id) FROM public.user_notebooks u JOIN public.profiles p ON p.id=u.user_id WHERE p.role='user'),
  'active_students_30d',(SELECT count(DISTINCT a.user_id) FROM public.answers a JOIN public.profiles p ON p.id=a.user_id WHERE p.role='user' AND a.answered_at>=now()-interval '30 days'),
  'student_answers_30d',(SELECT count(*) FROM public.answers a JOIN public.profiles p ON p.id=a.user_id WHERE p.role='user' AND a.answered_at>=now()-interval '30 days'),
  'completed_cycles',(SELECT count(*) FROM public.study_cycles WHERE completed_at IS NOT NULL),
  'cycles',(SELECT count(*) FROM public.study_cycles),
  'memberships',(SELECT count(*) FROM public.user_notebooks),
  'new_students_30d',(SELECT count(*) FROM public.profiles WHERE role<>'admin' AND created_at>=now()-interval '30 days'),
  'new_notebooks_30d',(SELECT count(*) FROM public.study_notebooks WHERE created_at>=now()-interval '30 days')
 ) INTO output;
 RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.admin_platform_metrics() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_metrics() TO authenticated;
