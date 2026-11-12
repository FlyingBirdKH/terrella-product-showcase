# Terrella Product Showcase

Independent public showcase for `terrella-product-db` (Supabase ref `wwsfmfxwhktglgmeukgr`).

- Not production storefront (`terralla-storefront` merge needs a separate Kevin GO).
- CAT-001 internal preview selections are stored only in the crm-core Supabase schema `internal_preview`, keyed by product id `426bf18c-8649-4aa5-939c-f0b33eca95f8`, brand `terralla`, and the full SHA-256. `internal-preview.json` is not the store. The server needs `SUPABASE_URL` and `SUPABASE_ANON_KEY`. A normal Supabase Auth password login sets an HttpOnly cookie. Writes also require the existing user's server-side `app_metadata.terrella_brand_admin` to be `terralla`; this repo does not create accounts or edit that claim. `user_metadata` is ignored. The anon key and service role stay off the browser. The public catalog does not require login. See `docs/reversible-image-publish.md`. The publish/unpublish control stays disabled. Formal store sync is not implemented.
- Full Jenny sheet batch: 96 catalog rows; thumbs compressed ~200KB on GitHub Pages.
- Bunny CDN upload blocked until Terrella storage zone name + API password are provided (only `NOVA_BUNNY_STORAGE_PASSWORD` is present).
- Vercel independent project: CLI logged out / prior new-project 403 — Pages is the public HTTPS surface for now.
