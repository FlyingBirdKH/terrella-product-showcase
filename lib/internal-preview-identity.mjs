import { isUuid } from './internal-preview-allowlist.mjs';

export const ADMIN_CLAIM = 'terrella_brand_admin';
export const READER_CLAIM = 'terrella_brand_reader';
export const BRAND = 'terralla';

function decodePayload(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload;
  } catch {
    return null;
  }
}

function claimMatches(metadata, name) {
  return Boolean(metadata) && typeof metadata === 'object' && !Array.isArray(metadata) && metadata[name] === BRAND;
}

// The user record comes from Auth. Only its app_metadata claim is read.
// The token's own metadata is ignored; sub must equal the Auth user id.
export function identityFromAuth(user, token) {
  const payload = decodePayload(token);
  const id = user && typeof user.id === 'string' ? user.id.trim().toLowerCase() : '';
  const sub = typeof payload?.sub === 'string' ? payload.sub.trim().toLowerCase() : '';
  if (!payload || !isUuid(id) || !isUuid(sub)) return null;
  if (sub !== id || payload.role !== 'authenticated') return null;
  const metadata = user.app_metadata;
  if (claimMatches(metadata, ADMIN_CLAIM)) return { id, level: 'admin' };
  if (claimMatches(metadata, READER_CLAIM)) return { id, level: 'reader' };
  return { id, level: '' };
}
