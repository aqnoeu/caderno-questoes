-- Expand only related subjects within the chosen syllabus for provisional notebooks.
CREATE OR REPLACE FUNCTION public.create_provisional_notebook_v2(
 p_title text,p_concurso text,p_cargo text,p_topics jsonb,p_metadata jsonb DEFAULT '{}'::jsonb,
 p_events jsonb DEFAULT '[]'::jsonb,p_broad_role text DEFAULT NULL,
 p_exam_date date DEFAULT NULL,p_source_filename text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid; result jsonb; id uuid;
BEGIN
 me:=(SELECT auth.uid());
 IF me IS NULL THEN RAISE EXCEPTION 'Sessão inválida'; END IF;
 IF jsonb_typeof(p_metadata) <> 'object' OR jsonb_typeof(p_events) <> 'array'
   OR pg_catalog.length(p_metadata::text)>25000 OR pg_catalog.length(p_events::text)>18000
 THEN RAISE EXCEPTION 'Informações do edital inválidas'; END IF;
 result:=public.create_provisional_notebook(p_title,p_concurso,p_cargo,p_topics,true,p_source_filename,p_exam_date);
 id:=(result->>'notebook_id')::uuid;
 UPDATE public.provisional_notebook_specs
  SET edital_analysis=p_metadata,edital_events=p_events,
   edital_selected_role=p_cargo,edital_broad_role=left(p_broad_role,120),
   edital_analyzed_at=now()
 WHERE notebook_id=id AND user_id=me;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_provisional_notebook_v2(text,text,text,jsonb,jsonb,jsonb,text,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_provisional_notebook_v2(text,text,text,jsonb,jsonb,jsonb,text,date,text) TO authenticated;
