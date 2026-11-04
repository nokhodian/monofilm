// Email and password accounts, through the Worker the way a browser reaches it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1.js';
import worker from '../src/worker.js';
import { hashPassword, verifyPassword, cleanEmail } from '../src/accounts.js';

const env = { DB: makeDb(), ADMIN_KEY: 'admin-secret', SIGNUP_CODE: 'let-me-in-please' };
const call = async (path, { method = 'GET', body, cookie, key, mf = true, ip = '1.1.1.1', e = env } = {}) => {
  const res = await worker.fetch(new Request('https://x.test' + path, { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(mf ? { 'x-mf': '1' } : {}), ...(cookie ? { cookie } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), e);
  const t = await res.text(); return { status: res.status, body: t ? JSON.parse(t) : null, setCookie: res.headers.get('set-cookie') };
};
const sess = (r) => /mfs=[^;]+/.exec(r.setCookie)[0];
const PW = 'correct horse battery';
const up = (email, extra = {}) => call('/api/auth/signup', { method: 'POST', body: { email, password: PW, code: 'let-me-in-please', ...extra } });

test('passwords are hashed with a salt and checked in full', async () => {
  const a = await hashPassword(PW, 1000), b = await hashPassword(PW, 1000);
  assert.match(a, /^pbkdf2-sha256\$1000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/); assert.notEqual(a, b, 'a new salt each time'); assert.ok(!a.includes(PW));
  assert.equal(await verifyPassword(PW, a), true); assert.equal(await verifyPassword(PW + 'x', a), false); assert.equal(await verifyPassword(PW, 'plaintext'), false); assert.equal(await verifyPassword('', ''), false);
  assert.deepEqual(['A@B.co', ' me@x.org ', 'nope', 'a@b', 'a b@c.de', ''].map(cleanEmail), ['a@b.co', 'me@x.org', null, null, null, null]);
});

test('sign-up needs the invite code, a real email and a long password; the cookie is safe', async () => {
  assert.equal((await call('/api/auth/signup', { method: 'POST', body: { email: 'a@b.co', password: PW, code: 'x' }, e: { ...env, SIGNUP_CODE: undefined } })).status, 403);
  const bad = await up('ann@x.org', { code: 'wrong' }); assert.deepEqual([bad.status, bad.body.error], [403, 'That invite code is not right.']);
  assert.equal((await up('not-an-email')).status, 400); assert.equal((await up('ann@x.org', { password: 'short' })).status, 400);
  assert.equal((await call('/api/auth/signup', { method: 'POST', mf: false, body: { email: 'ann@x.org', password: PW, code: 'let-me-in-please' } })).status, 400, 'a plain cross-site form cannot sign up');
  const ok = await up('Ann@X.org'); assert.equal(ok.status, 201); assert.equal(ok.body.me.email, 'ann@x.org'); assert.equal(ok.body.me.role, 'member');
  assert.match(ok.setCookie, /^mfs=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/);
  assert.equal((await up('ann@x.org')).status, 409, 'one account per email');
  const row = await env.DB.prepare('SELECT pw FROM users WHERE email=?').bind('ann@x.org').first(); assert.ok(row.pw.startsWith('pbkdf2-sha256$') && !row.pw.includes(PW));
  const tok = /mfs=([^;]+)/.exec(ok.setCookie)[1], stored = await env.DB.prepare('SELECT token_hash FROM sessions').all(); assert.ok(stored.results.every((s) => s.token_hash !== tok), 'only a hash of the session token is kept');
});

test('a session cookie signs you in; changes also need the x-mf header; sign-out ends it', async () => {
  const ck = sess(await up('bo@x.org'));
  assert.deepEqual([(await call('/api/me', { cookie: ck })).body.email, (await call('/api/me')).status], ['bo@x.org', 401]);
  assert.equal((await call('/api/p', { method: 'POST', cookie: ck, mf: false, body: { name: 'x' } })).status, 401, 'no x-mf header, no write');
  assert.equal((await call('/api/p', { method: 'POST', cookie: ck, body: { name: 'x' } })).status, 201);
  assert.equal((await call('/api/me', { cookie: 'mfs=forged' })).status, 401);
  const out = await call('/api/auth/logout', { method: 'POST', cookie: ck }); assert.match(out.setCookie, /Max-Age=0/);
  assert.equal((await call('/api/me', { cookie: ck })).status, 401, 'the session is gone on the server too');
});

test('sign-in: right password works, wrong ones are all the same answer, and guessing is slowed', async () => {
  await up('cy@x.org');
  const ok = await call('/api/auth/login', { method: 'POST', body: { email: 'CY@x.org', password: PW } }); assert.equal(ok.status, 200); assert.ok(sess(ok));
  const wrong = await call('/api/auth/login', { method: 'POST', body: { email: 'cy@x.org', password: 'nope-nope-nope' } }), nobody = await call('/api/auth/login', { method: 'POST', body: { email: 'ghost@x.org', password: PW } });
  assert.deepEqual([wrong.status, wrong.body.error, nobody.status, nobody.body.error], [401, 'Wrong email or password.', 401, 'Wrong email or password.'], 'does not tell which emails exist');
  for (let i = 0; i < 7; i++) await call('/api/auth/login', { method: 'POST', body: { email: 'cy@x.org', password: 'bad-bad-bad-bad' }, ip: '9.9.9.' + i });
  const locked = await call('/api/auth/login', { method: 'POST', body: { email: 'cy@x.org', password: PW }, ip: '8.8.8.8' }); assert.equal(locked.status, 429, 'eight misses lock the email for a while, even for the right password');
});

test('a member sees only their own productions, gets a fixed small budget, and cannot raise it', async () => {
  const a = sess(await up('dee@x.org')), b = sess(await up('eli@x.org'));
  const mine = await call('/api/p', { method: 'POST', cookie: a, body: { name: 'Mine', budget: 1000000, shot_cap: 5 } }); assert.equal(mine.status, 201);
  const info = await call(`/api/p/${mine.body.id}`, { cookie: a }); assert.equal(info.body.budget, 15, 'the asked-for budget is ignored'); assert.equal(info.body.shot_cap, 0);
  assert.equal((await call(`/api/p/${mine.body.id}`, { cookie: b })).status, 404, 'someone else\'s production does not exist for you');
  assert.equal((await call(`/api/p/${mine.body.id}/artifacts`, { cookie: b })).status, 404);
  assert.equal((await call(`/api/p/${mine.body.id}/propose`, { method: 'POST', cookie: b, body: { ref: 'logline:main', data: { text: 'x' } } })).status, 404);
  assert.deepEqual((await call('/api/p', { cookie: a })).body.map((p) => p.name), ['Mine']); assert.deepEqual((await call('/api/p', { cookie: b })).body, []);
  assert.ok((await call('/api/p', { key: 'admin-secret' })).body.length >= 2, 'the admin sees everything');
  assert.equal((await call(`/api/p/${mine.body.id}/budget/grant`, { method: 'POST', cookie: a, body: { add: 500 } })).status, 403, 'a member cannot grant themselves credits');
  assert.equal((await call('/api/restore', { method: 'POST', cookie: a, body: { schema: 'monofilm/backup@1' } })).status, 403, 'nor restore a backup that carries its own budget');
  assert.equal((await call('/api/actors', { method: 'POST', cookie: a, body: { name: 'z', kind: 'human', role: 'admin' } })).status, 403);
  assert.equal((await call(`/api/p/${mine.body.id}/propose`, { method: 'POST', cookie: a, body: { ref: 'logline:main', data: { text: 'ok' }, auto_approve: true } })).status, 201, 'but they can work their own');
  for (let i = 0; i < 2; i++) await call('/api/p', { method: 'POST', cookie: a, body: { name: 'More' + i } });
  const over = await call('/api/p', { method: 'POST', cookie: a, body: { name: 'Fourth' } }); assert.equal(over.status, 403); assert.match(over.body.error, /up to 3/);
  const g = await call(`/api/p/${mine.body.id}/budget/grant`, { method: 'POST', key: 'admin-secret', body: { add: 10 } }); assert.equal(g.status, 200, 'the admin still can');
});

test('the admin key and per-actor tokens still work as before', async () => {
  assert.equal((await call('/api/me', { key: 'admin-secret' })).body.role, 'admin');
  const ai = (await call('/api/actors', { method: 'POST', key: 'admin-secret', body: { name: 'claude', kind: 'ai', role: 'agent' } })).body;
  assert.equal((await call('/api/me', { key: ai.token })).body.role, 'agent');
  assert.equal((await call('/api/actors', { method: 'POST', key: 'admin-secret', body: { name: 'x', kind: 'human', role: 'member' } })).status, 400, 'members are only made by signing up');
});

test('wrong invite codes slow down the guesser, not everyone else', async () => {
  for (let i = 0; i < 9; i++) await up(`g${i}@x.org`, { code: 'guess' + i }).then(() => {}, () => {});
  const stuck = await call('/api/auth/signup', { method: 'POST', body: { email: 'late@x.org', password: PW, code: 'let-me-in-please' }, ip: '5.5.5.5' }), ok = await up('fine@x.org');
  assert.equal(ok.status, 429, 'the address that guessed is held back, even with the right code');
  assert.equal(stuck.status, 201, 'someone else can still sign up');
});
