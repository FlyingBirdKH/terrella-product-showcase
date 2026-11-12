-- Rolls back only the objects created by 20261112160000_internal_preview_shared.sql.
-- It does not drop roles, auth users, terralla_skus, public.products, or Bunny objects.

drop function if exists public.internal_preview_apply_event(text, uuid, text, boolean, bigint);
drop function if exists public.internal_preview_read(uuid);
drop function if exists internal_preview.apply_event(text, uuid, text, boolean, bigint);
drop function if exists internal_preview.read_state(uuid);
drop function if exists internal_preview.build_state(uuid, boolean, boolean);
drop function if exists internal_preview.actor_context();
drop function if exists internal_preview.require_actor();
drop table if exists internal_preview.events;
drop schema if exists internal_preview;
