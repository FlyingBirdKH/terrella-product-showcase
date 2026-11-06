-- Rollback for schema/001_prompt_trace.sql only.
-- Drops the two tables created by that migration.
-- Does not touch products or product_assets.
-- If those new tables later receive rows, this deletes those rows.
-- Database development responsibility: Cursor.
-- Do not run against production until a reviewed backup exists.

begin;

drop table if exists asset_records;
drop table if exists prompt_documents;

commit;
