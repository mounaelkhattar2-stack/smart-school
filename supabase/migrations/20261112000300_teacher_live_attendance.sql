create or replace function public.teacher_submit_attendance(p_lesson_id text,p_lesson_date date,p_student_id text,p_status text)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles%rowtype;
  lesson public.lessons%rowtype;
  occurrence_id text;
  starts_at timestamptz;
  ends_at timestamptz;
  today_local date;
  expected_day text;
begin
  select * into actor from public.profiles where id=(select auth.uid()) and role='TEACHER' and status='ACTIVE';
  if not found then raise exception 'Compte enseignant inactif ou non autorisé' using errcode='42501'; end if;
  today_local:=timezone('Africa/Casablanca',pg_catalog.clock_timestamp())::date;
  if p_lesson_date is distinct from today_local then raise exception 'La saisie est limitée à la date du jour' using errcode='42501'; end if;
  select * into lesson from public.lessons where lesson_id=p_lesson_id and is_active and teacher_id=actor.teacher_id;
  if not found then raise exception 'Cours non attribué à cet enseignant' using errcode='42501'; end if;
  expected_day:=case extract(isodow from p_lesson_date)::int when 1 then 'Lundi' when 2 then 'Mardi' when 3 then 'Mercredi' when 4 then 'Jeudi' when 5 then 'Vendredi' when 6 then 'Samedi' else 'Dimanche' end;
  if lesson.day<>expected_day then raise exception 'La date ne correspond pas au jour du cours' using errcode='22023'; end if;
  starts_at:=(p_lesson_date+lesson.start_time::time) at time zone 'Africa/Casablanca';
  ends_at:=(p_lesson_date+lesson.end_time::time) at time zone 'Africa/Casablanca';
  if starts_at>pg_catalog.clock_timestamp() or ends_at<=pg_catalog.clock_timestamp() then raise exception 'L’appel est disponible uniquement pendant le cours' using errcode='42501'; end if;
  occurrence_id:=lesson.lesson_id||'::'||p_lesson_date::text;
  insert into public.lesson_occurrences(occurrence_id,lesson_id,lesson_date,starts_at,ends_at)
    values(occurrence_id,lesson.lesson_id,p_lesson_date,starts_at,ends_at)
    on conflict(lesson_id,lesson_date) do nothing;
  select o.occurrence_id into occurrence_id from public.lesson_occurrences o where o.lesson_id=lesson.lesson_id and o.lesson_date=p_lesson_date;
  return public.submit_attendance(occurrence_id,p_student_id,p_status);
end; $$;
revoke all on function public.teacher_submit_attendance(text,date,text,text) from public,anon;
grant execute on function public.teacher_submit_attendance(text,date,text,text) to authenticated;
