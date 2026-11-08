-- Correct subject splitting in v66: use simple separators and trim whitespace.
CREATE OR REPLACE FUNCTION public.create_provisional_notebook(
 p_title text,p_concurso text,p_cargo text,p_topics jsonb,p_expand_related boolean DEFAULT false,
 p_source_filename text DEFAULT NULL,p_exam_date date DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid; book_id uuid; count_added integer; total_topics integer;
BEGIN
 me := (SELECT auth.uid());
 IF me IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado'; END IF;
 IF char_length(trim(coalesce(p_title,''))) NOT BETWEEN 4 AND 120 OR
   char_length(trim(coalesce(p_concurso,''))) NOT BETWEEN 2 AND 120 OR
   char_length(trim(coalesce(p_cargo,''))) NOT BETWEEN 2 AND 120
 THEN RAISE EXCEPTION 'Informe concurso, cargo e título válidos'; END IF;
 IF jsonb_typeof(p_topics) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Lista de matérias inválida'; END IF;
 total_topics:=jsonb_array_length(p_topics);
 IF total_topics < 1 OR total_topics > 120 THEN RAISE EXCEPTION 'Selecione de 1 a 120 assuntos ou disciplinas'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_topics) t WHERE
  length(trim(coalesce(t->>'discipline',''))) NOT BETWEEN 2 AND 120 OR
  length(coalesce(t->>'subject','')) > 250 OR
  jsonb_typeof(t) <> 'object')
 THEN RAISE EXCEPTION 'Matérias inválidas'; END IF;
 IF (SELECT count(*) FROM public.user_notebooks WHERE user_id=me)>=5
 THEN RAISE EXCEPTION 'Limite de cinco cadernos atingido'; END IF;
 INSERT INTO public.study_notebooks(code,title,kind,visibility,created_by,source_concurso,cargo,identity_key)
 VALUES ('prov-'||gen_random_uuid()::text,trim(p_title),'provisional','private',me,trim(p_concurso),trim(p_cargo),
 'private:'||me::text||':'||gen_random_uuid()::text)
 RETURNING id INTO book_id;
 INSERT INTO public.provisional_notebook_specs(notebook_id,user_id,topics,expand_related,source_filename,exam_date)
 VALUES(book_id,me,p_topics,p_expand_related,left(p_source_filename,250),p_exam_date);
 INSERT INTO public.user_notebooks(user_id,notebook_id) VALUES(me,book_id);
 INSERT INTO public.notebook_questions(notebook_id,question_id,origin)
 SELECT book_id,q.id,'borrowed' FROM public.questions q
 WHERE NOT q.is_hidden AND NOT q.is_annulled AND q.correct_option <> '*'
 AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_topics) t
   WHERE lower(trim(q.discipline))=lower(trim(t->>'discipline'))
     AND (trim(coalesce(t->>'subject',''))=''
       OR EXISTS (SELECT 1 FROM regexp_split_to_table(coalesce(q.subject,''),'[;|·•]') s
          WHERE lower(trim(s))=lower(trim(t->>'subject'))
          OR (p_expand_related AND length(trim(t->>'subject'))>=5 AND
              (lower(trim(s)) LIKE lower(trim(t->>'subject'))||' %'
               OR lower(trim(t->>'subject')) LIKE lower(trim(s))||' %')))))
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS count_added=ROW_COUNT;
 RETURN jsonb_build_object('notebook_id',book_id,'matched_questions',count_added,'topics_count',total_topics);
END $$;
REVOKE ALL ON FUNCTION public.create_provisional_notebook(text,text,text,jsonb,boolean,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_provisional_notebook(text,text,text,jsonb,boolean,text,date) TO authenticated;
