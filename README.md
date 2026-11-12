# Terrella Product Showcase

Independent public showcase for `terrella-product-db` (Supabase ref `wwsfmfxwhktglgmeukgr`).

- Not production storefront (`terralla-storefront` merge needs a separate Kevin GO).
- CAT-001 internal preview selections persist by product id `426bf18c-8649-4aa5-939c-f0b33eca95f8` and the full SHA-256 in `internal-preview.json`. Run `node scripts/serve-with-internal-preview.mjs`, then open `http://127.0.0.1:8788/cat-001-internal-preview.html`. That page is non-public and is not a formal store page. Unchecking removes only the preview association. Other checkboxes stay a temporary copy list for this visit. They do not publish or withdraw an image. Durable approval and sync badges are read only from `image-availability.json`; empty records are not approval or sync. See `docs/reversible-image-publish.md`. The publish/unpublish control stays disabled. Formal store sync is not implemented.
- Full Jenny sheet batch: 96 catalog rows; thumbs compressed ~200KB on GitHub Pages.
- Bunny CDN upload blocked until Terrella storage zone name + API password are provided (only `NOVA_BUNNY_STORAGE_PASSWORD` is present).
- Vercel independent project: CLI logged out / prior new-project 403 — Pages is the public HTTPS surface for now.
