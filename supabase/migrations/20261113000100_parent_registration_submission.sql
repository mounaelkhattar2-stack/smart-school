-- Public registration accepts only validated requests; Direction approval remains separate.
create or replace function public.service_submit_parent_registration(
  p_request_id text,p_parent_id text,p_parent_name text,p_child_name text,p_class_id text,
  p_class_number integer,p_massar_id text,p_email text,p_phone text,p_password_hash text
) returns text language plpgsql security definer set search_path = '' as $$
declare s public.students%rowtype; v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  if p_request_id !~ '^INS-[0-9a-f-]{36}$' or p_parent_id !~ '^PAR-[0-9a-f-]{36}$'
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_parent_name,''))) not between 3 and 120
    or p_class_number not between 1 and 60
    or p_password_hash !~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$'
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_email,''))) not between 6 and 160
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_phone,''))) not between 6 and 30 then
    raise exception 'Invalid registration request' using errcode='22023';
  end if;
  select * into s from public.students
   where upper(massar_id)=upper(pg_catalog.btrim(p_massar_id))
     and upper(class_id)=upper(pg_catalog.btrim(p_class_id))
     and class_number=p_class_number
     and lower(pg_catalog.btrim(full_name))=lower(pg_catalog.btrim(p_child_name))
   for update;
  if not found then raise exception 'Student relationship could not be verified' using errcode='P0002'; end if;
  if exists(select 1 from public.parents where student_id=s.student_id and registration_status in ('APPROUVEE','EN_ATTENTE'))
     or exists(select 1 from public.parent_registration_requests where massar_id=s.massar_id and status='EN_ATTENTE') then
    raise exception 'An active or pending parent relationship already exists' using errcode='23505';
  end if;
  insert into public.parents(parent_id,full_name,student_id,child_massar_id,child_name,class_id,class_number,email,phone,registration_status,submitted_at,account_status)
  values(p_parent_id,pg_catalog.btrim(p_parent_name),s.student_id,s.massar_id,s.full_name,s.class_id,s.class_number,pg_catalog.btrim(p_email),pg_catalog.btrim(p_phone),'EN_ATTENTE',v_now::text,'PENDING');
  insert into public.parent_registration_requests(request_id,parent_id,parent_name,child_name,class_id,class_number,massar_id,email,phone,submitted_at,status)
  values(p_request_id,p_parent_id,pg_catalog.btrim(p_parent_name),s.full_name,s.class_id,s.class_number,s.massar_id,pg_catalog.btrim(p_email),pg_catalog.btrim(p_phone),v_now,'EN_ATTENTE');
  insert into private.parent_registration_credentials(request_id,password_hash) values(p_request_id,p_password_hash);
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at)
  values(gen_random_uuid()::text,null,'PARENT_REGISTRATION_SUBMITTED','parent_registration_request',p_request_id,v_now);
  return p_request_id;
end; $$;
revoke all on function public.service_submit_parent_registration(text,text,text,text,text,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.service_submit_parent_registration(text,text,text,text,text,integer,text,text,text,text) to service_role;
