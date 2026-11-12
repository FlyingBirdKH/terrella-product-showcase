-- crm-core internal preview ledger. Apply manually. This file does not run itself.
-- It adds a selection table keyed by product id, full SHA-256, revision, and event id.
-- crm-core public has no such table. This does not alter terralla_skus.
-- It does not read auth.users, does not create users, and does not create admin roles.
-- It does not call current_app_role() or is_internal_editor(). Those belong to supplier product_images.
-- It does not change anonymous product reads. That predicate stays deleted_at is null
-- and status in shortlisted, ready_for_shopify, live.
-- It does not insert CAT-003, CAT-006, or any other product row.
-- CAT-001 brand_id is terralla. Every preview row is forced to that brand.
-- Write requires JWT role kevin_admin or terralla_admin.
-- terralla_team may read and may not write.
-- Do not add schema internal_preview to exposed Data API schemas.
-- Do not grant these functions to the service role or put that key in a browser.

create schema if not exists internal_preview;

revoke all on schema internal_preview from public, anon, authenticated;
grant usage on schema internal_preview to kevin_admin, terralla_admin, terralla_team;

create table if not exists internal_preview.events (
  event_id text primary key,
  product_id uuid not null,
  sha256 text not null,
  selected boolean not null,
  base_revision bigint not null,
  revision bigint not null,
  actor text not null,
  brand_id text not null default 'terralla',
  created_at timestamptz not null default now(),
  constraint internal_preview_events_sha_shape check (sha256 ~ '^[a-f0-9]{64}$'),
  constraint internal_preview_events_revision_step check (base_revision >= 0 and revision = base_revision + 1),
  constraint internal_preview_events_product check (product_id = '426bf18c-8649-4aa5-939c-f0b33eca95f8'::uuid),
  constraint internal_preview_events_brand check (brand_id = 'terralla'),
  constraint internal_preview_events_actor check (actor in ('kevin_admin', 'terralla_admin')),
  constraint internal_preview_events_sha_allow check (sha256 in (
    'ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342',
    'af3760c6b82472fcc1999dec44079feb5089613ccc6e247b4a9c94acfc7746c4',
    '2f89191684cdab6756eafe1e4c116d801a36451cd6bc1f3be3c647f19929f44d',
    '91cd1d7d67d7bacfba741d14c26dc340789a0836412518af4241fe0bb4a3fa0c'
  )),
  constraint internal_preview_events_revision_unique unique (product_id, sha256, revision)
);

alter table internal_preview.events enable row level security;
revoke all on internal_preview.events from public, anon, authenticated, kevin_admin, terralla_admin, terralla_team;

create or replace function internal_preview.jwt_role()
returns text
language sql
stable
set search_path = pg_temp
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    case
      when coalesce(current_setting('request.jwt.claims', true), '') = '' then null
      else current_setting('request.jwt.claims', true)::jsonb ->> 'role'
    end
  );
$$;

revoke all on function internal_preview.jwt_role() from public, anon, authenticated, kevin_admin, terralla_admin, terralla_team;

create or replace function internal_preview.build_state(p_product_id uuid, p_saved boolean, p_idempotent boolean)
returns jsonb
language sql
stable
security definer
set search_path = pg_temp
as $$
  with latest as (
    select distinct on (sha256) sha256, selected, revision
    from internal_preview.events
    where product_id = p_product_id and brand_id = 'terralla'
    order by sha256, revision desc
  )
  select jsonb_build_object(
    'ok', true,
    'saved', p_saved,
    'durable', true,
    'store', 'supabase',
    'productId', p_product_id,
    'selected', coalesce((select jsonb_agg(sha256 order by sha256) from latest where selected), '[]'::jsonb),
    'revisions', coalesce((select jsonb_object_agg(sha256, revision) from latest), '{}'::jsonb),
    'idempotent', p_idempotent
  );
$$;

create or replace function internal_preview.apply_event(
  p_event_id text,
  p_product_id uuid,
  p_sha256 text,
  p_selected boolean,
  p_base_revision bigint
) returns jsonb
language plpgsql
security definer
set search_path = pg_temp
as $$
declare
  jwt text := internal_preview.jwt_role();
  existing internal_preview.events%rowtype;
  current_revision bigint;
begin
  if jwt is null or jwt = 'anon' then
    raise exception 'anonymous' using errcode = '42501';
  end if;
  if jwt not in ('kevin_admin', 'terralla_admin') then
    raise exception 'manager' using errcode = '42501';
  end if;
  if p_product_id is distinct from '426bf18c-8649-4aa5-939c-f0b33eca95f8'::uuid then
    raise exception 'product' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_sha256 not in (
    'ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342',
    'af3760c6b82472fcc1999dec44079feb5089613ccc6e247b4a9c94acfc7746c4',
    '2f89191684cdab6756eafe1e4c116d801a36451cd6bc1f3be3c647f19929f44d',
    '91cd1d7d67d7bacfba741d14c26dc340789a0836412518af4241fe0bb4a3fa0c'
  ) then
    raise exception 'sha256' using errcode = '22023';
  end if;
  if p_selected is null then
    raise exception 'selected' using errcode = '22023';
  end if;
  if p_event_id is null or p_event_id !~ '^[A-Za-z0-9_-]{16,80}$' then
    raise exception 'event_id' using errcode = '22023';
  end if;
  if p_base_revision is null or p_base_revision < 0 then
    raise exception 'base_revision' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_product_id::text || ':' || p_sha256, 0));

  select * into existing from internal_preview.events where event_id = p_event_id;
  if found then
    if existing.product_id = p_product_id
      and existing.sha256 = p_sha256
      and existing.selected = p_selected
      and existing.base_revision = p_base_revision
      and existing.actor = jwt
      and existing.brand_id = 'terralla' then
      return internal_preview.build_state(p_product_id, true, true);
    end if;
    raise sqlstate 'PT409' using message = 'idempotency_conflict';
  end if;

  select coalesce(max(revision), 0) into current_revision
  from internal_preview.events
  where product_id = p_product_id and sha256 = p_sha256;

  if current_revision <> p_base_revision then
    raise sqlstate 'PT409' using message = 'revision_conflict';
  end if;

  insert into internal_preview.events (
    event_id, product_id, sha256, selected, base_revision, revision, actor, brand_id
  ) values (
    p_event_id, p_product_id, p_sha256, p_selected, p_base_revision, p_base_revision + 1, jwt, 'terralla'
  );

  return internal_preview.build_state(p_product_id, true, false);
end;
$$;

create or replace function internal_preview.read_state(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
as $$
declare
  jwt text := internal_preview.jwt_role();
begin
  if jwt is null or jwt = 'anon' then
    raise exception 'anonymous' using errcode = '42501';
  end if;
  if jwt not in ('kevin_admin', 'terralla_admin', 'terralla_team') then
    raise exception 'manager' using errcode = '42501';
  end if;
  if p_product_id is distinct from '426bf18c-8649-4aa5-939c-f0b33eca95f8'::uuid then
    raise exception 'product' using errcode = '22023';
  end if;
  return internal_preview.build_state(p_product_id, false, false);
end;
$$;

revoke all on function internal_preview.build_state(uuid, boolean, boolean) from public, anon, authenticated, kevin_admin, terralla_admin, terralla_team;
revoke all on function internal_preview.apply_event(text, uuid, text, boolean, bigint) from public, anon, authenticated, terralla_team;
revoke all on function internal_preview.read_state(uuid) from public, anon, authenticated;
grant execute on function internal_preview.apply_event(text, uuid, text, boolean, bigint) to kevin_admin, terralla_admin;
grant execute on function internal_preview.read_state(uuid) to kevin_admin, terralla_admin, terralla_team;

create or replace function public.internal_preview_apply_event(
  event_id text,
  product_id uuid,
  sha256 text,
  selected boolean,
  base_revision bigint
) returns jsonb
language sql
security invoker
set search_path = pg_temp
as $$
  select internal_preview.apply_event(event_id, product_id, sha256, selected, base_revision);
$$;

create or replace function public.internal_preview_read(product_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_temp
as $$
  select internal_preview.read_state(product_id);
$$;

revoke all on function public.internal_preview_apply_event(text, uuid, text, boolean, bigint) from public, anon, authenticated, terralla_team;
revoke all on function public.internal_preview_read(uuid) from public, anon, authenticated;
grant execute on function public.internal_preview_apply_event(text, uuid, text, boolean, bigint) to kevin_admin, terralla_admin;
grant execute on function public.internal_preview_read(uuid) to kevin_admin, terralla_admin, terralla_team;

do $$
declare
  role_name text;
begin
  foreach role_name in array array['service_role', 'admin', 'sourcing_manager']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on function public.internal_preview_apply_event(text, uuid, text, boolean, bigint) from %I', role_name);
      execute format('revoke all on function public.internal_preview_read(uuid) from %I', role_name);
      execute format('revoke all on function internal_preview.apply_event(text, uuid, text, boolean, bigint) from %I', role_name);
      execute format('revoke all on function internal_preview.read_state(uuid) from %I', role_name);
      execute format('revoke all on schema internal_preview from %I', role_name);
    end if;
  end loop;
end;
$$;
