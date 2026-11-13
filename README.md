# Terrella Product Showcase

Independent public showcase for `terrella-product-db` (Supabase ref `wwsfmfxwhktglgmeukgr`).

- Not production storefront (`terralla-storefront` merge needs a separate Kevin GO).
- Showcase checkbox rows are stored in terrella-product-db `public.product_image_selections`. The public catalog stays unauthenticated. Writes go through `/api/internal-preview` with server-only `TERRELLA_PRODUCT_DB_URL` and `TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY`. That URL is terrella-product-db (ref `wwsfmfxwhktglgmeukgr`), not crm-core. Do not set crm-core keys for this path, and do not put the service-role key in the browser. CAT-001 / TR260002 is `0f057213-b8af-4982-9e44-582a2a1d3469`. The formal-store id `426bf18c-8649-4aa5-939c-f0b33eca95f8` is not the table key. `internal-preview.json` and crm-core `internal_preview` are not the source of truth. See `docs/reversible-image-publish.md`. Publish stays disabled. This app change does not merge or deploy.
- Full Jenny sheet batch: 96 catalog rows; thumbs compressed ~200KB on GitHub Pages.
- Bunny CDN upload blocked until Terrella storage zone name + API password are provided (only `NOVA_BUNNY_STORAGE_PASSWORD` is present).
- Vercel independent project: CLI logged out / prior new-project 403 — Pages is the public HTTPS surface for now.
