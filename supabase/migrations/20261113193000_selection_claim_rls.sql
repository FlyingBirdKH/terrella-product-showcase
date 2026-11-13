-- terrella-product-db (ref wwsfmfxwhktglgmeukgr).
-- Keep this file in the repo. Do not apply it from the app, and do not apply it
-- to the live database until Kevin runs it. It does not insert or update product
-- rows, does not change status, does not write asset rows, and does not
-- create Auth users or claims.
-- CAT-003 and CAT-006 stay out: their recovered hashes are known, their product
-- UUIDs are not pinned here.
-- Writes require app_metadata.terrella_brand_admin = terralla.
-- Reads also allow app_metadata.terrella_brand_reader = terralla.
-- auth.uid() must equal the JWT sub. No other metadata is consulted.
-- The preview server sends the authenticated user token. This file does not
-- grant the table to anon.

alter table public.product_image_selections enable row level security;

revoke all on table public.product_image_selections from public, anon;
grant select, insert, delete on table public.product_image_selections to authenticated;

drop policy if exists product_image_selections_select on public.product_image_selections;
drop policy if exists product_image_selections_insert on public.product_image_selections;
drop policy if exists product_image_selections_delete on public.product_image_selections;

create policy product_image_selections_select
on public.product_image_selections
for select
to authenticated
using (
  auth.uid() is not null
  and auth.uid()::text = coalesce(auth.jwt() ->> 'sub', '')
  and coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
  and (
    coalesce(auth.jwt() -> 'app_metadata' ->> 'terrella_brand_admin', '') = 'terralla'
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'terrella_brand_reader', '') = 'terralla'
  )
  and product_id = '0f057213-b8af-4982-9e44-582a2a1d3469'::uuid
  and image_sha256 in (
    'ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342',
    'af3760c6b82472fcc1999dec44079feb5089613ccc6e247b4a9c94acfc7746c4',
    '2f89191684cdab6756eafe1e4c116d801a36451cd6bc1f3be3c647f19929f44d',
    '91cd1d7d67d7bacfba741d14c26dc340789a0836412518af4241fe0bb4a3fa0c'
  )
);

create policy product_image_selections_insert
on public.product_image_selections
for insert
to authenticated
with check (
  auth.uid() is not null
  and auth.uid()::text = coalesce(auth.jwt() ->> 'sub', '')
  and coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
  and coalesce(auth.jwt() -> 'app_metadata' ->> 'terrella_brand_admin', '') = 'terralla'
  and product_id = '0f057213-b8af-4982-9e44-582a2a1d3469'::uuid
  and image_sha256 in (
    'ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342',
    'af3760c6b82472fcc1999dec44079feb5089613ccc6e247b4a9c94acfc7746c4',
    '2f89191684cdab6756eafe1e4c116d801a36451cd6bc1f3be3c647f19929f44d',
    '91cd1d7d67d7bacfba741d14c26dc340789a0836412518af4241fe0bb4a3fa0c'
  )
);

create policy product_image_selections_delete
on public.product_image_selections
for delete
to authenticated
using (
  auth.uid() is not null
  and auth.uid()::text = coalesce(auth.jwt() ->> 'sub', '')
  and coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
  and coalesce(auth.jwt() -> 'app_metadata' ->> 'terrella_brand_admin', '') = 'terralla'
  and product_id = '0f057213-b8af-4982-9e44-582a2a1d3469'::uuid
  and image_sha256 in (
    'ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342',
    'af3760c6b82472fcc1999dec44079feb5089613ccc6e247b4a9c94acfc7746c4',
    '2f89191684cdab6756eafe1e4c116d801a36451cd6bc1f3be3c647f19929f44d',
    '91cd1d7d67d7bacfba741d14c26dc340789a0836412518af4241fe0bb4a3fa0c'
  )
);
