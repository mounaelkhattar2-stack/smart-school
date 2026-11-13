create or replace function public.direction_decide_explanation(p_explanation_id text,p_action text,p_reason text default '')
returns text language plpgsql security definer set search_path = '' as $$
declare actor uuid; item public.absence_explanations%rowtype; decision_id text; clean_reason text;
begin
  if not private.is_direction() then raise exception 'Accès réservé à la Direction' using errcode='42501'; end if;
  if p_action not in ('APPROUVEE','REFUSEE') then raise exception 'Décision invalide' using errcode='22023'; end if;
  clean_reason:=pg_catalog.btrim(coalesce(p_reason,''));
  if p_action='REFUSEE' and length(clean_reason)<5 then raise exception 'Un motif de refus d’au moins 5 caractères est obligatoire' using errcode='22023'; end if;
  select id into actor from public.profiles where id=(select auth.uid()) and role='DIRECTION' and status='ACTIVE';
  select * into item from public.absence_explanations where explanation_id=p_explanation_id and status='EN_ATTENTE' for update;
  if not found then raise exception 'Justification introuvable ou déjà traitée' using errcode='P0002'; end if;
  if item.attendance_id is null or not exists(select 1 from public.attendance a where a.attendance_id=item.attendance_id and a.student_id=item.student_id and a.status='ABSENT') then
    raise exception 'La présence source n’est pas une absence enregistrée' using errcode='22023';
  end if;
  decision_id:='EXD-'||gen_random_uuid()::text;
  update public.absence_explanations set status=p_action,direction_decision=p_action,decided_by=actor,decided_at=pg_catalog.clock_timestamp()
    where explanation_id=item.explanation_id;
  insert into public.absence_explanation_decisions(decision_id,explanation_id,action,reason,decided_by,decided_at,source)
    values(decision_id,item.explanation_id,p_action,case when p_action='REFUSEE' then clean_reason else coalesce(clean_reason,'') end,actor,pg_catalog.clock_timestamp(),'SUPABASE');
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at)
    values(gen_random_uuid()::text,actor,'ABSENCE_EXPLANATION_'||p_action,'absence_explanation',item.explanation_id,pg_catalog.clock_timestamp());
  return decision_id;
end; $$;
revoke all on function public.direction_decide_explanation(text,text,text) from public,anon;
grant execute on function public.direction_decide_explanation(text,text,text) to authenticated;
revoke update on public.absence_explanations from authenticated;
revoke insert,update,delete on public.absence_explanation_decisions from authenticated;
