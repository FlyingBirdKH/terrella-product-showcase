# Terrella Product Showcase

Independent public showcase for `terrella-product-db` (Supabase ref `wwsfmfxwhktglgmeukgr`).

- Not production storefront (`terralla-storefront` merge needs a separate Kevin GO).
- Page checkboxes are a temporary copy list for this visit. They do not publish or withdraw an image. Durable badges are read only from `image-availability.json`; empty records are not approval or sync. See `docs/reversible-image-publish.md`. The publish/unpublish control stays disabled until Kevin names the target and an authorized manager channel.
- Full Jenny sheet batch: 96 catalog rows; thumbs compressed ~200KB on GitHub Pages.
- Bunny CDN upload blocked until Terrella storage zone name + API password are provided (only `NOVA_BUNNY_STORAGE_PASSWORD` is present).
- Vercel independent project: CLI logged out / prior new-project 403 — Pages is the public HTTPS surface for now.
