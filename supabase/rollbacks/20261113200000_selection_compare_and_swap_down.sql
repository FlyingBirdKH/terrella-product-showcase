-- Rollback for 20261113200000_selection_compare_and_swap.sql.
-- Drops only the compare function. It does not change product rows.

drop function if exists public.apply_image_selection(uuid, text, boolean, boolean);
