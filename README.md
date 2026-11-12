# Terrella Product Showcase

Independent public showcase for `terrella-product-db` (Supabase ref `wwsfmfxwhktglgmeukgr`).

- Not production storefront (`terralla-storefront` merge needs a separate Kevin GO).
- CAT-001 internal preview is a separate login, not the public catalog. The catalog page does not require a session. Preview login uses an existing Supabase Auth password grant and HttpOnly cookies. Writes require `app_metadata.terrella_brand_admin=terralla`. Reads also allow `app_metadata.terrella_brand_reader=terralla`. `user_metadata` is ignored. The access cookie follows Auth `expires_in`; the refresh cookie is an absolute 12 hour session and is not copied from 3600. Local gateway tests are not a real Supabase project. See `docs/reversible-image-publish.md`. Publish stays disabled.
- Full Jenny sheet batch: 96 catalog rows; thumbs compressed ~200KB on GitHub Pages.
- Bunny CDN upload blocked until Terrella storage zone name + API password are provided (only `NOVA_BUNNY_STORAGE_PASSWORD` is present).
- Vercel independent project: CLI logged out / prior new-project 403 — Pages is the public HTTPS surface for now.
