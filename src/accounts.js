// Email and password accounts. A password is kept only as a salted PBKDF2 hash. A session is a random token in an HttpOnly cookie; only its hash is stored.
// Signing up needs the invite code in env.SIGNUP_CODE (no code set means sign-up is closed), so a public page cannot spend the studio's Meta credits.
import { HttpError, bad, id8, same, sha256hex, newToken } from './util.js';

export const ITERATIONS = 100000; // the most the Workers runtime allows for PBKDF2
const SESSION_MS = 30 * 24 * 3600 * 1000, WINDOW_MS = 10 * 60 * 1000, MAX_PER_EMAIL = 8, MAX_PER_IP = 30;
const b64 = (u) => btoa(String.fromCharCode(...u)), unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const derive = async (pw, salt, iter) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']), 256));
export async function hashPassword(pw, iter = ITERATIONS) { const salt = crypto.getRandomValues(new Uint8Array(16)); return `pbkdf2-sha256$${iter}$${b64(salt)}$${b64(await derive(pw, salt, iter))}`; }
export async function verifyPassword(pw, stored) {
  const [alg, it, salt, hash] = String(stored || '').split('$'); if (alg !== 'pbkdf2-sha256' || !salt || !hash) return false;
  const got = await derive(pw, unb64(salt), Number(it)), want = unb64(hash); let d = got.length ^ want.length; for (let i = 0; i < got.length; i++) d |= got[i] ^ (want[i] || 0); return d === 0;
}
let dummy; // made on first use (the Workers runtime forbids random numbers at start-up); verified against when the email is unknown, so a miss takes as long as a hit
const dummyHash = () => (dummy ||= hashPassword('not a real password'));

export const cleanEmail = (e) => { const s = String(e || '').trim().toLowerCase(); return s.length <= 254 && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s) ? s : null; };
const cookie = (token, https, maxAge = SESSION_MS / 1000) => `mfs=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
export const tokenFrom = (req) => { const c = /(?:^|;\s*)mfs=([A-Za-z0-9_-]+)/.exec(req.headers.get('cookie') || ''); return c && c[1]; };
const who = (u) => ({ id: `u:${u.id}`, name: u.email, email: u.email, kind: 'human', role: 'member', user: true });

async function startSession(db, userId, https) {
  const token = newToken(), now = Date.now();
  await db.batch([db.prepare('DELETE FROM sessions WHERE expires<?').bind(now), db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(await sha256hex(token), userId, now, now + SESSION_MS)]);
  return cookie(token, https);
}
// The person behind a session cookie, or null.
export async function sessionActor(db, token) {
  if (!token) return null;
  const u = await db.prepare('SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?').bind(await sha256hex(token), Date.now()).first();
  return u ? who(u) : null;
}

export async function signup(db, env, { email, password, code }, ip, https) {
  if (!env.SIGNUP_CODE) throw new HttpError(403, 'Sign-up is closed. Ask the person who runs this studio for an invite.');
  const bucket = `signup:${ip}`; await throttle(db, bucket, ip); // wrong codes are counted per address, so one person guessing cannot lock everyone else out
  if (!(await same(String(code || ''), env.SIGNUP_CODE))) { await note(db, bucket, ip); throw new HttpError(403, 'That invite code is not right.'); }
  const e = cleanEmail(email); if (!e) throw bad('Type a real email address.');
  const pw = String(password || ''); if (pw.length < 10) throw bad('Use a password of at least 10 characters.'); if (pw.length > 200) throw bad('That password is too long (200 characters at most).');
  if (await db.prepare('SELECT 1 x FROM users WHERE email=?').bind(e).first()) throw new HttpError(409, 'There is already an account with this email. Sign in instead.');
  const id = id8(); await db.prepare('INSERT INTO users VALUES (?,?,?,?)').bind(id, e, await hashPassword(pw), Date.now()).run();
  return { actor: who({ id, email: e }), cookie: await startSession(db, id, https) };
}

async function note(db, email, ip) { await db.prepare('INSERT INTO login_attempts VALUES (?,?,?)').bind(email, ip, Date.now()).run(); }
async function throttle(db, email, ip) {
  const since = Date.now() - WINDOW_MS, [a, b] = await Promise.all([db.prepare('SELECT COUNT(*) n FROM login_attempts WHERE email=? AND ts>?').bind(email, since).first(), db.prepare('SELECT COUNT(*) n FROM login_attempts WHERE ip=? AND ts>?').bind(ip, since).first()]);
  if (a.n >= MAX_PER_EMAIL || b.n >= MAX_PER_IP) throw new HttpError(429, 'Too many tries. Wait ten minutes and try again.');
}
export async function login(db, { email, password }, ip, https) {
  const e = cleanEmail(email) || String(email || '').trim().toLowerCase().slice(0, 254);
  await throttle(db, e, ip);
  const u = await db.prepare('SELECT id,email,pw FROM users WHERE email=?').bind(e).first(), ok = await verifyPassword(String(password || '').slice(0, 200), u ? u.pw : await dummyHash());
  if (!u || !ok) { await note(db, e, ip); throw new HttpError(401, 'Wrong email or password.'); }
  await db.prepare('DELETE FROM login_attempts WHERE email=?').bind(e).run();
  return { actor: who(u), cookie: await startSession(db, u.id, https) };
}
export async function logout(db, token, https) {
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256hex(token)).run();
  return cookie('', https, 0);
}
