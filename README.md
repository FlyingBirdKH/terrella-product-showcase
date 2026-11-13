# Terrella Product Showcase

Independent public showcase for `terrella-product-db` (Supabase ref `wwsfmfxwhktglgmeukgr`).

- Not production storefront (`terralla-storefront` merge needs a separate Kevin GO).
- CAT-001 internal preview is stored in this same project, `terrella-product-db` (`wwsfmfxwhktglgmeukgr`), not crm-core. The product row is `0f057213-b8af-4982-9e44-582a2a1d3469` (SKU CAT-001, code TR260002, status `candidate`). The preview migration does not change `products`, `product_assets`, `product_image_selections`, or that status. The catalog page does not require a session. Preview login uses an existing Supabase Auth password grant and HttpOnly cookies. The server needs only `SUPABASE_URL` and `SUPABASE_ANON_KEY` for this project. Do not set a service-role key. Writes require `app_metadata.terrella_brand_admin=terralla`. Reads also allow `app_metadata.terrella_brand_reader=terralla`. `user_metadata` is ignored. Local gateway tests are not the real Supabase project. See `docs/reversible-image-publish.md`. Publish stays disabled.
- Full Jenny sheet batch: 96 catalog rows; thumbs compressed ~200KB on GitHub Pages.
- Bunny CDN upload blocked until Terrella storage zone name + API password are provided (only `NOVA_BUNNY_STORAGE_PASSWORD` is present).
- Vercel independent project: CLI logged out / prior new-project 403 — Pages is the public HTTPS surface for now.
