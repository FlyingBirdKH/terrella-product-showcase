-- Test-only stand-in for a stock Supabase database.
-- Production crm-core already has anon, authenticated, authenticator, and service_role.
-- Do not apply this file to crm-core. It does not create login users or admin roles.

do $$
declare
  role_name text;
begin
  foreach role_name in array array['kevin_admin', 'terralla_admin', 'terralla_team', 'admin', 'sourcing_manager']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('drop owned by %I', role_name);
      execute format('drop role %I', role_name);
    end if;
  end loop;
  foreach role_name in array array['anon', 'authenticated', 'authenticator', 'service_role']
  loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      execute format('create role %I nologin', role_name);
    end if;
  end loop;
end $$;

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function auth.jwt() to authenticated;
revoke all on function auth.uid() from public, anon, service_role;
revoke all on function auth.jwt() from public, anon, service_role;
