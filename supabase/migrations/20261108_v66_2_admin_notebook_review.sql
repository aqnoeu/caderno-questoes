-- v66.2: human approval of provisional notebooks and administrator notification.
ALTER TABLE public.provisional_notebook_specs
 ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending',
 ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
 ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE public.provisional_notebook_specs
 ADD CONSTRAINT provisional_review_status_check CHECK (review_status IN ('pending','approved','official','rejected'));
CREATE INDEX IF NOT EXISTS provisional_specs_review_idx ON public.provisional_notebook_specs(review_status,created_at DESC);
CREATE POLICY provisional_specs_admin_read ON public.provisional_notebook_specs
 FOR SELECT TO authenticated USING (public.is_admin());

ALTER TABLE public.user_notifications DROP CONSTRAINT user_notifications_category_check;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_category_check
 CHECK (category IN ('new_questions','revenge','achievement','study','admin_review','notebook_status'));
ALTER TABLE public.user_notifications DROP CONSTRAINT user_notifications_destination_check;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_destination_check
 CHECK (destination IN ('estudos','revanche','desempenho','inicio','admin_notebooks'));

CREATE OR REPLACE FUNCTION public.v66_notify_pending_notebook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE admin_row record; book_title text;
BEGIN
 SELECT title INTO book_title FROM public.study_notebooks WHERE id=NEW.notebook_id;
 FOR admin_row IN SELECT id FROM public.profiles WHERE role='admin' LOOP
  INSERT INTO public.user_notifications(user_id,notebook_id,category,title,body,destination,event_key,details)
  VALUES(admin_row.id,NEW.notebook_id,'admin_review','Caderno aguardando avaliação',
    'Novo caderno provisório: '||coalesce(book_title,'sem título')||'.',
    'admin_notebooks','provisional:'||NEW.notebook_id::text,
    jsonb_build_object('notebook_id',NEW.notebook_id))
  ON CONFLICT(user_id,event_key) DO NOTHING;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.v66_notify_pending_notebook() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER v66_2_provisional_request AFTER INSERT ON public.provisional_notebook_specs
 FOR EACH ROW EXECUTE FUNCTION public.v66_notify_pending_notebook();

-- Send notifications for any already existing pending notebook, without changing its state.
INSERT INTO public.user_notifications(user_id,notebook_id,category,title,body,destination,event_key,details)
SELECT p.id,s.notebook_id,'admin_review','Caderno aguardando avaliação',
       'Caderno provisório: '||coalesce(n.title,'sem título')||'.','admin_notebooks',
       'provisional:'||s.notebook_id::text,jsonb_build_object('notebook_id',s.notebook_id)
FROM public.profiles p CROSS JOIN public.provisional_notebook_specs s
JOIN public.study_notebooks n ON n.id=s.notebook_id
WHERE p.role='admin' AND s.review_status='pending'
ON CONFLICT(user_id,event_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_assign_provisional_questions(
 p_notebook uuid,p_question_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_status text; accepted integer:=0; invalid_count integer:=0; request_count integer;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador'; END IF;
 IF p_question_ids IS NULL OR array_length(p_question_ids,1) IS NULL THEN RAISE EXCEPTION 'Selecione questões para autorizar'; END IF;
 request_count:=array_length(p_question_ids,1);
 IF request_count>100 THEN RAISE EXCEPTION 'Limite de 100 questões por solicitação'; END IF;
 SELECT review_status INTO current_status FROM public.provisional_notebook_specs WHERE notebook_id=p_notebook FOR UPDATE;
 IF current_status IS NULL OR current_status='rejected' THEN RAISE EXCEPTION 'Caderno indisponível para revisão'; END IF;
 -- Administrator makes the final selection; questions must be published and valid.
 SELECT count(*) INTO invalid_count FROM (SELECT DISTINCT unnest(p_question_ids) id) t
 LEFT JOIN public.questions q ON q.id=t.id
 WHERE q.id IS NULL OR q.is_hidden OR q.is_annulled OR q.correct_option IS NULL OR q.correct_option='*';
 IF invalid_count>0 THEN RAISE EXCEPTION 'Uma ou mais questões estão ocultas, anuladas ou incompletas'; END IF;
 INSERT INTO public.notebook_questions(notebook_id,question_id,origin)
 SELECT p_notebook, t.id,'borrowed' FROM (SELECT DISTINCT unnest(p_question_ids) id) t
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS accepted=ROW_COUNT;
 RETURN jsonb_build_object('linked',accepted,'notebook_id',p_notebook);
END $$;
REVOKE ALL ON FUNCTION public.admin_assign_provisional_questions(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_provisional_questions(uuid,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_provisional(
 p_notebook uuid,p_action text,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE spec record; title text; linked_count integer; actor uuid; new_status text;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador'; END IF;
 actor:=(SELECT auth.uid());
 IF p_action NOT IN ('approve','publish','reject','reopen') THEN RAISE EXCEPTION 'Ação inválida'; END IF;
 SELECT s.user_id,s.review_status,n.title INTO spec
 FROM public.provisional_notebook_specs s JOIN public.study_notebooks n ON n.id=s.notebook_id
 WHERE s.notebook_id=p_notebook FOR UPDATE OF s;
 IF NOT FOUND THEN RAISE EXCEPTION 'Caderno provisório inexistente'; END IF;
 SELECT count(*) INTO linked_count FROM public.notebook_questions WHERE notebook_id=p_notebook;
 IF p_action='publish' AND linked_count=0 THEN RAISE EXCEPTION 'Inclua questões antes de efetivar o caderno'; END IF;
 IF p_action='publish' AND spec.review_status NOT IN ('approved','official')
 THEN RAISE EXCEPTION 'Aprove o caderno antes de efetivá-lo'; END IF;
 IF p_action='approve' AND spec.review_status='official' THEN RAISE EXCEPTION 'Caderno já efetivado'; END IF;
 new_status:=CASE p_action WHEN 'approve' THEN 'approved' WHEN 'publish' THEN 'official'
   WHEN 'reject' THEN 'rejected' ELSE 'pending' END;
 UPDATE public.provisional_notebook_specs SET review_status=new_status,
   reviewed_by=actor,reviewed_at=now(),review_note=left(coalesce(p_note,''),800)
 WHERE notebook_id=p_notebook;
 IF p_action='publish' THEN
  UPDATE public.study_notebooks SET visibility='official',kind='contest',updated_at=now() WHERE id=p_notebook;
 ELSIF p_action='reopen' THEN
  UPDATE public.study_notebooks SET visibility='private',kind='provisional',updated_at=now() WHERE id=p_notebook;
 END IF;
 UPDATE public.user_notifications SET read_at=coalesce(read_at,now())
 WHERE notebook_id=p_notebook AND category='admin_review' AND read_at IS NULL;
 INSERT INTO public.user_notifications(user_id,notebook_id,category,title,body,destination,event_key,details)
 VALUES(spec.user_id,p_notebook,'notebook_status',
   CASE new_status WHEN 'approved' THEN 'Seu caderno foi aprovado'
      WHEN 'official' THEN 'Seu caderno foi efetivado'
      WHEN 'rejected' THEN 'Seu caderno precisa de revisão' ELSE 'Seu caderno voltou para análise' END,
   CASE new_status WHEN 'approved' THEN 'O administrador autorizou a continuidade do caderno.'
      WHEN 'official' THEN 'Seu caderno agora integra o acervo oficial.'
      WHEN 'rejected' THEN 'Consulte as orientações da administração.'
      ELSE 'A administração reabriu a avaliação.' END,
   'estudos','review:'||p_notebook::text||':'||new_status||':'||floor(extract(epoch from now()))::bigint,
   jsonb_build_object('status',new_status))
 ON CONFLICT(user_id,event_key) DO NOTHING;
 RETURN jsonb_build_object('notebook_id',p_notebook,'status',new_status,'linked',linked_count);
END $$;
REVOKE ALL ON FUNCTION public.admin_review_provisional(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_review_provisional(uuid,text,text) TO authenticated;
