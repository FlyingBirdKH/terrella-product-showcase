-- Terrella product library additive schema.
-- Database development responsibility: Cursor.
-- This file is NOT applied to production by the showcase change.
-- Reported existing project (not rechecked here; Supabase connector needs auth):
--   terrella-product-db / wwsfmfxwhktglgmeukgr
--   tables products, product_assets
-- Do not DROP, TRUNCATE, or UPDATE those tables from this script.

begin;

create table if not exists prompt_documents (
  id text primary key,
  product_id text not null,
  view_key text,
  version_label text not null,
  body text,
  body_status text not null check (body_status in ('recorded', 'pending', 'unknown', 'fixture')),
  storage_location text not null,
  source_canvas_id text,
  source_heading text,
  lens_resolution text,
  gen_task_id text,
  source_original_asset_id text,
  applies_to_asset_id text,
  model_name text,
  model_name_status text not null default 'unknown',
  model_version text,
  model_version_status text not null default 'unknown',
  api_parameters jsonb,
  api_parameters_status text not null default 'unknown',
  generated_at timestamptz,
  generated_at_status text not null default 'unknown',
  seed text,
  seed_status text not null default 'unknown',
  real_generation boolean not null default true
);

create table if not exists asset_records (
  id text primary key,
  product_id text,
  role text not null check (role in ('original', 'thumb', 'ai', 'prompt_only_view', 'ancillary', 'rejected_draft')),
  view_key text,
  version_label text not null,
  local_uri text,
  source_uri text,
  source_file_id text,
  source_check_status text not null,
  image_presence text not null,
  bunny_status text not null default 'not_uploaded',
  bunny_executed boolean not null default false,
  upload_block_reason text,
  prompt_id text references prompt_documents(id),
  source_original_asset_id text,
  gen_task_id text,
  superseded_by text,
  notes text
);

comment on table prompt_documents is 'Prompt text and version, one row per AI asset or prompted view. Missing model/seed/time stay unknown.';
comment on table asset_records is 'Additive asset registry. Does not replace product_assets and does not delete history.';

commit;
