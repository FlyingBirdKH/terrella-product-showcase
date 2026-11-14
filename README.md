# Terrella Product Showcase

Independent public showcase for `terrella-product-db` (Supabase ref `wwsfmfxwhktglgmeukgr`).

- Not production storefront (`terralla-storefront` merge needs a separate Kevin GO).
- The only selection source of truth is `public.product_image_selections` in terrella-product-db (ref `wwsfmfxwhktglgmeukgr`). The write and read allowlist is CAT-001 / TR260002, product id `0f057213-b8af-4982-9e44-582a2a1d3469`, and its four reviewed SHA-256 values. Other products are rejected. Do not use the formal-store id, crm-core, or an `internal_preview` schema. The catalog page loads without a session. A named Supabase Auth user signs in through the server; the HttpOnly cookie holds that user's access token. Writes require `app_metadata.terrella_brand_admin=terralla`. Reads also allow `app_metadata.terrella_brand_reader=terralla`. Database calls use server-only `TERRELLA_PRODUCT_DB_URL` and `TERRELLA_PRODUCT_DB_ANON_KEY` with the user token. The migration in `supabase/migrations/` is not applied by this repo. See `docs/reversible-image-publish.md`. Publish stays disabled. This repo change does not merge or deploy.
- Full Jenny sheet batch: 96 catalog rows; thumbs compressed ~200KB on GitHub Pages.
- Bunny CDN upload blocked until Terrella storage zone name + API password are provided (only `NOVA_BUNNY_STORAGE_PASSWORD` is present).
- Vercel independent project: CLI logged out / prior new-project 403 — Pages is the public HTTPS surface for now.
