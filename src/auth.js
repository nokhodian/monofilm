// Every caller is an actor with a role. Admin key (secret ADMIN_KEY) bootstraps the first actors; everyone else uses a per-actor token.
import { HttpError, bad, id8, same, sha256hex, newToken } from './util.js';
import { sessionActor, tokenFrom } from './accounts.js';

const MEDIA_GET = /^\/api\/p\/[^/]+\/media\/[^/]+$/;
export async function authenticate(req, env) {
  let key = (/^Bearer (.+)$/.exec(req.headers.get('authorization') || '') || [])[1];
  if (!key && req.method === 'GET' && MEDIA_GET.test(new URL(req.url).pathname)) { // cookie auth is limited to reading media
    const c = /(?:^|;\s*)mf=([^;]+)/.exec(req.headers.get('cookie') || '');
    if (c) try { key = decodeURIComponent(c[1]); } catch { /* malformed cookie: treat as signed out */ }
  }
  if (!key) {
    // A signed-in person: the session cookie. Anything that changes data must also send the x-mf header, which another website cannot add to a request.
    const t = tokenFrom(req), safe = req.method === 'GET' || req.method === 'HEAD' || req.headers.get('x-mf') === '1';
    return t && safe ? sessionActor(env.DB, t) : null;
  }
  if (env.ADMIN_KEY && (await same(key, env.ADMIN_KEY))) return { id: 'admin', name: 'admin', kind: 'human', role: 'admin' };
  return (await env.DB.prepare('SELECT id,name,kind,role FROM actors WHERE token_hash=?').bind(await sha256hex(key)).first()) || null;
}

export async function createActor(db, { name, kind, role }) {
  if (!['human', 'ai'].includes(kind)) throw bad('kind must be human or ai');
  if (!['admin', 'approver', 'agent', 'viewer'].includes(role)) throw bad('role must be admin, approver, agent or viewer'); // 'member' is only made by signing up
  if (kind === 'ai' && !['agent', 'viewer'].includes(role)) throw new HttpError(400, 'AI actors can only be agent or viewer');
  if (kind === 'human' && role === 'agent') throw bad('humans cannot be agent');
  const nm = String(name || '').trim().slice(0, 40); if (!nm) throw bad('name required');
  const token = newToken(), id = id8();
  await db.prepare('INSERT INTO actors VALUES (?,?,?,?,?,?)').bind(id, nm, kind, role, await sha256hex(token), Date.now()).run();
  return { id, name: nm, kind, role, token }; // the token is shown once and only its hash is stored
}
