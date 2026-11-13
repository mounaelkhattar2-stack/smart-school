create or replace function private.create_return_decision_for_hold() returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.attendance%rowtype; result_id text;
begin
  if new.status<>'ACTIVE' then return new; end if;
  select * into a from public.attendance where attendance_id=new.absence_attendance_id;
  if not found then raise exception 'Absence source introuvable' using errcode='23503'; end if;
  if not exists(select 1 from public.entry_decisions where absence_attendance_id=a.attendance_id) then
    result_id:='RET-'||gen_random_uuid()::text;
    insert into public.entry_decisions(decision_id,student_id,massar_id,student_name,class_id,absence_lesson_id,status,reason,absence_attendance_id)
      values(result_id,a.student_id,a.massar_id,a.student_name,a.class_id,a.lesson_id,'EN_ATTENTE','Autorisation de retour requise après une absence injustifiée.',a.attendance_id);
    insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at)
      values(gen_random_uuid()::text,new.closed_by,'ENTRY_RETURN_REQUESTED','entry_decision',result_id,pg_catalog.clock_timestamp());
  end if;
  return new;
end; $$;

create trigger entry_hold_creates_return_decision
  after insert or update of status on public.entry_holds
  for each row when (new.status='ACTIVE') execute function private.create_return_decision_for_hold();

create or replace function public.direction_decide_explanation(p_explanation_id text,p_action text,p_reason text default '')
returns text language plpgsql security definer set search_path = '' as $$
declare actor uuid; item public.absence_explanations%rowtype; source public.attendance%rowtype; decision_id text; clean_reason text; current_status text;
begin
  if not private.is_direction() then raise exception 'Accès réservé à la Direction' using errcode='42501'; end if;
  if p_action not in ('APPROUVEE','REFUSEE') then raise exception 'Décision invalide' using errcode='22023'; end if;
  clean_reason:=pg_catalog.btrim(coalesce(p_reason,''));
  if p_action='REFUSEE' and length(clean_reason)<5 then raise exception 'Un motif de refus d’au moins 5 caractères est obligatoire' using errcode='22023'; end if;
  select id into actor from public.profiles where id=(select auth.uid()) and role='DIRECTION' and status='ACTIVE';
  select * into item from public.absence_explanations where explanation_id=p_explanation_id and status='EN_ATTENTE' for update;
  if not found then raise exception 'Justification introuvable ou déjà traitée' using errcode='P0002'; end if;
  select * into source from public.attendance where attendance_id=item.attendance_id and student_id=item.student_id for update;
  if not found or source.status<>'ABSENT' then raise exception 'La présence source n’est pas une absence enregistrée' using errcode='22023'; end if;
  select c.corrected_status into current_status from public.attendance_corrections c where c.attendance_id=source.attendance_id order by c.corrected_at desc limit 1;
  if coalesce(current_status,source.status)<>'ABSENT' then raise exception 'La présence a été corrigée; cette justification ne peut plus être décidée' using errcode='22023'; end if;
  decision_id:='EXD-'||gen_random_uuid()::text;
  update public.absence_explanations set status=p_action,direction_decision=p_action,decided_by=actor,decided_at=pg_catalog.clock_timestamp() where explanation_id=item.explanation_id;
  insert into public.absence_explanation_decisions(decision_id,explanation_id,action,reason,decided_by,decided_at,source)
    values(decision_id,item.explanation_id,p_action,clean_reason,actor,pg_catalog.clock_timestamp(),'SUPABASE');
  if p_action='REFUSEE' and not exists(select 1 from public.entry_holds h where h.absence_attendance_id=source.attendance_id and h.status='ACTIVE') then
    insert into public.entry_holds(hold_id,student_id,absence_attendance_id,status,created_at)
    values('HOLD-'||source.attendance_id,source.student_id,source.attendance_id,'ACTIVE',pg_catalog.clock_timestamp())
    on conflict(absence_attendance_id) do update set status='ACTIVE',closed_at=null,closed_by=null,close_reason=null;
  end if;
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at)
    values(gen_random_uuid()::text,actor,'ABSENCE_EXPLANATION_'||p_action,'absence_explanation',item.explanation_id,pg_catalog.clock_timestamp());
  return decision_id;
end; $$;
revoke all on function public.direction_decide_explanation(text,text,text) from public,anon;
grant execute on function public.direction_decide_explanation(text,text,text) to authenticated;
