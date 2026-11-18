-- terrella-product-db (ref wwsfmfxwhktglgmeukgr).
-- Keep this file in the repo. Do not apply it from the app, and do not apply it
-- to the live database as part of this change. It does not insert or update
-- product rows, does not change status, does not write asset rows, and does not
-- create Auth users or claims.
-- The compare is the current presence of one allowlisted CAT-001 image.
-- A concurrent change makes the statement affect zero rows and report applied false.

create or replace function public.apply_image_selection(
  product_id uuid,
  image_sha256 text,
  expected_selected boolean,
  selected boolean
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  changed integer := 0;
begin
  if product_id is distinct from '0f057213-b8af-4982-9e44-582a2a1d3469'::uuid then
    raise exception 'product' using errcode = '22023';
  end if;
  if image_sha256 is null or image_sha256 not in (
    'ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342',
    'af3760c6b82472fcc1999dec44079feb5089613ccc6e247b4a9c94acfc7746c4',
    '2f89191684cdab6756eafe1e4c116d801a36451cd6bc1f3be3c647f19929f44d',
    '91cd1d7d67d7bacfba741d14c26dc340789a0836412518af4241fe0bb4a3fa0c'
  ) then
    raise exception 'sha256' using errcode = '22023';
  end if;
  if expected_selected is null or selected is null then
    raise exception 'expected' using errcode = '22023';
  end if;

  if expected_selected is false and selected is true then
    begin
      insert into public.product_image_selections (product_id, image_sha256)
      select apply_image_selection.product_id, apply_image_selection.image_sha256
      where not exists (
        select 1
        from public.product_image_selections
        where public.product_image_selections.product_id = apply_image_selection.product_id
          and public.product_image_selections.image_sha256 = apply_image_selection.image_sha256
      );
      get diagnostics changed = row_count;
    exception
      when unique_violation then
        return jsonb_build_object('applied', false);
    end;
    if changed is distinct from 1 then
      return jsonb_build_object('applied', false);
    end if;
    return jsonb_build_object('applied', true);
  end if;

  if expected_selected is true and selected is false then
    delete from public.product_image_selections
    where public.product_image_selections.product_id = apply_image_selection.product_id
      and public.product_image_selections.image_sha256 = apply_image_selection.image_sha256;
    get diagnostics changed = row_count;
    if changed is distinct from 1 then
      return jsonb_build_object('applied', false);
    end if;
    return jsonb_build_object('applied', true);
  end if;

  if exists (
    select 1
    from public.product_image_selections
    where public.product_image_selections.product_id = apply_image_selection.product_id
      and public.product_image_selections.image_sha256 = apply_image_selection.image_sha256
  ) is distinct from expected_selected then
    return jsonb_build_object('applied', false);
  end if;
  return jsonb_build_object('applied', true);
end;
$$;

revoke all on function public.apply_image_selection(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.apply_image_selection(uuid, text, boolean, boolean) to authenticated;
