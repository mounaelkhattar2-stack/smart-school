-- Keep inactive students out of teacher access and attendance submission.
create or replace function private.teacher_can_access_student(target_student text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.students s where s.student_id=target_student and s.status='Actif' and (select private.teaches_class(s.class_id)))
$$;
revoke all on function private.teacher_can_access_student(text) from public, anon;
grant execute on function private.teacher_can_access_student(text) to authenticated;

drop policy if exists students_role_read on public.students;
create policy students_role_read on public.students for select to authenticated
using((select private.is_direction()) or (select private.is_parent_of(student_id)) or (select private.teacher_can_access_student(student_id)));

create or replace function public.submit_attendance(p_occurrence_id text, p_student_id text, p_status text)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles%rowtype;
  occurrence public.lesson_occurrences%rowtype;
  lesson public.lessons%rowtype;
  student public.students%rowtype;
  hold public.entry_holds%rowtype;
  prior_absence public.attendance%rowtype;
  approved_decision public.entry_decisions%rowtype;
  new_attendance public.attendance%rowtype;
  local_now timestamp;
begin
  select * into actor from public.profiles where id=(select auth.uid()) and role='TEACHER' and status='ACTIVE';
  if not found then raise exception 'Compte enseignant inactif ou non autorisé' using errcode='42501'; end if;
  if p_status not in ('PRESENT','ABSENT') then raise exception 'État de présence invalide' using errcode='22023'; end if;
  select * into occurrence from public.lesson_occurrences where occurrence_id=p_occurrence_id for update;
  if not found or occurrence.starts_at > pg_catalog.clock_timestamp() or occurrence.ends_at <= pg_catalog.clock_timestamp() then
    raise exception 'Appel fermé hors de l’horaire du cours' using errcode='42501';
  end if;
  select * into lesson from public.lessons where lesson_id=occurrence.lesson_id and is_active and teacher_id=actor.teacher_id;
  if not found then raise exception 'Cours non attribué à cet enseignant' using errcode='42501'; end if;
  select * into student from public.students where student_id=p_student_id and class_id=lesson.class_id and status='Actif';
  if not found then raise exception 'Élève non inscrit dans cette classe' using errcode='42501'; end if;
  select * into hold from public.entry_holds where student_id=student.student_id and status='ACTIVE' order by created_at limit 1 for update;
  select a.* into prior_absence from public.attendance a join public.lesson_occurrences o on o.occurrence_id=a.occurrence_id
    where a.student_id=student.student_id and o.ends_at<=occurrence.starts_at
      and coalesce((select c.corrected_status from public.attendance_corrections c where c.attendance_id=a.attendance_id order by c.corrected_at desc limit 1),a.status)='ABSENT'
    order by o.ends_at desc limit 1;
  if p_status='PRESENT' and (found or hold.hold_id is not null) then
    select * into approved_decision from public.entry_decisions d
      where d.absence_attendance_id=coalesce(hold.absence_attendance_id,prior_absence.attendance_id)
        and d.status='AUTORISEE' and d.authorized_lesson_id=lesson.lesson_id
        and d.authorized_lesson_date=occurrence.lesson_date and d.authorized_by is not null
      order by d.decided_at desc limit 1;
    if not found then raise exception 'Retour bloqué : autorisation préalable de la Direction requise' using errcode='42501'; end if;
  elsif hold.hold_id is not null then
    raise exception 'Accès bloqué jusqu’à autorisation de retour par la Direction' using errcode='42501';
  end if;
  insert into public.attendance(attendance_id,occurrence_id,lesson_id,lesson_date,day,slot_code,class_id,student_id,massar_id,student_name,teacher_id,teacher_name,subject_name,status,access_status,recorded_at,provenance)
  values ('ATT-'||gen_random_uuid()::text,occurrence.occurrence_id,lesson.lesson_id,occurrence.lesson_date,lesson.day,lesson.slot_code,lesson.class_id,student.student_id,student.massar_id,student.full_name,lesson.teacher_id,lesson.teacher_name,lesson.subject_name,p_status,case when approved_decision.decision_id is not null then 'AUTORISE_POUR_CETTE_SEANCE' else 'AUTORISE' end,pg_catalog.clock_timestamp(),'SAISIE_SUPABASE')
  returning * into new_attendance;
  if approved_decision.decision_id is not null then
    insert into public.attendance_authorizations(attendance_id,decision_id,approved_by,approved_at) values(new_attendance.attendance_id,approved_decision.decision_id,approved_decision.authorized_by,approved_decision.decided_at);
    update public.entry_holds set status='CLOSED',closed_at=pg_catalog.clock_timestamp(),closed_by=actor.id,close_reason='Retour enregistré au cours autorisé' where hold_id=hold.hold_id;
    insert into public.entry_decision_events(event_id,decision_id,action,reason,actor_user_id,authorized_lesson_id,authorized_lesson_date,created_at,source)
    values(gen_random_uuid()::text,approved_decision.decision_id,'RETOUR_EFFECTUE','Présence au cours autorisé',actor.id,lesson.lesson_id,occurrence.lesson_date,pg_catalog.clock_timestamp(),'LIVE');
  elsif p_status='ABSENT' then
    insert into public.entry_holds(hold_id,student_id,absence_attendance_id,status,created_at)
    values('HOLD-'||new_attendance.attendance_id,student.student_id,new_attendance.attendance_id,'ACTIVE',pg_catalog.clock_timestamp());
  end if;
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at)
  values(gen_random_uuid()::text,actor.id,'ATTENDANCE_SUBMITTED','attendance',new_attendance.attendance_id,pg_catalog.clock_timestamp());
  return new_attendance;
end; $$;
