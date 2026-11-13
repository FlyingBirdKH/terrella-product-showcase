# Terrella Product Showcase

Independent public showcase for `terrella-product-db` (Supabase ref `wwsfmfxwhktglgmeukgr`).

- Not production storefront (`terralla-storefront` merge needs a separate Kevin GO).
- The only selection source of truth is `public.product_image_selections` in terrella-product-db (ref `wwsfmfxwhktglgmeukgr`). CAT-001 / TR260002 is `0f057213-b8af-4982-9e44-582a2a1d3469`. Do not use the formal-store id, crm-core, or an `internal_preview` schema. The catalog page loads without a session. Selection reads and writes fail closed unless the server has `TERRELLA_PREVIEW_ACCESS_SECRET` and the browser has exchanged it for an HttpOnly cookie. Database calls use server-only `TERRELLA_PRODUCT_DB_URL` and `TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY` after that gate. Those two database names belong on the preview environment only. Deployment Protection is not currently enabled (`ssoProtection` is null); do not treat a preview URL as protected. See `docs/reversible-image-publish.md`. Publish stays disabled. This repo change does not merge or deploy.
- Full Jenny sheet batch: 96 catalog rows; thumbs compressed ~200KB on GitHub Pages.
- Bunny CDN upload blocked until Terrella storage zone name + API password are provided (only `NOVA_BUNNY_STORAGE_PASSWORD` is present).
- Vercel independent project: CLI logged out / prior new-project 403 — Pages is the public HTTPS surface for now.
