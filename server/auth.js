import crypto from 'crypto';

const SECRET = process.env.AUTH_SECRET || 'dev-secret-change-me';
const DEFAULT_TTL = 60 * 60 * 24 * 7; // 7 days

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function createToken(payload = {}, ttl = DEFAULT_TTL) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const body = { ...payload, exp };
  const json = JSON.stringify(body);
  const encoded = base64url(json);
  const sig = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encoded}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expect = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (!crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) return null;
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf8');
    const obj = JSON.parse(json);
    if (obj.exp && Math.floor(Date.now() / 1000) > obj.exp) return null;
    return obj;
  } catch (e) {
    return null;
  }
}
