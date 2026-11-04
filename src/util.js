export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
export const bad = (msg) => new HttpError(400, msg);
export const id8 = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);

export async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function same(a, b) { // constant-time compare via fixed-length digests
  const [x, y] = await Promise.all([sha256hex(a), sha256hex(b)]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i); return d === 0;
}
export const newToken = () => 'mf_' + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const parseJson = (s, fallback = {}) => { try { return JSON.parse(s); } catch { return fallback; } };
