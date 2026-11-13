import { handleSession as sessionHandler } from '../../lib/internal-preview-session.mjs';
import { send as sendJson } from '../../lib/internal-preview-http.mjs';

export default function handler(req, res) {
  return sessionHandler(req, res, { env: process.env, send: sendJson });
}
