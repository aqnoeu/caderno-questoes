
-- v65: central de notificacoes interna; sem alteracoes em tabelas legadas
CREATE TABLE public.user_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 notebook_id uuid REFERENCES public.study_notebooks(id) ON DELETE SET NULL,
 category text NOT NULL CHECK (category IN ('new_questions','revenge','achievement','study')),
 title text NOT NULL,
 body text NOT NULL,
 destination text NOT NULL CHECK (destination IN ('estudos','revanche','desempenho','inicio')),
 event_key text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz,
 UNIQUE (user_id,event_key)
);
CREATE INDEX user_notifications_user_recent_idx ON public.user_notifications(user_id, created_at DESC);
CREATE INDEX user_notifications_unread_idx ON public.user_notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE TABLE public.notification_preferences (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 new_questions boolean NOT NULL DEFAULT true,
 revenge boolean NOT NULL DEFAULT true,
 achievement boolean NOT NULL DEFAULT true,
 study boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_notifications, public.notification_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE(read_at) ON public.user_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
CREATE POLICY user_notifications_select ON public.user_notifications FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY user_notifications_mark_read ON public.user_notifications FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY notification_preferences_select ON public.notification_preferences FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY notification_preferences_insert ON public.notification_preferences FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY notification_preferences_update ON public.notification_preferences FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
-- Internal only: triggers and authenticated reminder RPC invoke this helper.
CREATE FUNCTION public.notification_emit(
 p_user uuid,p_category text,p_title text,p_body text,p_destination text,
 p_event_key text,p_notebook uuid DEFAULT NULL,p_details jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE allowed boolean;
BEGIN
 SELECT CASE p_category
  WHEN 'new_questions' THEN new_questions
  WHEN 'revenge' THEN revenge
  WHEN 'achievement' THEN achievement
  WHEN 'study' THEN study
  ELSE false END INTO allowed
 FROM public.notification_preferences WHERE user_id = p_user;
 IF NOT COALESCE(allowed,true) THEN RETURN; END IF;
 INSERT INTO public.user_notifications(user_id,category,title,body,destination,event_key,notebook_id,details)
 VALUES(p_user,p_category,p_title,p_body,p_destination,p_event_key,p_notebook,p_details)
 ON CONFLICT(user_id,event_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.notification_emit(uuid,text,text,text,text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.notify_new_notebook_question()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target record; book_title text; q_ok boolean;
BEGIN
 SELECT (NOT is_hidden AND NOT is_annulled AND correct_option <> '*') INTO q_ok FROM public.questions WHERE id = NEW.question_id;
 IF NOT COALESCE(q_ok,false) THEN RETURN NEW; END IF;
 SELECT title INTO book_title FROM public.study_notebooks WHERE id = NEW.notebook_id;
 FOR target IN SELECT u.user_id FROM public.user_notebooks u WHERE u.notebook_id = NEW.notebook_id LOOP
  IF NOT COALESCE((SELECT p.new_questions FROM public.notification_preferences p WHERE p.user_id=target.user_id),true) THEN CONTINUE; END IF;
  INSERT INTO public.user_notifications(user_id,notebook_id,category,title,body,destination,event_key,details)
  VALUES(target.user_id,NEW.notebook_id,'new_questions','Novas questões no seu caderno',
    'O caderno ' || COALESCE(book_title,'de estudos') || ' recebeu novas questões.',
    'estudos','new_questions:' || NEW.notebook_id::text || ':' || (CURRENT_DATE::text),
    jsonb_build_object('count',1))
  ON CONFLICT (user_id,event_key) DO UPDATE SET
    created_at=now(), read_at=NULL,
    details=jsonb_build_object('count',COALESCE((public.user_notifications.details->>'count')::int,0)+1);
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_new_notebook_question() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER v65_new_notebook_question AFTER INSERT ON public.notebook_questions
 FOR EACH ROW EXECUTE FUNCTION public.notify_new_notebook_question();
CREATE FUNCTION public.notify_cycle_completed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rate integer;
BEGIN
 IF NEW.completed_at IS NULL OR OLD.completed_at IS NOT NULL THEN RETURN NEW; END IF;
 IF NEW.wrong_count > 0 THEN
  PERFORM public.notification_emit(NEW.user_id,'revenge','Sua Revanche está disponível',
   'Você tem questões erradas deste ciclo para revisar com o Caderno.',
   'revanche','revenge:'||NEW.id::text,NEW.notebook_id,jsonb_build_object('cycle_id',NEW.id));
 END IF;
 IF NEW.answer_count > 0 THEN
  rate := ROUND(NEW.correct_count::numeric * 100 / NEW.answer_count)::integer;
  IF rate >= 80 THEN
   PERFORM public.notification_emit(NEW.user_id,'achievement','Mandou bem! 🏆',
     'Você alcançou '||rate::text||'% de acertos no ciclo concluído.',
     'desempenho','achievement:'||NEW.id::text,NEW.notebook_id,jsonb_build_object('cycle_id',NEW.id,'rate',rate));
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_cycle_completed() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER v65_cycle_completed AFTER UPDATE OF completed_at ON public.study_cycles
 FOR EACH ROW EXECUTE FUNCTION public.notify_cycle_completed();
-- If a Revenge is finished, its pending notice should cease to be unread.
CREATE FUNCTION public.notify_revenge_finished()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.state = 'completed' AND OLD.state IS DISTINCT FROM NEW.state THEN
  UPDATE public.user_notifications SET read_at=COALESCE(read_at,now())
  WHERE user_id=NEW.user_id AND event_key='revenge:'||NEW.cycle_id::text AND read_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_revenge_finished() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER v65_revenge_finished AFTER UPDATE OF state ON public.revenge_sessions
 FOR EACH ROW EXECUTE FUNCTION public.notify_revenge_finished();
-- Called on entering the site. Creates at most one reminder per overdue active cycle.
CREATE FUNCTION public.sync_study_reminders() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE me uuid; c record; inserted_count integer := 0;
BEGIN
 me := (SELECT auth.uid());
 IF me IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT COALESCE((SELECT p.study FROM public.notification_preferences p WHERE p.user_id=me),true) THEN RETURN 0; END IF;
 FOR c IN SELECT id, notebook_id FROM public.study_cycles
   WHERE user_id=me AND completed_at IS NULL AND started_at < now()-interval '24 hours'
   ORDER BY started_at DESC LIMIT 10
 LOOP
  IF NOT EXISTS (SELECT 1 FROM public.user_notifications WHERE user_id=me AND event_key='study:'||c.id::text) THEN
   PERFORM public.notification_emit(me,'study','Seu ciclo está esperando 📚',
    'Continue o ciclo de estudos de onde parou. Seu progresso está salvo.',
    'estudos','study:'||c.id::text,c.notebook_id,jsonb_build_object('cycle_id',c.id));
   inserted_count := inserted_count+1;
  END IF;
 END LOOP;
 RETURN inserted_count;
END $$;
REVOKE ALL ON FUNCTION public.sync_study_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_study_reminders() TO authenticated;
