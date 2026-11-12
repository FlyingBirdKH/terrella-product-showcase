-- Rolls back only the internal preview ledger.
-- Does not update product status, does not delete Bunny objects,
-- and does not touch terralla_skus, public.products, or auth.users.

drop function if exists public.internal_preview_apply_event(text, uuid, text, boolean, bigint);
drop function if exists public.internal_preview_read(uuid);
drop function if exists internal_preview.apply_event(text, uuid, text, boolean, bigint);
drop function if exists internal_preview.read_state(uuid);
drop function if exists internal_preview.build_state(uuid, boolean, boolean);
drop function if exists internal_preview.jwt_role();
drop table if exists internal_preview.events;
drop table if exists internal_preview.managers;
drop schema if exists internal_preview;
