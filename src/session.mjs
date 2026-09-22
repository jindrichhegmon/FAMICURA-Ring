/**
 * Ověření přihlášení z Netlify frontendu.
 *
 * Stránka běží na Netlify, /api/clb se přesměrovává sem. Cookie `fam_sess`
 * podepsaná RING_HMAC_KEY putuje s požadavkem, takže server ověří totéž co
 * Netlify funkce – stejný klíč musí být v .env na VPS.
 */
import crypto from 'node:crypto';

const COOKIE = 'fam_sess';

function podpis(expiresAt) {
  const key = process.env.RING_HMAC_KEY;
  if (!key) throw new Error('Chybí RING_HMAC_KEY.');
  return crypto.createHmac('sha256', key).update(`famicura-session:${expiresAt}`, 'utf8').digest('base64url');
}

function shodne(a, b) {
  const aa = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function prihlasen(headers) {
  const cookie = headers.get ? (headers.get('cookie') || '') : (headers.cookie || '');
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;

  const [expiresAt, signature] = decodeURIComponent(m[1]).split('.');
  if (!expiresAt || !signature) return false;
  if (!Number.isFinite(Number(expiresAt)) || Date.now() > Number(expiresAt)) return false;

  try { return shodne(podpis(expiresAt), signature); } catch { return false; }
}
