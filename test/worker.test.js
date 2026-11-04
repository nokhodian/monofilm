import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1.js';
import worker from '../src/worker.js';
import { createActor } from '../src/auth.js';

const env = { DB: makeDb(), ADMIN_KEY: 'admin-secret' };
const call = async (path, { token = 'admin-secret', method = 'GET', body } = {}) => {
  const res = await worker.fetch(new Request('https://x.test' + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const rpc = (token, method, params, id = 1) => call('/mcp', { token, method: 'POST', body: { jsonrpc: '2.0', id, method, params } });

test('auth: tokens, roles, and the AI-cannot-approve rule', async () => {
  assert.equal((await call('/api/me', { token: null })).status, 401);
  assert.equal((await call('/api/me', { token: 'nope' })).status, 401);
  assert.equal((await call('/api/actors', { method: 'POST', body: { name: 'bot', kind: 'ai', role: 'approver' } })).status, 400);
  const ai = (await call('/api/actors', { method: 'POST', body: { name: 'claude', kind: 'ai', role: 'agent' } })).body;
  const ann = (await call('/api/actors', { method: 'POST', body: { name: 'ann', kind: 'human', role: 'approver' } })).body;
  assert.match(ai.token, /^mf_/);
  assert.equal((await call('/api/me', { token: ai.token })).body.role, 'agent');
  assert.equal((await call('/api/actors', { token: ai.token, method: 'POST', body: { name: 'x', kind: 'ai', role: 'agent' } })).status, 403);
  Object.assign(env, { ai: ai.token, ann: ann.token });
});

test('http flow: agent proposes, human approves, queue and events reflect it', async () => {
  const { body: { id } } = await call('/api/p', { token: env.ann, method: 'POST', body: { name: 'Pilot', format: 'series' } });
  const prop = await call(`/api/p/${id}/propose`, { token: env.ai, method: 'POST', body: { ref: 'logline:main', data: { text: 'A scribe finds a burned ledger.' }, rationale: 'short and clear', cost: 0 } });
  assert.equal(prop.status, 201);
  assert.equal((await call(`/api/p/${id}/queue`, { token: env.ann })).body[0].ref, 'logline:main');
  assert.equal((await call(`/api/p/${id}/decide`, { token: env.ai, method: 'POST', body: { ref: 'logline:main', action: 'approve' } })).status, 403);
  assert.equal((await call(`/api/p/${id}/decide`, { token: env.ann, method: 'POST', body: { ref: 'logline:main', action: 'approve' } })).status, 200);
  const detail = (await call(`/api/p/${id}/artifacts/${encodeURIComponent('logline:main')}`, { token: env.ann })).body;
  assert.equal(detail.status, 'approved');
  assert.deepEqual(detail.events.map((e) => e.action), ['approve', 'propose']);
  assert.equal((await call(`/api/p/${id}/next-work`, { token: env.ai })).body.work[0].kind, 'bible');
  await call(`/api/p/${id}/assets`, { token: env.ai, method: 'POST', body: { ref: 'logline:main', uri: 'mock://image/x', mime: 'image/png' } });
  const list = (await call(`/api/p/${id}/artifacts?assets=1&data=1`, { token: env.ann })).body;
  assert.equal(list[0].assets[0].uri, 'mock://image/x');
  assert.equal(list[0].data.text, 'A scribe finds a burned ledger.');
  env.pid = id;
});

test('mcp: initialize, list tools, call next_work and propose; errors come back as tool errors', async () => {
  assert.equal((await rpc(env.ai, 'initialize', {})).body.result.serverInfo.name, 'monofilm');
  const tools = (await rpc(env.ai, 'tools/list')).body.result.tools.map((t) => t.name);
  for (const n of ['next_work', 'get_canon', 'propose', 'check_continuity', 'call_tool', 'request_budget']) assert.ok(tools.includes(n), n);
  const nw = await rpc(env.ai, 'tools/call', { name: 'next_work', arguments: { production: env.pid } });
  assert.equal(JSON.parse(nw.body.result.content[0].text).work[0].kind, 'bible');
  const canon = await rpc(env.ai, 'tools/call', { name: 'get_canon', arguments: { production: env.pid } });
  assert.equal(JSON.parse(canon.body.result.content[0].text)[0].ref, 'logline:main');
  const pr = await rpc(env.ai, 'tools/call', { name: 'propose', arguments: { production: env.pid, ref: 'scene:s1', data: {}, parent: 'episode:none' } });
  assert.equal(pr.body.result.isError, true);
  assert.match(pr.body.result.content[0].text, /409/);
  assert.equal((await call('/mcp', { token: env.ai, method: 'POST', body: { jsonrpc: '2.0', method: 'notifications/initialized' } })).status, 202);
});

test('cookie sign-in works for media reads only; comments flow over http and mcp', async () => {
  const get = (path, cookie, method = 'GET') => worker.fetch(new Request('https://x.test' + path, { method, headers: cookie ? { cookie: `mf=${cookie}` } : {} }), env);
  const mediaPath = `/api/p/${env.pid}/media/a.png`;
  assert.equal((await get(mediaPath)).status, 401);
  assert.equal((await get(mediaPath, env.ann)).status, 501); // signed in; this test env has no R2 bucket
  assert.equal((await get(mediaPath, 'wrong')).status, 401);
  assert.equal((await get(`/api/p/${env.pid}/artifacts`, env.ann)).status, 401); // the cookie opens nothing else
  const ses = await worker.fetch(new Request('https://x.test/api/session', { method: 'POST', headers: { authorization: `Bearer ${env.ann}` } }), env);
  assert.match(ses.headers.get('set-cookie'), /^mf=.*HttpOnly.*SameSite=Strict/);
  const c = await call(`/api/p/${env.pid}/comments`, { token: env.ann, method: 'POST', body: { ref: 'logline:main', body: 'sharper hook', verdict: 'change' } });
  assert.equal(c.status, 201);
  const fb = await rpc(env.ai, 'tools/call', { name: 'get_feedback', arguments: { production: env.pid, status: 'open' } });
  assert.equal(JSON.parse(fb.body.result.content[0].text)[0].body, 'sharper hook');
  const rp = await rpc(env.ai, 'tools/call', { name: 'comment', arguments: { production: env.pid, ref: 'logline:main', body: 'on it', parent: c.body.id } });
  assert.equal(rp.body.result.isError, undefined);
  const nw = JSON.parse((await rpc(env.ai, 'tools/call', { name: 'next_work', arguments: { production: env.pid } })).body.result.content[0].text);
  assert.equal(nw.work[0].type, 'feedback');
  assert.equal(nw.work[0].thread[0].body, 'on it');
});

test('actors cannot be created by the actor table without a valid role', async () => {
  await assert.rejects(createActor(env.DB, { name: 'x', kind: 'human', role: 'agent' }), /humans cannot be agent/);
});

test('mcp: a client that cannot sign in is told how; the browser preflight needs no token', async () => {
  const pre = await worker.fetch(new Request('https://x.test/mcp', { method: 'OPTIONS' }));
  assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-headers'), /authorization/i);
  const no = await worker.fetch(new Request('https://x.test/mcp', { method: 'POST', body: '{}' }));
  assert.equal(no.status, 401); assert.match(no.headers.get('www-authenticate'), /Bearer/); assert.equal((await no.json()).error.code, -32001);
});
