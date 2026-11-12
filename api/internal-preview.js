import { createSupabasePreviewClient } from '../lib/internal-preview-supabase.mjs';
import { handlePreview } from '../lib/internal-preview-http.mjs';

export default function handler(req, res) {
  return handlePreview(req, res, {
    env: process.env,
    fetchImpl: globalThis.fetch,
    clientFactory: createSupabasePreviewClient
  });
}
