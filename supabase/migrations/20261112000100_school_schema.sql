create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  account_code text not null unique,
  legacy_user_id text not null unique,
  full_name text not null,
  role text not null check (role in ('DIRECTION','TEACHER','PARENT')),
  status text not null default 'ACTIVE',
  student_id text,
  teacher_id text,
  created_at timestamptz not null default now()
);
create table public.classes (class_id text primary key, name text, level text, track text, language text, enrollment integer);
create table public.subjects (code text primary key, name text not null, weekly_hours integer, color text, usual_room text);
create table public.teachers (
  teacher_id text primary key, login_id text not null unique, last_name text, first_name text,
  full_name text not null, subject_code text references public.subjects(code), subject_name text,
  shift text, email text, phone text, status text, max_hours_day integer, max_shift_day integer
);
create table public.students (
  student_id text primary key, massar_id text not null unique, last_name text, first_name text,
  full_name text not null, class_id text not null references public.classes(class_id), class_number integer not null,
  birth_date text, school_email text, status text, parent_id text, parent_name text, parent_phone text,
  parent_email text, photo_path text, provenance text default 'INITIAL_GENERATED_UNVERIFIED'
);
create table public.parents (
  parent_id text primary key, login_id text, last_name text, first_name text, full_name text not null,
  student_id text not null references public.students(student_id), child_massar_id text not null,
  child_name text not null, class_id text not null references public.classes(class_id), class_number integer not null,
  email text, phone text, registration_status text not null, submitted_at text, approved_at text,
  account_status text not null default 'PENDING'
);
alter table public.profiles add constraint profiles_student_fk foreign key (student_id) references public.students(student_id);
alter table public.profiles add constraint profiles_teacher_fk foreign key (teacher_id) references public.teachers(teacher_id);
create table public.rooms (room_name text primary key, active integer not null default 1);
create table public.teacher_assignments (teacher_id text primary key references public.teachers(teacher_id), subject_name text, shift text, assigned_classes text, weekly_hours integer, max_hours_day integer);
create table public.teacher_workload_summary (teacher_id text primary key references public.teachers(teacher_id), subject_name text, teacher_name text, shift text, weekly_hours integer, max_hours_day integer);
create table public.teacher_work_schedule (teacher_id text not null references public.teachers(teacher_id), day text not null, shift text, shift_start text, shift_end text, lesson_hours integer, day_status text, primary key(teacher_id,day));
create table public.class_weekly_shifts (class_id text not null references public.classes(class_id), day text not null, shift text not null, shift_start text, shift_end text, lesson_hours integer, primary key(class_id,day));
create table public.lessons (
  lesson_id text primary key, day text not null, day_index integer, shift text not null, slot_code text not null,
  start_time text not null, end_time text not null, class_id text not null references public.classes(class_id),
  subject_code text not null references public.subjects(code), subject_name text not null,
  teacher_id text not null references public.teachers(teacher_id), teacher_name text not null,
  room text, color text, is_active boolean not null default true,
  check(start_time < end_time)
);
create table public.lesson_occurrences (
  occurrence_id text primary key, lesson_id text not null references public.lessons(lesson_id),
  lesson_date date not null, starts_at timestamptz not null, ends_at timestamptz not null,
  unique(lesson_id,lesson_date), check(starts_at < ends_at)
);
create table public.attendance (
  attendance_id text primary key, occurrence_id text not null references public.lesson_occurrences(occurrence_id),
  lesson_id text not null references public.lessons(lesson_id), lesson_date date not null,
  day text, slot_code text, class_id text not null references public.classes(class_id),
  student_id text not null references public.students(student_id), massar_id text not null,
  student_name text not null, teacher_id text references public.teachers(teacher_id), teacher_name text,
  subject_name text, status text not null check(status in ('PRESENT','ABSENT','NOT_RECORDED')),
  access_status text, recorded_at timestamptz, provenance text default 'INITIAL_GENERATED_UNVERIFIED',
  unique(occurrence_id,student_id)
);
create table public.absence_explanations (
  explanation_id text primary key, student_id text references public.students(student_id), massar_id text,
  student_name text, class_id text references public.classes(class_id), lesson_id text references public.lessons(lesson_id),
  absence_date date, reason text, status text, direction_decision text, decided_by uuid references public.profiles(id),
  decided_at timestamptz, internal_note text, attendance_id text references public.attendance(attendance_id),
  submitted_by uuid references public.profiles(id), created_at timestamptz
);
create table public.absence_explanation_decisions (
  decision_id text primary key, explanation_id text not null references public.absence_explanations(explanation_id),
  action text not null, reason text not null default '', decided_by uuid references public.profiles(id),
  decided_at timestamptz not null, source text not null default 'LIVE'
);
create table public.entry_decisions (
  decision_id text primary key, student_id text references public.students(student_id), massar_id text,
  student_name text, class_id text references public.classes(class_id), absence_lesson_id text references public.lessons(lesson_id),
  status text, authorized_lesson_id text references public.lessons(lesson_id), direction_decision text,
  decided_at timestamptz, reason text, absence_attendance_id text references public.attendance(attendance_id),
  authorized_lesson_date date, authorized_by uuid references public.profiles(id)
);
create table public.entry_holds (
  hold_id text primary key, student_id text not null references public.students(student_id),
  absence_attendance_id text not null unique references public.attendance(attendance_id),
  status text not null check(status in ('ACTIVE','CLOSED')), created_at timestamptz not null,
  closed_at timestamptz, closed_by uuid references public.profiles(id), close_reason text
);
create table public.attendance_authorizations (
  attendance_id text primary key references public.attendance(attendance_id),
  decision_id text references public.entry_decisions(decision_id), explanation_id text references public.absence_explanations(explanation_id),
  approved_by uuid references public.profiles(id), approved_at timestamptz not null,
  check ((decision_id is not null and explanation_id is null) or (decision_id is null and explanation_id is not null))
);
create table public.attendance_corrections (
  correction_id text primary key, attendance_id text references public.attendance(attendance_id),
  lesson_id text references public.lessons(lesson_id), student_id text references public.students(student_id),
  massar_id text, student_name text, original_status text, corrected_status text, reason text,
  actor text, corrected_at timestamptz, note text
);
create table public.entry_decision_events (
  event_id text primary key, decision_id text not null references public.entry_decisions(decision_id),
  action text not null, reason text not null default '', actor_user_id uuid references public.profiles(id),
  authorized_lesson_id text references public.lessons(lesson_id), authorized_lesson_date date,
  created_at timestamptz not null, source text not null default 'LIVE'
);
create table public.absence_explanation_documents (
  doc_id text primary key, explanation_id text not null references public.absence_explanations(explanation_id),
  original_filename text not null, content_type text not null check(content_type in ('application/pdf','image/png','image/jpeg')),
  storage_key text not null unique, size_bytes integer not null check(size_bytes between 1 and 2097152),
  uploaded_by uuid references public.profiles(id), uploaded_at timestamptz not null
);
create table public.notifications (notification_id text primary key, role text, user_id uuid references public.profiles(id), title text, message text, created_at timestamptz, is_read text);
create table public.parent_registration_requests (
  request_id text primary key, parent_id text not null, parent_name text not null, child_name text not null,
  class_id text not null references public.classes(class_id), class_number integer not null, massar_id text not null,
  email text, phone text, submitted_at timestamptz not null, status text not null,
  decision_by uuid references public.profiles(id), decision_at timestamptz, rejection_reason text
);
create table private.parent_registration_credentials (
  request_id text primary key references public.parent_registration_requests(request_id) on delete cascade,
  password_hash text not null
);
create table public.teacher_absences (absence_id text primary key, teacher_id text references public.teachers(teacher_id), teacher_name text, absence_date date, type text, reason text, substitute text, status text);
create table public.school_settings (setting_key text primary key, setting_value text not null);
create table public.audit_log (event_id text primary key, actor_user_id uuid references public.profiles(id), action text not null, entity_type text not null, entity_id text, created_at timestamptz not null default now());
create table public.nfc_cards (card_id text primary key, card_uid text not null unique, student_id text not null references public.students(student_id), active boolean not null default true, assigned_at timestamptz not null default now(), revoked_at timestamptz);
create table public.registered_devices (device_id text primary key, name text not null, credential_hash text not null, active boolean not null default true, created_at timestamptz not null default now(), revoked_at timestamptz);
create table public.device_scan_events (event_id text primary key, device_id text not null references public.registered_devices(device_id), card_uid text not null, student_id text references public.students(student_id), occurrence_id text references public.lesson_occurrences(occurrence_id), received_at timestamptz not null default now(), result text not null, unique(device_id,event_id));

create index attendance_student_date_idx on public.attendance(student_id,lesson_date desc);
create index attendance_class_date_idx on public.attendance(class_id,lesson_date desc);
create unique index lessons_active_class_slot_unique on public.lessons(class_id,day,slot_code) where is_active;
create unique index lessons_active_teacher_slot_unique on public.lessons(teacher_id,day,slot_code) where is_active;
create index lessons_teacher_day_idx on public.lessons(teacher_id,is_active,day_index,start_time);
create index lessons_class_day_idx on public.lessons(class_id,is_active,day_index,start_time);
create index explanations_student_date_idx on public.absence_explanations(student_id,absence_date desc);
create index explanations_status_idx on public.absence_explanations(status,absence_date desc);
create index holds_student_status_idx on public.entry_holds(student_id,status,created_at);
create index parent_requests_status_idx on public.parent_registration_requests(status,submitted_at desc);
create index notifications_user_idx on public.notifications(user_id,created_at desc);

create or replace function private.current_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid()) and p.status = 'ACTIVE'
$$;
create or replace function private.is_direction() returns boolean
language sql stable security definer set search_path = '' as $$ select private.current_role() = 'DIRECTION' $$;
create or replace function private.is_parent_of(target_student text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='PARENT' and p.status='ACTIVE' and p.student_id=target_student)
$$;
create or replace function private.teaches_class(target_class text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p join public.lessons l on l.teacher_id=p.teacher_id where p.id=(select auth.uid()) and p.role='TEACHER' and p.status='ACTIVE' and l.class_id=target_class and l.is_active)
$$;
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
  select * into student from public.students where student_id=p_student_id and class_id=lesson.class_id;
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
create or replace function public.direction_authorize_return(p_absence_attendance_id text, p_lesson_id text, p_lesson_date date, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare actor uuid; source public.attendance%rowtype; target public.lessons%rowtype; result_id text;
begin
  if not private.is_direction() then raise exception 'Accès réservé à la Direction' using errcode='42501'; end if;
  select id into actor from public.profiles where id=(select auth.uid());
  select * into source from public.attendance where attendance_id=p_absence_attendance_id and status='ABSENT';
  if not found then raise exception 'Absence source introuvable' using errcode='22023'; end if;
  select * into target from public.lessons where lesson_id=p_lesson_id and class_id=source.class_id and is_active;
  if not found then raise exception 'Cours autorisé invalide' using errcode='22023'; end if;
  if target.day <> (case extract(isodow from p_lesson_date)::int when 1 then 'Lundi' when 2 then 'Mardi' when 3 then 'Mercredi' when 4 then 'Jeudi' when 5 then 'Vendredi' when 6 then 'Samedi' else 'Dimanche' end) then
    raise exception 'La date ne correspond pas au jour de ce cours' using errcode='22023';
  end if;
  if p_reason is null or length(pg_catalog.btrim(p_reason))<5 then raise exception 'Motif requis (5 caractères minimum)' using errcode='22023'; end if;
  result_id:='RET-'||gen_random_uuid()::text;
  insert into public.entry_decisions(decision_id,student_id,massar_id,student_name,class_id,absence_lesson_id,status,authorized_lesson_id,direction_decision,decided_at,reason,absence_attendance_id,authorized_lesson_date,authorized_by)
  values(result_id,source.student_id,source.massar_id,source.student_name,source.class_id,source.lesson_id,'AUTORISEE',p_lesson_id,'AUTORISEE',pg_catalog.clock_timestamp(),p_reason,source.attendance_id,p_lesson_date,actor);
  return result_id;
end; $$;
create or replace function public.direction_correct_attendance(p_attendance_id text, p_status text, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare actor uuid; source public.attendance%rowtype; result_id text;
begin
  if not private.is_direction() then raise exception 'Accès réservé à la Direction' using errcode='42501'; end if;
  if p_status not in ('PRESENT','ABSENT','NOT_RECORDED') or p_reason is null or length(pg_catalog.btrim(p_reason))<5 then raise exception 'Correction invalide ou motif requis' using errcode='22023'; end if;
  select * into source from public.attendance where attendance_id=p_attendance_id;
  if not found then raise exception 'Présence introuvable' using errcode='22023'; end if;
  select id into actor from public.profiles where id=(select auth.uid());
  result_id:='COR-'||gen_random_uuid()::text;
  insert into public.attendance_corrections(correction_id,attendance_id,lesson_id,student_id,massar_id,student_name,original_status,corrected_status,reason,actor,corrected_at)
  values(result_id,source.attendance_id,source.lesson_id,source.student_id,source.massar_id,source.student_name,source.status,p_status,p_reason,actor::text,pg_catalog.clock_timestamp());
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at) values(gen_random_uuid()::text,actor,'ATTENDANCE_CORRECTED','attendance',source.attendance_id,pg_catalog.clock_timestamp());
  return result_id;
end; $$;
revoke all on function public.submit_attendance(text,text,text) from public, anon;
revoke all on function public.direction_authorize_return(text,text,date,text) from public, anon;
revoke all on function public.direction_correct_attendance(text,text,text) from public, anon;
grant execute on function public.submit_attendance(text,text,text) to authenticated;
grant execute on function public.direction_authorize_return(text,text,date,text) to authenticated;
grant execute on function public.direction_correct_attendance(text,text,text) to authenticated;
revoke all on function private.current_role() from public, anon;
revoke all on function private.is_direction() from public, anon;
revoke all on function private.is_parent_of(text) from public, anon;
revoke all on function private.teaches_class(text) from public, anon;
grant execute on function private.current_role() to authenticated;
grant execute on function private.is_direction() to authenticated;
grant execute on function private.is_parent_of(text) to authenticated;
grant execute on function private.teaches_class(text) to authenticated;
grant usage on schema private to authenticated;

do $$ declare t text; begin
  foreach t in array array['profiles','classes','subjects','teachers','students','parents','rooms','teacher_assignments','teacher_workload_summary','teacher_work_schedule','class_weekly_shifts','lessons','lesson_occurrences','attendance','absence_explanations','absence_explanation_decisions','entry_decisions','entry_holds','attendance_authorizations','attendance_corrections','entry_decision_events','absence_explanation_documents','notifications','parent_registration_requests','teacher_absences','school_settings','audit_log','nfc_cards','registered_devices','device_scan_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
  end loop;
end; $$;
grant select on public.profiles to authenticated;
grant select on public.students,public.parents,public.teachers,public.classes,public.subjects,public.lessons,public.lesson_occurrences,public.attendance,public.absence_explanations,public.absence_explanation_decisions,public.entry_decisions,public.entry_holds,public.attendance_authorizations,public.attendance_corrections,public.entry_decision_events,public.absence_explanation_documents,public.notifications,public.teacher_assignments,public.teacher_workload_summary,public.teacher_work_schedule,public.class_weekly_shifts,public.rooms,public.school_settings to authenticated;
grant insert on public.absence_explanations to authenticated;
grant update on public.absence_explanations to authenticated;
grant insert,update on public.attendance_corrections,public.entry_decisions,public.entry_holds,public.notifications,public.school_settings,public.teachers,public.students,public.parents,public.lessons,public.teacher_assignments,public.teacher_work_schedule,public.class_weekly_shifts to authenticated;

create policy profiles_self on public.profiles for select to authenticated using(id=(select auth.uid()) or (select private.is_direction()));
create policy classes_role_read on public.classes for select to authenticated using((select private.is_direction()) or (select private.teaches_class(class_id)) or exists(select 1 from public.profiles p join public.students s on s.student_id=p.student_id where p.id=(select auth.uid()) and p.role='PARENT' and s.class_id=classes.class_id));
create policy students_role_read on public.students for select to authenticated using((select private.is_direction()) or (select private.is_parent_of(student_id)) or (select private.teaches_class(class_id)));
create policy parents_role_read on public.parents for select to authenticated using((select private.is_direction()) or (select private.is_parent_of(student_id)));
create policy teachers_role_read on public.teachers for select to authenticated using((select private.is_direction()) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.teacher_id=teachers.teacher_id));
create policy subjects_read on public.subjects for select to authenticated using(true);
create policy lessons_role_read on public.lessons for select to authenticated using((select private.is_direction()) or (select private.teaches_class(class_id)) or exists(select 1 from public.profiles p join public.students s on s.student_id=p.student_id where p.id=(select auth.uid()) and p.role='PARENT' and s.class_id=lessons.class_id));
create policy occurrences_role_read on public.lesson_occurrences for select to authenticated using((select private.is_direction()) or exists(select 1 from public.lessons l where l.lesson_id=lesson_occurrences.lesson_id and ((select private.teaches_class(l.class_id)) or exists(select 1 from public.profiles p join public.students s on s.student_id=p.student_id where p.id=(select auth.uid()) and p.role='PARENT' and s.class_id=l.class_id))));
create policy attendance_role_read on public.attendance for select to authenticated using((select private.is_direction()) or (select private.is_parent_of(student_id)) or (select private.teaches_class(class_id)));
create policy authorizations_role_read on public.attendance_authorizations for select to authenticated using((select private.is_direction()) or exists(select 1 from public.attendance a where a.attendance_id=attendance_authorizations.attendance_id and ((select private.is_parent_of(a.student_id)) or (select private.teaches_class(a.class_id)))));
create policy explanations_role_read on public.absence_explanations for select to authenticated using((select private.is_direction()) or (select private.is_parent_of(student_id)));
create policy explanations_parent_insert on public.absence_explanations for insert to authenticated with check((select private.is_parent_of(student_id)) and status='EN_ATTENTE' and submitted_by=(select auth.uid()) and exists(select 1 from public.attendance a where a.attendance_id=absence_explanations.attendance_id and a.student_id=absence_explanations.student_id and a.status='ABSENT'));
create policy direction_explanations_update on public.absence_explanations for update to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy direction_records_read on public.teacher_assignments for select to authenticated using((select private.is_direction()) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.teacher_id=teacher_assignments.teacher_id));
create policy direction_workload_read on public.teacher_workload_summary for select to authenticated using((select private.is_direction()) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.teacher_id=teacher_workload_summary.teacher_id));
create policy direction_schedule_read on public.teacher_work_schedule for select to authenticated using((select private.is_direction()) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.teacher_id=teacher_work_schedule.teacher_id));
create policy direction_shift_read on public.class_weekly_shifts for select to authenticated using((select private.is_direction()) or (select private.teaches_class(class_id)));
create policy direction_mutation_teachers on public.teachers for update to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy direction_mutation_students on public.students for update to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy direction_mutation_parents on public.parents for update to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy direction_mutation_lessons on public.lessons for update to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy direction_mutation_assignments on public.teacher_assignments for all to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy direction_mutation_work_schedule on public.teacher_work_schedule for all to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy direction_mutation_shifts on public.class_weekly_shifts for all to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy direction_corrections_read on public.attendance_corrections for select to authenticated using((select private.is_direction()));
create policy direction_corrections_insert on public.attendance_corrections for insert to authenticated with check((select private.is_direction()));
create policy direction_entry_decisions on public.entry_decisions for all to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy direction_entry_holds on public.entry_holds for all to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy direction_notifications on public.notifications for all to authenticated using((select private.is_direction()) or user_id=(select auth.uid())) with check((select private.is_direction()) or user_id=(select auth.uid()));
create policy direction_settings on public.school_settings for all to authenticated using((select private.is_direction())) with check((select private.is_direction()));
grant select,insert,update,delete on public.classes,public.subjects,public.rooms,public.absence_explanation_decisions,public.entry_decision_events,public.absence_explanation_documents,public.parent_registration_requests,public.teacher_absences to authenticated;
create policy direction_classes_manage on public.classes for all to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy direction_subjects_manage on public.subjects for all to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy direction_rooms_manage on public.rooms for all to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy explanation_decisions_role_read on public.absence_explanation_decisions for select to authenticated using((select private.is_direction()) or exists(select 1 from public.absence_explanations e where e.explanation_id=absence_explanation_decisions.explanation_id and (select private.is_parent_of(e.student_id))));
create policy explanation_decisions_direction_insert on public.absence_explanation_decisions for insert to authenticated with check((select private.is_direction()));
create policy entry_events_role_read on public.entry_decision_events for select to authenticated using((select private.is_direction()) or exists(select 1 from public.entry_decisions d where d.decision_id=entry_decision_events.decision_id and (select private.teaches_class(d.class_id))));
create policy entry_events_direction_insert on public.entry_decision_events for insert to authenticated with check((select private.is_direction()));
create policy holds_role_read on public.entry_holds for select to authenticated using((select private.is_direction()) or exists(select 1 from public.students s where s.student_id=entry_holds.student_id and (select private.teaches_class(s.class_id))));
create policy documents_role_read on public.absence_explanation_documents for select to authenticated using((select private.is_direction()) or exists(select 1 from public.absence_explanations e where e.explanation_id=absence_explanation_documents.explanation_id and (select private.is_parent_of(e.student_id))));
create policy direction_documents_insert on public.absence_explanation_documents for insert to authenticated with check((select private.is_direction()));
create policy requests_direction_only on public.parent_registration_requests for all to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy teacher_absences_role_read on public.teacher_absences for select to authenticated using((select private.is_direction()) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.teacher_id=teacher_absences.teacher_id));
create policy direction_teacher_absences_manage on public.teacher_absences for all to authenticated using((select private.is_direction())) with check((select private.is_direction()));
create policy audit_direction_only on public.audit_log for select to authenticated using((select private.is_direction()));
grant select on public.audit_log to authenticated;

-- Keep attendance append-only; corrections and approvals are written through the restricted RPCs.
revoke insert,update,delete on public.attendance,public.attendance_authorizations,public.audit_log from anon,authenticated;
revoke insert,update,delete on public.entry_holds,public.entry_decisions,public.entry_decision_events,public.attendance_corrections from anon,authenticated;

alter table public.attendance replica identity full;
alter publication supabase_realtime add table public.attendance;
