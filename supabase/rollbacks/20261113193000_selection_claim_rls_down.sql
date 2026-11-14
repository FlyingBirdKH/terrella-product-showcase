-- Rollback for 20261113193000_selection_claim_rls.sql.
-- Drops only the policies and grants added by that file. Row level security
-- stays enabled, so the table fails closed. This does not change product rows.

drop policy if exists product_image_selections_select on public.product_image_selections;
drop policy if exists product_image_selections_insert on public.product_image_selections;
drop policy if exists product_image_selections_delete on public.product_image_selections;

revoke all on table public.product_image_selections from authenticated;
