
-- v66.3: administrative catalogue and read-only rule-based candidate lookup.
-- No questions are linked by this function; only explicit existing authorization can link them.
CREATE OR REPLACE FUNCTION public.admin_notebook_catalog()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb) INTO result
 FROM (
 SELECT n.id,n.title,n.kind,n.visibility,n.cargo,n.source_concurso,n.created_at,n.updated_at,
  (SELECT count(*) FROM public.notebook_questions nq WHERE nq.notebook_id=n.id) AS question_count,
  (SELECT count(*) FROM public.user_notebooks un WHERE un.notebook_id=n.id) AS student_count,
  s.review_status,s.edital_selected_role,
  COALESCE(jsonb_array_length(s.topics),0) AS edital_topic_count
 FROM public.study_notebooks n
 LEFT JOIN public.provisional_notebook_specs s ON s.notebook_id=n.id
 ) t;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_notebook_catalog() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_notebook_catalog() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_rename_notebook(p_id uuid,p_title text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE resulting record;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador'; END IF;
 IF length(trim(coalesce(p_title,''))) NOT BETWEEN 4 AND 120 THEN RAISE EXCEPTION 'O título deve ter de 4 a 120 caracteres'; END IF;
 UPDATE public.study_notebooks SET title=trim(p_title),updated_at=now()
 WHERE id=p_id RETURNING id,title INTO resulting;
 IF NOT FOUND THEN RAISE EXCEPTION 'Caderno não encontrado'; END IF;
 RETURN jsonb_build_object('id',resulting.id,'title',resulting.title);
END $$;
REVOKE ALL ON FUNCTION public.admin_rename_notebook(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_rename_notebook(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_find_compatible_questions(p_notebook uuid,p_limit integer DEFAULT 150)
RETURNS TABLE(question_id uuid, match_score integer, match_reason text, matched_topic text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE topics jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador'; END IF;
 IF p_limit < 1 OR p_limit > 250 THEN RAISE EXCEPTION 'Limite de resultados inválido'; END IF;
 SELECT s.topics INTO topics FROM public.provisional_notebook_specs s WHERE s.notebook_id=p_notebook;
 IF topics IS NULL THEN RAISE EXCEPTION 'Caderno sem edital para correspondência'; END IF;
 RETURN QUERY
 WITH wanted AS (
  SELECT lower(translate(trim(t.value->>'discipline'),
    'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç',
    'AAAAEEIOOOUUCaaaaeeiooouuc')) AS d,
   lower(translate(trim(coalesce(t.value->>'subject','')),
    'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç',
    'AAAAEEIOOOUUCaaaaeeiooouuc')) AS s,
   trim(coalesce(t.value->>'subject','')) AS display_topic
  FROM jsonb_array_elements(topics) t
  WHERE length(trim(coalesce(t.value->>'discipline','')))>1
 ),
 candidates AS (
  SELECT q.id,q.subject,q.discipline,q.subjects,
   lower(translate(trim(coalesce(q.discipline,'')),
    'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç',
    'AAAAEEIOOOUUCaaaaeeiooouuc')) AS d,
   lower(translate(coalesce(q.subject,'') || ' ' || coalesce(q.subjects::text,''),
    'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç',
    'AAAAEEIOOOUUCaaaaeeiooouuc')) AS tags
  FROM public.questions q
  WHERE NOT coalesce(q.is_hidden,false)
   AND NOT coalesce(q.is_annulled,false)
   AND q.correct_option IS NOT NULL AND q.correct_option <> '*'
   AND NOT EXISTS(SELECT 1 FROM public.notebook_questions nq
     WHERE nq.notebook_id=p_notebook AND nq.question_id=q.id)
 ),
 scored AS (
  SELECT c.id,w.display_topic,w.d,w.s,
   CASE
    WHEN c.d=w.d AND length(w.s)>3 AND position(w.s IN c.tags)>0 THEN 95
    WHEN c.d=w.d AND length(w.s)=0 THEN 82
    WHEN c.d=w.d AND length(w.s)>3 AND EXISTS (
      SELECT 1 FROM regexp_split_to_table(w.s,'[^a-z0-9]+') tok
      WHERE length(tok)>=6 AND position(tok IN c.tags)>0
    ) THEN 68
    WHEN position(w.d IN c.tags)>0 AND w.d<>'direito' AND length(w.s)=0 THEN 64
    WHEN position(w.d IN c.tags)>0 AND w.d<>'direito' AND length(w.s)>3 AND
      EXISTS (SELECT 1 FROM regexp_split_to_table(w.s,'[^a-z0-9]+') tok
        WHERE length(tok)>=6 AND position(tok IN c.tags)>0) THEN 61
    ELSE 0
   END AS points,
   CASE
    WHEN c.d=w.d AND length(w.s)>3 AND position(w.s IN c.tags)>0 THEN 'Assunto do edital identificado nas etiquetas'
    WHEN c.d=w.d AND length(w.s)=0 THEN 'Disciplina correspondente'
    WHEN c.d=w.d THEN 'Disciplina e palavra-chave do assunto'
    ELSE 'Área jurídica identificada nos múltiplos assuntos'
   END AS reason
  FROM candidates c CROSS JOIN wanted w
  WHERE c.d=w.d OR (w.d <> 'direito' AND position(w.d IN c.tags)>0)
 )
 SELECT picked.id AS question_id,picked.points AS match_score,
  picked.reason AS match_reason,
  CASE WHEN picked.display_topic <> '' THEN picked.display_topic ELSE picked.d END AS matched_topic
 FROM (
  SELECT DISTINCT ON(s.id) s.id,s.points,s.reason,s.display_topic,s.d
  FROM scored s WHERE s.points >= 60
  ORDER BY s.id,s.points DESC
 ) picked
 ORDER BY picked.points DESC,picked.id
 LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.admin_find_compatible_questions(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_find_compatible_questions(uuid,integer) TO authenticated;
