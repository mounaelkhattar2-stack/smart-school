-- Secure server-only access to pending registration hashes plus audited finalization.
create or replace function public.service_pending_parent_password_hash(p_request_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  select c.password_hash into v_hash
  from private.parent_registration_credentials c
  join public.parent_registration_requests r using(request_id)
  where c.request_id=p_request_id and r.status='EN_ATTENTE';
  if not found then raise exception 'Pending request credential unavailable' using errcode='P0002'; end if;
  return v_hash;
end; $$;
revoke all on function public.service_pending_parent_password_hash(text) from public,anon,authenticated;
grant execute on function public.service_pending_parent_password_hash(text) to service_role;

create or replace function public.service_finalize_parent_registration(p_request_id text,p_auth_user_id uuid,p_direction_user_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.parent_registration_requests%rowtype; p public.parents%rowtype; s public.students%rowtype; v_login text;
begin
  select * into r from public.parent_registration_requests where request_id=p_request_id for update;
  if not found or r.status<>'EN_ATTENTE' then raise exception 'Request already processed or missing' using errcode='40001'; end if;
  if not exists(select 1 from public.profiles where id=p_direction_user_id and role='DIRECTION' and status='ACTIVE') then raise exception 'Direction caller is not active' using errcode='42501'; end if;
  select * into p from public.parents where parent_id=r.parent_id for update;
  if not found then raise exception 'Parent record is missing' using errcode='P0002'; end if;
  select * into s from public.students where massar_id=r.massar_id and class_id=r.class_id and class_number=r.class_number for update;
  if not found or s.student_id is distinct from p.student_id or lower(pg_catalog.btrim(s.full_name))<>lower(pg_catalog.btrim(r.child_name)) then raise exception 'Requested child relationship does not match school records' using errcode='23514'; end if;
  if exists(select 1 from public.profiles where account_code=coalesce(nullif(p.login_id,''),p.parent_id) or legacy_user_id='USR-'||p.parent_id) then raise exception 'Parent login is already assigned' using errcode='23505'; end if;
  v_login:=coalesce(nullif(pg_catalog.btrim(p.login_id),''),p.parent_id);
  update public.parents set login_id=v_login,registration_status='APPROUVEE',approved_at=pg_catalog.clock_timestamp()::text,account_status='ACTIVE' where parent_id=p.parent_id;
  update public.parent_registration_requests set status='APPROUVEE',decision_by=p_direction_user_id,decision_at=pg_catalog.clock_timestamp(),rejection_reason=null where request_id=p_request_id;
  insert into public.profiles(id,account_code,legacy_user_id,full_name,role,status,student_id)
  values(p_auth_user_id,v_login,'USR-'||p.parent_id,p.full_name,'PARENT','ACTIVE',p.student_id);
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at)
  values(gen_random_uuid()::text,p_direction_user_id,'PARENT_REQUEST_APPROVED','parent_registration_request',p_request_id,pg_catalog.clock_timestamp());
  return v_login;
end; $$;
revoke all on function public.service_finalize_parent_registration(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_finalize_parent_registration(text,uuid,uuid) to service_role;

create or replace function public.direction_reject_parent_registration(p_request_id text,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid; r public.parent_registration_requests%rowtype;
begin
  if not private.is_direction() then raise exception 'Accès réservé à la Direction' using errcode='42501'; end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_reason,'')))<3 or pg_catalog.length(p_reason)>500 then raise exception 'Un motif de refus valide est obligatoire' using errcode='22023'; end if;
  select * into r from public.parent_registration_requests where request_id=p_request_id and status='EN_ATTENTE' for update;
  if not found then raise exception 'Demande déjà traitée ou introuvable' using errcode='40001'; end if;
  actor:=(select auth.uid());
  update public.parent_registration_requests set status='REFUSEE',decision_by=actor,decision_at=pg_catalog.clock_timestamp(),rejection_reason=pg_catalog.btrim(p_reason) where request_id=p_request_id;
  update public.parents set registration_status='REFUSEE',account_status='REJECTED' where parent_id=r.parent_id and registration_status='EN_ATTENTE';
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at) values(gen_random_uuid()::text,actor,'PARENT_REQUEST_REJECTED','parent_registration_request',p_request_id,pg_catalog.clock_timestamp());
end; $$;
revoke all on function public.direction_reject_parent_registration(text,text) from public,anon;
grant execute on function public.direction_reject_parent_registration(text,text) to authenticated;
