create or replace function public.direction_save_subject(p_code text,p_name text,p_weekly_hours integer,p_color text,p_usual_room text) returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid; old_name text;
begin
  if not private.is_direction() then raise exception 'Accès réservé à la Direction' using errcode='42501'; end if;
  if length(pg_catalog.btrim(coalesce(p_code,'')))<2 or length(pg_catalog.btrim(coalesce(p_name,'')))<2 or p_weekly_hours not between 0 and 40 or p_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Matière invalide' using errcode='22023'; end if;
  select name into old_name from public.subjects where code=p_code for update;
  if not found then
    insert into public.subjects(code,name,weekly_hours,color,usual_room) values(pg_catalog.upper(pg_catalog.btrim(p_code)),pg_catalog.btrim(p_name),p_weekly_hours,p_color,nullif(pg_catalog.btrim(coalesce(p_usual_room,'')),''));
  else
    update public.subjects set name=pg_catalog.btrim(p_name),weekly_hours=p_weekly_hours,color=p_color,usual_room=nullif(pg_catalog.btrim(coalesce(p_usual_room,'')),'') where code=p_code;
    update public.teachers set subject_name=pg_catalog.btrim(p_name) where subject_code=p_code;
    update public.teacher_assignments set subject_name=pg_catalog.btrim(p_name) where subject_name=old_name;
    update public.teacher_workload_summary set subject_name=pg_catalog.btrim(p_name) where subject_name=old_name;
    update public.lessons set subject_name=pg_catalog.btrim(p_name),color=p_color where subject_code=p_code;
  end if;
  actor:=(select auth.uid());insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at) values(gen_random_uuid()::text,actor,'SUBJECT_SAVED','subject',p_code,pg_catalog.clock_timestamp());
end; $$;
revoke all on function public.direction_save_subject(text,text,integer,text,text) from public,anon;
grant execute on function public.direction_save_subject(text,text,integer,text,text) to authenticated;
