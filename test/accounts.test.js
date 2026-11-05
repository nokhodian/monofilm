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
  const bad = await up('ann@x.org', { code: 'wrong' }); assert.equal(bad.status, 403); assert.match(bad.body.error, /invite code is not right/);
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

// ---- approval, emails, account credits ----
const mails = [];
const mailEnv = { ...env, RESEND_API_KEY: 're_test', MAIL_FROM: 'Monofilm <noreply@x.test>', ADMIN_EMAIL: 'boss@x.test' };
const realFetch = globalThis.fetch;
const withMail = async (f) => { globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://api.resend.com/')) { mails.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); } return realFetch(url, init); }; try { return await f(); } finally { globalThis.fetch = realFetch; } };
const ask = (email, extra = {}, ip = '3.3.3.3') => call('/api/auth/signup', { method: 'POST', e: mailEnv, ip, body: { email, password: PW, ...extra } });
const upIp = (email, ip, extra = {}) => call('/api/auth/signup', { method: 'POST', ip, body: { email, password: PW, code: 'let-me-in-please', ...extra } });

test('without an invite code a sign-up waits for approval; the person is told, and signs in once approved', async () => withMail(async () => {
  const r = await ask('pat@x.org', {}, '3.3.3.4'); assert.equal(r.status, 202); assert.equal(r.body.pending, true); assert.equal(r.setCookie, null, 'no session while waiting');
  assert.deepEqual([mails.at(-1).to, mails.at(-1).subject], [['boss@x.test'], 'Monofilm: someone asked for access'], 'the studio owner hears about the request');
  const wait = await call('/api/auth/login', { method: 'POST', body: { email: 'pat@x.org', password: PW } }); assert.equal(wait.status, 403); assert.match(wait.body.error, /waiting for approval/);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'pat@x.org', password: 'wrong-wrong-wrong' } })).status, 401, 'a wrong password still learns nothing');
  const list = await call('/api/accounts', { key: 'admin-secret' }); assert.equal(list.body[0].email, 'pat@x.org'); assert.equal(list.body[0].status, 'pending', 'pending ones are listed first');
  const id = list.body[0].id;
  const approved = await call('/api/accounts/' + id, { method: 'POST', key: 'admin-secret', e: mailEnv, body: { action: 'approve' } }); assert.equal(approved.body.status, 'approved');
  assert.deepEqual([mails.at(-1).to, mails.at(-1).subject], [['pat@x.org'], 'Your Monofilm account is approved'], 'the person is told when it is approved');
  const ok = await call('/api/auth/login', { method: 'POST', body: { email: 'pat@x.org', password: PW } }); assert.equal(ok.status, 200);
  const n = mails.length; await call('/api/accounts/' + id, { method: 'POST', key: 'admin-secret', e: mailEnv, body: { action: 'approve' } }); assert.equal(mails.length, n, 'approving twice does not email twice');
}));

test('a valid invite code is approved at once; a wrong one is refused; only the studio owner sees and decides on accounts', async () => {
  const r = await upIp('quinn@x.org', '4.4.4.4'); assert.equal(r.status, 201); assert.ok(sess(r));
  assert.equal((await upIp('rae@x.org', '4.4.4.5', { code: 'nope' })).status, 403);
  assert.equal((await call('/api/accounts', { cookie: sess(r) })).status, 403, 'a member cannot list accounts');
  assert.equal((await call('/api/accounts')).status, 401);
  const wait = await ask('sol@x.org', {}, '4.4.4.6'); const id = (await call('/api/accounts', { key: 'admin-secret' })).body.find((u) => u.email === 'sol@x.org').id;
  assert.equal((await call('/api/accounts/' + id, { method: 'POST', cookie: sess(r), body: { action: 'approve' } })).status, 403, 'nor approve one');
  await call('/api/accounts/' + id, { method: 'POST', key: 'admin-secret', body: { action: 'reject' } });
  const no = await call('/api/auth/login', { method: 'POST', body: { email: 'sol@x.org', password: PW } }); assert.equal(no.status, 403); assert.match(no.body.error, /not approved/);
  assert.equal((await call('/api/accounts/' + id, { method: 'POST', key: 'admin-secret', body: { action: 'dance' } })).status, 400);
});

test('credits belong to the account: one production may use all of it, and all its productions together never pass it', async () => {
  const r = await upIp('tess@x.org', '5.5.5.5'), ck = sess(r), id = (await call('/api/accounts', { key: 'admin-secret' })).body.find((u) => u.email === 'tess@x.org').id;
  await call('/api/accounts/' + id, { method: 'POST', key: 'admin-secret', body: { action: 'credits', add: 25 } }); // 15 + 25 = 40
  const a = (await call('/api/p', { method: 'POST', cookie: ck, body: { name: 'A' } })).body.id, b = (await call('/api/p', { method: 'POST', cookie: ck, body: { name: 'B' } })).body.id;
  assert.equal((await call(`/api/p/${a}`, { cookie: ck })).body.budget, 40, 'the whole allowance, not a small slice');
  const S = await import('../src/store.js'), act = { id: 'u:' + id, name: 'tess@x.org', kind: 'human', role: 'member' };
  for (const pid of [a, b]) await S.propose(env.DB, act, pid, { ref: 'logline:main', data: { text: 'x' }, auto_approve: true });
  await S.charge(env.DB, act, a, { ref: 'logline:main', tool: 't', credits: 30 });
  await assert.rejects(S.charge(env.DB, act, b, { ref: 'logline:main', tool: 't', credits: 11 }), /over budget/, 'B has room on its own, but the account only has 10 left');
  assert.equal(await S.charge(env.DB, act, b, { ref: 'logline:main', tool: 't', credits: 10 }), 10);
  const g = await call(`/api/p/${a}/budget/grant`, { method: 'POST', key: 'admin-secret', body: { add: 5 } }); assert.equal(g.status, 200);
  assert.equal(await S.charge(env.DB, act, a, { ref: 'logline:main', tool: 't', credits: 5 }), 5, 'credits the owner adds to a production go to the account');
});
