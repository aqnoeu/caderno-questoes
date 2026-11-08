-- v65: incluir Revanche ja pendente no primeiro carregamento sem alterar ciclos.
CREATE OR REPLACE FUNCTION public.sync_study_reminders() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE me uuid; c record; inserted_count integer := 0;
BEGIN
 me := (SELECT auth.uid());
 IF me IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF COALESCE((SELECT p.study FROM public.notification_preferences p WHERE p.user_id=me),true) THEN
  FOR c IN SELECT id, notebook_id FROM public.study_cycles
   WHERE user_id=me AND completed_at IS NULL AND started_at < now()-interval '24 hours'
   ORDER BY started_at DESC LIMIT 10
  LOOP
   IF NOT EXISTS (SELECT 1 FROM public.user_notifications WHERE user_id=me AND event_key='study:'||c.id::text) THEN
    PERFORM public.notification_emit(me,'study','Seu ciclo está esperando 📚',
      'Continue o ciclo de estudos de onde parou. Seu progresso está salvo.',
      'estudos','study:'||c.id::text,c.notebook_id,jsonb_build_object('cycle_id',c.id));
    inserted_count:=inserted_count+1;
   END IF;
  END LOOP;
 END IF;
 IF COALESCE((SELECT p.revenge FROM public.notification_preferences p WHERE p.user_id=me),true) THEN
  FOR c IN SELECT cy.id, cy.notebook_id FROM public.study_cycles cy
   WHERE cy.user_id=me AND cy.completed_at IS NOT NULL AND cy.wrong_count > 0
     AND cy.completed_at >= now()-interval '60 days'
     AND NOT EXISTS (SELECT 1 FROM public.revenge_sessions r
       WHERE r.cycle_id=cy.id AND r.user_id=me AND r.state='completed')
   ORDER BY cy.completed_at DESC LIMIT 15
  LOOP
   IF NOT EXISTS (SELECT 1 FROM public.user_notifications WHERE user_id=me AND event_key='revenge:'||c.id::text) THEN
    PERFORM public.notification_emit(me,'revenge','Sua Revanche está disponível',
      'Revise os erros deste ciclo com o Caderno.',
      'revanche','revenge:'||c.id::text,c.notebook_id,jsonb_build_object('cycle_id',c.id));
    inserted_count:=inserted_count+1;
   END IF;
  END LOOP;
 END IF;
 RETURN inserted_count;
END $$;
REVOKE ALL ON FUNCTION public.sync_study_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_study_reminders() TO authenticated;