
-- v66: private provisional notebooks from an edital, with no duplication of questions
CREATE TABLE public.provisional_notebook_specs (
 notebook_id uuid PRIMARY KEY REFERENCES public.study_notebooks(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 topics jsonb NOT NULL DEFAULT '[]'::jsonb,
 expand_related boolean NOT NULL DEFAULT false,
 source_filename text,
 exam_date date,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provisional_specs_owner_idx ON public.provisional_notebook_specs(user_id);
ALTER TABLE public.provisional_notebook_specs ENABLE ROW LEVEL SECURITY;
CREATE POLICY provisional_specs_read ON public.provisional_notebook_specs FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));
REVOKE ALL ON public.provisional_notebook_specs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.provisional_notebook_specs TO authenticated;

-- Study plans are independent per user and notebook
CREATE TABLE public.study_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 notebook_id uuid REFERENCES public.study_notebooks(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
 exam_date date,
 target_minutes integer NOT NULL DEFAULT 60 CHECK (target_minutes BETWEEN 10 AND 720),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX study_plans_owner_idx ON public.study_plans(user_id,notebook_id);
CREATE TABLE public.study_plan_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_id uuid NOT NULL REFERENCES public.study_plans(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 study_date date NOT NULL,
 discipline text NOT NULL CHECK (char_length(discipline) BETWEEN 1 AND 120),
 subject text DEFAULT '',
 planned_minutes integer NOT NULL DEFAULT 30 CHECK (planned_minutes BETWEEN 5 AND 720),
 completed_minutes integer NOT NULL DEFAULT 0 CHECK (completed_minutes BETWEEN 0 AND 720),
 done boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX study_tasks_user_day_idx ON public.study_plan_tasks(user_id,study_date);
ALTER TABLE public.study_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_plan_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY study_plans_own ON public.study_plans FOR ALL TO authenticated
 USING (user_id=(SELECT auth.uid())) WITH CHECK (user_id=(SELECT auth.uid())
 AND (notebook_id IS NULL OR EXISTS (SELECT 1 FROM public.user_notebooks un WHERE un.user_id=(SELECT auth.uid()) AND un.notebook_id=study_plans.notebook_id)));
CREATE POLICY study_tasks_own ON public.study_plan_tasks FOR ALL TO authenticated
 USING (user_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.study_plans p WHERE p.id=plan_id AND p.user_id=(SELECT auth.uid())))
 WITH CHECK (user_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.study_plans p WHERE p.id=plan_id AND p.user_id=(SELECT auth.uid())));
REVOKE ALL ON public.study_plans,public.study_plan_tasks FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.study_plans,public.study_plan_tasks TO authenticated;

-- Create a private notebook, link only compatible published questions at creation
CREATE FUNCTION public.create_provisional_notebook(
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
       OR EXISTS (SELECT 1 FROM regexp_split_to_table(coalesce(q.subject,''),'\\s*[;|·•]\\s*') s
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
