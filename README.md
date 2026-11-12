# Terrella Product Showcase

Independent public showcase for `terrella-product-db` (Supabase ref `wwsfmfxwhktglgmeukgr`).

- Not production storefront (`terralla-storefront` merge needs a separate Kevin GO).
- CAT-001 internal preview selections are stored only in the crm-core Supabase schema `internal_preview`, keyed by product id `426bf18c-8649-4aa5-939c-f0b33eca95f8`, brand `terralla`, and the full SHA-256. `internal-preview.json` is not the store and the API does not write it. The server needs `SUPABASE_URL` and `SUPABASE_ANON_KEY` for crm-core; without them the preview fails closed. The anon key stays on the server. This code does not read a service-role key, `auth.users`, or supplier `current_app_role()`. Writes require an existing JWT role `kevin_admin` or `terralla_admin`. `terralla_team` can read only. Unchecking removes only that preview association. Other checkboxes stay a temporary copy list for this visit. They do not publish or withdraw an image. Durable approval and sync badges are read only from `image-availability.json`; empty records are not approval or sync. See `docs/reversible-image-publish.md`. The publish/unpublish control stays disabled. Formal store sync is not implemented.
- Full Jenny sheet batch: 96 catalog rows; thumbs compressed ~200KB on GitHub Pages.
- Bunny CDN upload blocked until Terrella storage zone name + API password are provided (only `NOVA_BUNNY_STORAGE_PASSWORD` is present).
- Vercel independent project: CLI logged out / prior new-project 403 — Pages is the public HTTPS surface for now.
