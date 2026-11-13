-- The server-only key reads the verified account profile when exchanging Auth JWTs for the legacy local session.
grant select on public.profiles to service_role;
