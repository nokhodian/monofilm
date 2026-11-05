// Email and password accounts. A password is kept only as a salted PBKDF2 hash. A session is a random token in an HttpOnly cookie; only its hash is stored.
// Signing up creates a request that the person who runs the studio approves (they are emailed when it is approved), so a public page cannot spend the studio's Meta credits.
// A valid invite code in env.SIGNUP_CODE skips the wait: that account is approved at once.
import { HttpError, bad, id8, same, sha256hex, newToken } from './util.js';
import { sendMail } from './mail.js';

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
  const u = await db.prepare("SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND u.status='approved'").bind(await sha256hex(token), Date.now()).first();
  return u ? who(u) : null;
}

export async function signup(db, env, { email, password, code }, ip, https) {
  const bucket = `signup:${ip}`; await throttle(db, bucket, ip); // wrong codes and repeated requests are counted per address, so one person cannot lock everyone else out
  const given = String(code || '').trim();
  if (given && !(env.SIGNUP_CODE && (await same(given, env.SIGNUP_CODE)))) { await note(db, bucket, ip); throw new HttpError(403, 'That invite code is not right. Leave it empty to ask for approval instead.'); }
  const e = cleanEmail(email); if (!e) throw bad('Type a real email address.');
  const pw = String(password || ''); if (pw.length < 10) throw bad('Use a password of at least 10 characters.'); if (pw.length > 200) throw bad('That password is too long (200 characters at most).');
  if (await db.prepare('SELECT 1 x FROM users WHERE email=?').bind(e).first()) throw new HttpError(409, 'There is already an account with this email. Sign in instead.');
  const id = id8(), approved = !!given, credits = Number(env.MEMBER_BUDGET) || 15;
  await db.prepare('INSERT INTO users (id,email,pw,created,status,credits) VALUES (?,?,?,?,?,?)').bind(id, e, await hashPassword(pw), Date.now(), approved ? 'approved' : 'pending', credits).run();
  if (!approved) {
    await note(db, bucket, ip);
    await sendMail(env, { to: env.ADMIN_EMAIL, subject: 'Monofilm: someone asked for access', text: `${e} asked for an account on Monofilm. Approve or decline it on the Accounts page.` });
    return { pending: true };
  }
  return { actor: who({ id, email: e }), cookie: await startSession(db, id, https) };
}

// ---- the person who runs the studio decides on sign-ups ----
export async function listAccounts(db) {
  const r = await db.prepare(`SELECT u.id,u.email,u.status,u.credits,u.created,
    (SELECT COUNT(*) FROM productions p WHERE p.owner='u:'||u.id) productions,
    (SELECT COALESCE(SUM(l.credits),0) FROM ledger l JOIN productions p ON p.id=l.production WHERE p.owner='u:'||u.id) spent
    FROM users u ORDER BY (u.status='pending') DESC, u.created DESC`).all();
  return r.results;
}
export async function decideAccount(db, env, id, { action, add }) {
  const u = await db.prepare('SELECT id,email,status FROM users WHERE id=?').bind(String(id)).first(); if (!u) throw new HttpError(404, 'no such account');
  if (action === 'approve') {
    await db.prepare("UPDATE users SET status='approved' WHERE id=?").bind(u.id).run();
    if (u.status !== 'approved') await sendMail(env, { to: u.email, subject: 'Your Monofilm account is approved', text: `Good news: your Monofilm account is approved. You can sign in now with this email and the password you chose:\n\nhttps://monofilm.nokhodian.workers.dev/app\n\nThe AI proposes, you direct.` });
  } else if (action === 'reject') {
    await db.prepare("UPDATE users SET status='rejected' WHERE id=?").bind(u.id).run(); // a session of a rejected account stops working at once: only approved accounts are recognised
  } else if (action === 'credits') {
    const n = Number(add); if (!Number.isFinite(n) || n <= 0) throw bad('add must be a number above 0');
    // the account's allowance, and each of its productions may use all of it
    await db.batch([db.prepare('UPDATE users SET credits=credits+? WHERE id=?').bind(n, u.id), db.prepare('UPDATE productions SET budget=budget+? WHERE owner=?').bind(n, `u:${u.id}`)]);
  } else throw bad('action must be approve, reject or credits');
  return (await listAccounts(db)).find((x) => x.id === u.id);
}

async function note(db, email, ip) { await db.prepare('INSERT INTO login_attempts VALUES (?,?,?)').bind(email, ip, Date.now()).run(); }
async function throttle(db, email, ip) {
  const since = Date.now() - WINDOW_MS, [a, b] = await Promise.all([db.prepare('SELECT COUNT(*) n FROM login_attempts WHERE email=? AND ts>?').bind(email, since).first(), db.prepare('SELECT COUNT(*) n FROM login_attempts WHERE ip=? AND ts>?').bind(ip, since).first()]);
  if (a.n >= MAX_PER_EMAIL || b.n >= MAX_PER_IP) throw new HttpError(429, 'Too many tries. Wait ten minutes and try again.');
}
export async function login(db, { email, password }, ip, https) {
  const e = cleanEmail(email) || String(email || '').trim().toLowerCase().slice(0, 254);
  await throttle(db, e, ip);
  const u = await db.prepare('SELECT id,email,pw,status FROM users WHERE email=?').bind(e).first(), ok = await verifyPassword(String(password || '').slice(0, 200), u ? u.pw : await dummyHash());
  if (!u || !ok) { await note(db, e, ip); throw new HttpError(401, 'Wrong email or password.'); }
  if (u.status === 'pending') throw new HttpError(403, 'Your account is waiting for approval. We will email you as soon as it is approved.');
  if (u.status === 'rejected') throw new HttpError(403, 'This sign-up was not approved.');
  await db.prepare('DELETE FROM login_attempts WHERE email=?').bind(e).run();
  return { actor: who(u), cookie: await startSession(db, u.id, https) };
}
export async function logout(db, token, https) {
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256hex(token)).run();
  return cookie('', https, 0);
}
