create or replace function public.direction_set_account_status(p_user_id uuid,p_status text) returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid; target public.profiles%rowtype; active_directions integer;
begin
  if not private.is_direction() then raise exception 'Accès réservé à la Direction' using errcode='42501'; end if;
  if p_status not in ('ACTIVE','INACTIVE') then raise exception 'Statut de compte invalide' using errcode='22023'; end if;
  select * into target from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Compte introuvable' using errcode='P0002'; end if;
  if target.role='DIRECTION' and p_status='INACTIVE' then
    select count(*) into active_directions from public.profiles where role='DIRECTION' and status='ACTIVE';
    if active_directions<=1 then raise exception 'Le dernier compte Direction actif ne peut pas être désactivé' using errcode='23514'; end if;
  end if;
  actor:=(select auth.uid());
  update public.profiles set status=p_status where id=p_user_id;
  insert into public.audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at)
    values(gen_random_uuid()::text,actor,'ACCOUNT_'||p_status,'profile',p_user_id::text,pg_catalog.clock_timestamp());
end; $$;
revoke all on function public.direction_set_account_status(uuid,text) from public,anon;
grant execute on function public.direction_set_account_status(uuid,text) to authenticated;
