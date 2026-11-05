// /api/auth/signup, /api/auth/login, /api/auth/logout. These are the only calls that need no sign-in.
import { HttpError, json, parseJson } from './util.js';
import { signup, login, logout, tokenFrom } from './accounts.js';
import { authenticate } from './auth.js';

export async function authApi(req, env) {
  const url = new URL(req.url), https = url.protocol === 'https:', ip = req.headers.get('cf-connecting-ip') || 'local', what = url.pathname.split('/')[3];
  if (req.method === 'GET' && what === 'me') return json({ me: await authenticate(req, env) }); // who is signed in, or null: no 401 for a first visit
  if (req.method !== 'POST') throw new HttpError(405, 'POST only');
  if (req.headers.get('x-mf') !== '1') throw new HttpError(400, 'missing x-mf header'); // a plain cross-site form cannot set it
  if (what === 'logout') return json({ ok: true }, 200, { 'set-cookie': await logout(env.DB, tokenFrom(req), https) });
  const body = parseJson(await req.text(), null); if (!body || typeof body !== 'object') throw new HttpError(400, 'body must be JSON');
  if (what === 'signup') { const r = await signup(env.DB, env, body, ip, https); return r.pending ? json({ pending: true, message: 'Thank you. Your request is waiting for approval. We will email you as soon as it is approved.' }, 202) : json({ me: r.actor }, 201, { 'set-cookie': r.cookie }); }
  if (what === 'login') { const r = await login(env.DB, body, ip, https); return json({ me: r.actor }, 200, { 'set-cookie': r.cookie }); }
  throw new HttpError(404, 'not found');
}
