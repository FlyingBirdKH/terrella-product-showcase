-- Test-only NOLOGIN roles. Do not apply this file to crm-core.
-- Production already has kevin_admin, terralla_admin, and terralla_team.
-- This file does not create login users and does not read auth.users.

do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'kevin_admin', 'terralla_admin', 'terralla_team', 'admin', 'sourcing_manager']
  loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      execute format('create role %I nologin', role_name);
    end if;
  end loop;
end $$;
