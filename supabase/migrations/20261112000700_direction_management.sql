-- Direction-only, audit-logged management functions; all are additive.
create or replace function public.direction_save_student(
  p_student_id text,p_full_name text,p_massar_id text,p_class_id text,p_class_number integer,
  p_birth_date text default '',p_school_email text default '',p_status text default 'Actif'
) returns text language plpgsql security definer set search_path = '' as $$
declare actor uuid; sid text; v_first_name text; v_last_name text;
begin
  if not private.is_direction() then raise exception 'Accès réservé à la Direction' using errcode='42501'; end if;
  if length(pg_catalog.btrim(coalesce(p_full_name,'')))<2 or length(pg_catalog.btrim(coalesce(p_massar_id,'')))<3 or p_class_number not between 1 and 80 or p_status not in ('Actif','Inactif') then raise exception 'Fiche élève invalide' using errcode='22023'; end if;
  if not exists(select 1 from public.classes where class_id=p_class_id) then raise exception 'Classe introuvable' using errcode='22023'; end if;
  if exists(select 1 from public.students where class_id=p_class_id and class_number=p_class_number and student_id is distinct from p_student_id) then raise exception 'Ce numéro est déjà attribué dans cette classe' using errcode='23505'; end if;
  actor:=(select auth.uid()); sid:=coalesce(nullif(pg_catalog.btrim(p_student_id),''),'STU-'||gen_random_uuid()::text);
  v_first_name:=pg_catalog.split_part(pg_catalog.btrim(p_full_name),' ',1); v_last_name:=nullif(pg_catalog.btrim(substring(pg_catalog.btrim(p_full_name) from pg_catalog.length(v_first_name)+1)), '');
  if p_student_id is null or p_student_id='' then
    insert into public.students(student_id,massar_id,first_name,last_name,full_name,class_id,class_number,birth_date,school_email,status,provenance)
    values(sid,pg_catalog.upper(pg_catalog.btrim(p_massar_id)),v_first_name,v_last_name,pg_catalog.btrim(p_full_name),p_class_id,p_class_number,nullif(p_birth_date,''),nullif(p_school_email,''),p_status,'DIRECTION');
  else
    update public.students set massar_id=pg_catalog.upper(pg_catalog.btrim(p_massar_id)),first_name=v_first_name,last_name=v_last_name,full_name=pg_catalog.btrim(p_full_name),class_id=p_class_id,class_number=p_class_number,birth_date=nullif(p_birth_date,''),school_email=nullif(p_school_email,''),status=p_status where student_id=sid;
    if not found then raise exception 'Élève introuvable' using errcode='P0002'; end if;
  end if;
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at) values(gen_random_uuid()::text,actor,'STUDENT_SAVED','student',sid,pg_catalog.clock_timestamp());
  return sid;
end; $$;

create or replace function public.direction_archive_student(p_student_id text) returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  if not private.is_direction() then raise exception 'Accès réservé à la Direction' using errcode='42501'; end if;
  actor:=(select auth.uid()); update public.students set status='Inactif' where student_id=p_student_id;
  if not found then raise exception 'Élève introuvable' using errcode='P0002'; end if;
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at) values(gen_random_uuid()::text,actor,'STUDENT_ARCHIVED','student',p_student_id,pg_catalog.clock_timestamp());
end; $$;

create or replace function public.direction_save_teacher(
  p_teacher_id text,p_login_id text,p_full_name text,p_subject_code text,p_shift text,
  p_email text default '',p_phone text default '',p_max_hours_day integer default 8,p_status text default 'Actif'
) returns text language plpgsql security definer set search_path = '' as $$
declare actor uuid; tid text; sub public.subjects%rowtype; v_first_name text; v_last_name text;
begin
  if not private.is_direction() then raise exception 'Accès réservé à la Direction' using errcode='42501'; end if;
  if length(pg_catalog.btrim(coalesce(p_login_id,'')))<3 or length(pg_catalog.btrim(coalesce(p_full_name,'')))<2 or p_shift not in ('Matin','Après-midi','Mixte') or p_max_hours_day not between 1 and 12 or p_status not in ('Actif','Inactif') then raise exception 'Fiche enseignant invalide' using errcode='22023'; end if;
  select * into sub from public.subjects where code=p_subject_code; if not found then raise exception 'Matière introuvable' using errcode='22023'; end if;
  if p_teacher_id is not null and exists(select 1 from public.lessons where teacher_id=p_teacher_id and is_active and subject_code<>p_subject_code) then raise exception 'Réattribuez les cours avant de changer sa matière' using errcode='23514'; end if;
  actor:=(select auth.uid()); tid:=coalesce(nullif(pg_catalog.btrim(p_teacher_id),''),'TCH-'||gen_random_uuid()::text); v_first_name:=pg_catalog.split_part(pg_catalog.btrim(p_full_name),' ',1); v_last_name:=nullif(pg_catalog.btrim(substring(pg_catalog.btrim(p_full_name) from pg_catalog.length(v_first_name)+1)), '');
  if p_teacher_id is null or p_teacher_id='' then
    insert into public.teachers(teacher_id,login_id,first_name,last_name,full_name,subject_code,subject_name,shift,email,phone,status,max_hours_day)
    values(tid,pg_catalog.btrim(p_login_id),v_first_name,v_last_name,pg_catalog.btrim(p_full_name),sub.code,sub.name,p_shift,nullif(p_email,''),nullif(p_phone,''),p_status,p_max_hours_day);
  else
    update public.teachers set login_id=pg_catalog.btrim(p_login_id),first_name=v_first_name,last_name=v_last_name,full_name=pg_catalog.btrim(p_full_name),subject_code=sub.code,subject_name=sub.name,shift=p_shift,email=nullif(p_email,''),phone=nullif(p_phone,''),status=p_status,max_hours_day=p_max_hours_day where teacher_id=tid;
    if not found then raise exception 'Enseignant introuvable' using errcode='P0002'; end if;
  end if;
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at) values(gen_random_uuid()::text,actor,'TEACHER_SAVED','teacher',tid,pg_catalog.clock_timestamp());
  return tid;
end; $$;

create or replace function public.direction_save_teacher_assignment(p_teacher_id text,p_subject_code text,p_shift text,p_classes text,p_weekly_hours integer,p_max_hours_day integer) returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid; t public.teachers%rowtype; sub public.subjects%rowtype;
begin
  if not private.is_direction() then raise exception 'Accès réservé à la Direction' using errcode='42501'; end if;
  select * into t from public.teachers where teacher_id=p_teacher_id for update; if not found then raise exception 'Enseignant introuvable' using errcode='P0002'; end if;
  select * into sub from public.subjects where code=p_subject_code; if not found then raise exception 'Matière introuvable' using errcode='22023'; end if;
  if exists(select 1 from public.lessons where teacher_id=p_teacher_id and is_active and subject_code<>p_subject_code) then raise exception 'Réattribuez les cours avant de changer sa matière' using errcode='23514'; end if;
  if exists(select 1 from pg_catalog.unnest(pg_catalog.string_to_array(coalesce(p_classes,''),',')) c where pg_catalog.btrim(c)<>'' and not exists(select 1 from public.classes x where x.class_id=pg_catalog.btrim(c))) then raise exception 'Une classe assignée est inconnue' using errcode='22023'; end if;
  if p_weekly_hours not between 0 and 40 or p_max_hours_day not between 1 and 12 then raise exception 'Charge horaire invalide' using errcode='22023'; end if;
  update public.teachers set subject_code=sub.code,subject_name=sub.name,shift=p_shift,max_hours_day=p_max_hours_day where teacher_id=p_teacher_id;
  insert into public.teacher_assignments(teacher_id,subject_name,shift,assigned_classes,weekly_hours,max_hours_day) values(p_teacher_id,sub.name,p_shift,pg_catalog.btrim(coalesce(p_classes,'')),p_weekly_hours,p_max_hours_day)
  on conflict(teacher_id) do update set subject_name=excluded.subject_name,shift=excluded.shift,assigned_classes=excluded.assigned_classes,weekly_hours=excluded.weekly_hours,max_hours_day=excluded.max_hours_day;
  actor:=(select auth.uid()); insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at) values(gen_random_uuid()::text,actor,'TEACHER_ASSIGNMENT_UPDATED','teacher',p_teacher_id,pg_catalog.clock_timestamp());
end; $$;

create or replace function public.direction_decide_return(p_decision_id text,p_action text,p_lesson_id text,p_lesson_date date,p_reason text) returns text language plpgsql security definer set search_path = '' as $$
declare actor uuid; d public.entry_decisions%rowtype; source public.attendance%rowtype; lesson public.lessons%rowtype; corrected text; outcome text;
begin
  if not private.is_direction() then raise exception 'Accès réservé à la Direction' using errcode='42501'; end if;
  if p_action not in ('AUTORISEE','REFUSEE') or pg_catalog.length(pg_catalog.btrim(coalesce(p_reason,'')))<5 or pg_catalog.length(p_reason)>500 then raise exception 'Décision et motif valides requis' using errcode='22023'; end if;
  select * into d from public.entry_decisions where decision_id=p_decision_id for update; if not found then raise exception 'Demande de retour introuvable' using errcode='P0002'; end if;
  select * into source from public.attendance where attendance_id=d.absence_attendance_id; if not found then raise exception 'Absence source introuvable' using errcode='22023'; end if;
  if not exists(select 1 from public.entry_holds h where h.absence_attendance_id=source.attendance_id and h.status='ACTIVE') then raise exception 'Le blocage n’est plus actif' using errcode='22023'; end if;
  select c.corrected_status into corrected from public.attendance_corrections c where c.attendance_id=source.attendance_id order by c.corrected_at desc limit 1;
  if coalesce(corrected,source.status)<>'ABSENT' then raise exception 'La présence ne constitue plus une absence active' using errcode='22023'; end if;
  actor:=(select auth.uid()); outcome:=p_action;
  if p_action='AUTORISEE' then
    if p_lesson_date is null or p_lesson_date<source.lesson_date or p_lesson_date<timezone('Africa/Casablanca',pg_catalog.clock_timestamp())::date then raise exception 'Date de retour invalide' using errcode='22023'; end if;
    select * into lesson from public.lessons where lesson_id=p_lesson_id and class_id=source.class_id and is_active; if not found then raise exception 'Cours de retour invalide' using errcode='22023'; end if;
    if lesson.day<>(case extract(isodow from p_lesson_date)::int when 1 then 'Lundi' when 2 then 'Mardi' when 3 then 'Mercredi' when 4 then 'Jeudi' when 5 then 'Vendredi' when 6 then 'Samedi' else 'Dimanche' end) then raise exception 'Le cours ne correspond pas au jour choisi' using errcode='22023'; end if;
    if p_lesson_date=source.lesson_date and lesson.start_time<=(select l.start_time from public.lessons l where l.lesson_id=source.lesson_id) then raise exception 'Choisissez un cours postérieur à l’absence' using errcode='22023'; end if;
    if exists(select 1 from public.attendance a where a.student_id=source.student_id and a.lesson_id=p_lesson_id and a.lesson_date=p_lesson_date) then raise exception 'Un appel existe déjà pour ce cours' using errcode='23505'; end if;
  else
    lesson:=null;
  end if;
  update public.entry_decisions set status=outcome,authorized_lesson_id=case when outcome='AUTORISEE' then lesson.lesson_id else null end,authorized_lesson_date=case when outcome='AUTORISEE' then p_lesson_date else null end,authorized_by=actor,direction_decision=outcome,decided_at=pg_catalog.clock_timestamp(),reason=pg_catalog.btrim(p_reason) where decision_id=d.decision_id;
  insert into public.entry_decision_events(event_id,decision_id,action,reason,actor_user_id,authorized_lesson_id,authorized_lesson_date,created_at,source) values(gen_random_uuid()::text,d.decision_id,outcome,pg_catalog.btrim(p_reason),actor,case when outcome='AUTORISEE' then lesson.lesson_id else null end,case when outcome='AUTORISEE' then p_lesson_date else null end,pg_catalog.clock_timestamp(),'SUPABASE');
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at) values(gen_random_uuid()::text,actor,'ENTRY_RETURN_'||outcome,'entry_decision',d.decision_id,pg_catalog.clock_timestamp());
  return d.decision_id;
end; $$;

revoke all on function public.direction_save_student(text,text,text,text,integer,text,text,text) from public,anon;
revoke all on function public.direction_archive_student(text) from public,anon;
revoke all on function public.direction_save_teacher(text,text,text,text,text,text,text,integer,text) from public,anon;
revoke all on function public.direction_save_teacher_assignment(text,text,text,text,integer,integer) from public,anon;
revoke all on function public.direction_decide_return(text,text,text,date,text) from public,anon;
grant execute on function public.direction_save_student(text,text,text,text,integer,text,text,text) to authenticated;
grant execute on function public.direction_archive_student(text) to authenticated;
grant execute on function public.direction_save_teacher(text,text,text,text,text,text,text,integer,text) to authenticated;
grant execute on function public.direction_save_teacher_assignment(text,text,text,text,integer,integer) to authenticated;
grant execute on function public.direction_decide_return(text,text,text,date,text) to authenticated;
