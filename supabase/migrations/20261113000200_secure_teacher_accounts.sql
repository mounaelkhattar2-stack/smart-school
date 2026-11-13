-- Privileged account operations are invoked only by server-side Edge Functions.
create or replace function public.service_create_teacher_profile(p_teacher_id text,p_auth_user_id uuid,p_direction_user_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare t public.teachers%rowtype;
begin
  if not exists(select 1 from public.profiles where id=p_direction_user_id and role='DIRECTION' and status='ACTIVE') then raise exception 'Direction caller is not active' using errcode='42501'; end if;
  select * into t from public.teachers where teacher_id=p_teacher_id and status='Actif' for update;
  if not found then raise exception 'Enseignant actif introuvable' using errcode='P0002'; end if;
  if exists(select 1 from public.profiles where teacher_id=t.teacher_id or account_code=t.login_id) then raise exception 'Ce compte enseignant existe déjà' using errcode='23505'; end if;
  insert into public.profiles(id,account_code,legacy_user_id,full_name,role,status,teacher_id)
  values(p_auth_user_id,t.login_id,'USR-'||t.teacher_id,t.full_name,'TEACHER','RESET_REQUIRED',t.teacher_id);
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at)
  values(gen_random_uuid()::text,p_direction_user_id,'TEACHER_ACCOUNT_CREATED','teacher',t.teacher_id,pg_catalog.clock_timestamp());
  return t.login_id;
end; $$;
revoke all on function public.service_create_teacher_profile(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_create_teacher_profile(text,uuid,uuid) to service_role;

create or replace function public.service_require_password_reset(p_user_id uuid,p_direction_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.profiles%rowtype;
begin
  if not exists(select 1 from public.profiles where id=p_direction_user_id and role='DIRECTION' and status='ACTIVE') then raise exception 'Direction caller is not active' using errcode='42501'; end if;
  select * into p from public.profiles where id=p_user_id and role in ('PARENT','TEACHER') and status='ACTIVE' for update;
  if not found then raise exception 'Compte actif Parent/Enseignant introuvable' using errcode='P0002'; end if;
  update public.profiles set status='RESET_REQUIRED' where id=p_user_id;
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at)
  values(gen_random_uuid()::text,p_direction_user_id,'ACCOUNT_PASSWORD_RESET_REQUIRED','profile',p_user_id::text,pg_catalog.clock_timestamp());
end; $$;
revoke all on function public.service_require_password_reset(uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_require_password_reset(uuid,uuid) to service_role;

create or replace function public.service_complete_password_reset(p_user_id uuid,p_direction_user_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where id=p_user_id and role in ('PARENT','TEACHER') and status='RESET_REQUIRED' for update;
  if not found then raise exception 'Aucun changement de mot de passe en attente' using errcode='40001'; end if;
  if p_direction_user_id is not null and not exists(select 1 from public.profiles where id=p_direction_user_id and role='DIRECTION' and status='ACTIVE') then raise exception 'Direction caller is not active' using errcode='42501'; end if;
  update public.profiles set status='ACTIVE' where id=p_user_id;
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at)
  values(gen_random_uuid()::text,coalesce(p_direction_user_id,p_user_id),'ACCOUNT_PASSWORD_RESET_COMPLETED','profile',p_user_id::text,pg_catalog.clock_timestamp());
end; $$;
revoke all on function public.service_complete_password_reset(uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_complete_password_reset(uuid,uuid) to service_role;

create or replace function public.direction_set_account_status(p_user_id uuid,p_status text) returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid; target public.profiles%rowtype;
begin
  if not private.is_direction() then raise exception 'Accès réservé à la Direction' using errcode='42501'; end if;
  if p_status not in ('ACTIVE','INACTIVE') then raise exception 'État de compte invalide' using errcode='22023'; end if;
  select * into target from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Compte introuvable' using errcode='P0002'; end if;
  if target.status='RESET_REQUIRED' and p_status='ACTIVE' then raise exception 'Le titulaire doit terminer le changement de mot de passe' using errcode='23514'; end if;
  if target.role='DIRECTION' and p_status='INACTIVE' and (select count(*) from public.profiles where role='DIRECTION' and status='ACTIVE')<=1 then raise exception 'Le dernier compte Direction ne peut pas être désactivé' using errcode='23514'; end if;
  update public.profiles set status=p_status where id=p_user_id;
  actor:=(select auth.uid());
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at) values(gen_random_uuid()::text,actor,'ACCOUNT_STATUS_CHANGED','profile',p_user_id::text,pg_catalog.clock_timestamp());
end; $$;
