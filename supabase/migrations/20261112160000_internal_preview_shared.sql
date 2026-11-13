-- terrella-product-db (ref wwsfmfxwhktglgmeukgr) internal preview ledger.
-- Apply this file manually. Do not apply the f640c146 text: that revision targeted
-- crm-core and the product id 426bf18c-8649-4aa5-939c-f0b33eca95f8, which is not in
-- public.products. CAT-001 / code TR260002 is 0f057213-b8af-4982-9e44-582a2a1d3469,
-- status candidate. This file does not change that row.
-- Do not alter public.products, public.product_assets, public.product_image_selections, or status.
-- The target project has the standard roles anon, authenticated, authenticator, and service_role.
-- Do not create login roles. PostgREST uses the JWT role claim for SET ROLE, and Supabase
-- Auth puts role=authenticated on a user token. kevin_admin, terralla_admin, and terralla_team
-- are not database roles and are not granted here.
-- Authorization is auth.uid() plus the server-trusted JWT claim
-- app_metadata.terrella_brand_admin = 'terralla'. user_metadata is ignored.
-- This file does not update auth users, does not read auth.users, and does not change
-- anonymous product visibility or terralla_skus.
-- Direct table access stays denied. Only the security definer functions write, after the claim check.
-- Do not grant these functions to service_role, and do not put that key in a browser.

create schema if not exists internal_preview;

revoke all on schema internal_preview from public, anon, service_role;
grant usage on schema internal_preview to authenticated;

create table if not exists internal_preview.events (
  event_id text primary key,
  product_id uuid not null,
  sha256 text not null,
  selected boolean not null,
  base_revision bigint not null,
  revision bigint not null,
  actor uuid not null,
  brand_id text not null default 'terralla',
  created_at timestamptz not null default now(),
  constraint internal_preview_events_sha_shape check (sha256 ~ '^[a-f0-9]{64}$'),
  constraint internal_preview_events_revision_step check (base_revision >= 0 and revision = base_revision + 1),
  constraint internal_preview_events_product check (product_id = '0f057213-b8af-4982-9e44-582a2a1d3469'::uuid),
  constraint internal_preview_events_brand check (brand_id = 'terralla'),
  constraint internal_preview_events_sha_allow check (sha256 in (
    'ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342',
    'af3760c6b82472fcc1999dec44079feb5089613ccc6e247b4a9c94acfc7746c4',
    '2f89191684cdab6756eafe1e4c116d801a36451cd6bc1f3be3c647f19929f44d',
    '91cd1d7d67d7bacfba741d14c26dc340789a0836412518af4241fe0bb4a3fa0c'
  )),
  constraint internal_preview_events_revision_unique unique (product_id, sha256, revision)
);

alter table internal_preview.events enable row level security;
revoke all on internal_preview.events from public, anon, authenticated, service_role;

create or replace function internal_preview.actor_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
as $$
declare
  claims jsonb := auth.jwt();
  uid uuid := auth.uid();
  jwt_sub text := claims ->> 'sub';
  jwt_role text := claims ->> 'role';
  admin_claim text := claims -> 'app_metadata' ->> 'terrella_brand_admin';
  reader_claim text := claims -> 'app_metadata' ->> 'terrella_brand_reader';
  level text;
begin
  if uid is null or jwt_sub is null or jwt_sub = '' or jwt_sub is distinct from uid::text then
    raise exception 'sub' using errcode = '42501';
  end if;
  if jwt_role is distinct from 'authenticated' then
    raise exception 'role' using errcode = '42501';
  end if;
  if admin_claim = 'terralla' then
    level := 'admin';
  elsif reader_claim = 'terralla' then
    level := 'reader';
  else
    raise exception 'brand-access-missing' using errcode = '42501';
  end if;
  return jsonb_build_object('uid', uid, 'level', level);
end;
$$;

revoke all on function internal_preview.actor_context() from public, anon, authenticated, service_role;

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

revoke all on function internal_preview.build_state(uuid, boolean, boolean) from public, anon, authenticated, service_role;

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
  ctx jsonb := internal_preview.actor_context();
  uid uuid := (ctx ->> 'uid')::uuid;
  existing internal_preview.events%rowtype;
  current_revision bigint;
begin
  if ctx ->> 'level' is distinct from 'admin' then
    raise exception 'brand-admin-missing' using errcode = '42501';
  end if;
  if p_product_id is distinct from '0f057213-b8af-4982-9e44-582a2a1d3469'::uuid then
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
      and existing.actor = uid
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
    p_event_id, p_product_id, p_sha256, p_selected, p_base_revision, p_base_revision + 1, uid, 'terralla'
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
begin
  if (internal_preview.actor_context() ->> 'level') not in ('admin', 'reader') then
    raise exception 'brand-access-missing' using errcode = '42501';
  end if;
  if p_product_id is distinct from '0f057213-b8af-4982-9e44-582a2a1d3469'::uuid then
    raise exception 'product' using errcode = '22023';
  end if;
  return internal_preview.build_state(p_product_id, false, false);
end;
$$;

revoke all on function internal_preview.apply_event(text, uuid, text, boolean, bigint) from public, anon, service_role;
revoke all on function internal_preview.read_state(uuid) from public, anon, service_role;
grant execute on function internal_preview.apply_event(text, uuid, text, boolean, bigint) to authenticated;
grant execute on function internal_preview.read_state(uuid) to authenticated;

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

revoke all on function public.internal_preview_apply_event(text, uuid, text, boolean, bigint) from public, anon, service_role;
revoke all on function public.internal_preview_read(uuid) from public, anon, service_role;
grant execute on function public.internal_preview_apply_event(text, uuid, text, boolean, bigint) to authenticated;
grant execute on function public.internal_preview_read(uuid) to authenticated;
