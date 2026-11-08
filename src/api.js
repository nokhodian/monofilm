// HTTP API for the human UI and scripts. /api/me, /api/actors, /api/tools, /api/p/...
import { HttpError, bad, json } from './util.js';
import { can } from './kinds.js';
import * as S from './store.js';
import { createActor } from './auth.js';
import { listAccounts, decideAccount } from './accounts.js';
import * as AP from './autopilot.js';
import { registerTool, listTools, callTool } from './tools.js';
import { checkAdherence } from './adherence.js';
import { transcribe, metaConfigured, listMetaModels, modelOf, MODELS } from './meta.js';
import { runAgent } from './agent.js';
import * as W from './wizard.js';

const MAX_MEDIA = 25 * 1024 * 1024;
const body = async (req) => { try { return await req.json(); } catch { throw bad('body must be JSON'); } };
const must = (actor, action) => { if (!can(actor, action)) throw new HttpError(403, `role ${actor.role} cannot ${action}`); };

export async function api(req, env, actor, ctx) {
  const url = new URL(req.url), m = req.method, db = env.DB;
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // ['api', ...]
  const [, a, b, c, d] = parts;
  if (a === 'me' && m === 'GET') return json(actor);
  // Media tags cannot send a header, so signing in also sets an HttpOnly cookie that is honoured for media GETs only.
  if (a === 'session') {
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    if (m === 'POST') return json({ ok: true }, 200, { 'set-cookie': `mf=${encodeURIComponent((/^Bearer (.+)$/.exec(req.headers.get('authorization') || '') || [])[1])}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=2592000${secure}` });
    if (m === 'DELETE') return json({ ok: true }, 200, { 'set-cookie': `mf=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure}` });
  }
  if (a === 'meta' && b === 'models' && m === 'GET') { must(actor, 'manage'); return json(await listMetaModels(env)); } // which Meta models this studio's key can use
  if (a === 'accounts') { // who asked for access: the person who runs the studio approves or declines, and gives credits
    must(actor, 'manage');
    if (m === 'GET' && !b) return json(await listAccounts(db));
    if (m === 'POST' && b) return json(await decideAccount(db, env, b, await body(req)));
  }
  if (a === 'actors' && m === 'POST') { must(actor, 'manage'); return json(await createActor(db, await body(req)), 201); }
  if (a === 'restore' && m === 'POST') { must(actor, 'budget'); return json(await S.restoreBackup(db, actor, await body(req)), 201); } // a backup carries its own budget, so only someone who may grant credits may restore one
  if (a === 'meta' && b === 'status' && m === 'GET') return json({ configured: metaConfigured(env), models: Object.fromEntries(Object.keys(MODELS).map((k) => [k, modelOf(env, k)])) });
  if (a === 'tools') {
    if (m === 'GET') return json(await listTools(db));
    if (m === 'POST') { must(actor, 'manage'); return json(await registerTool(db, await body(req)), 201); }
  }
  if (a !== 'p') throw new HttpError(404, 'not found');
  if (!b) {
    if (m === 'GET') return json(await S.listProductions(db, actor));
    if (m === 'POST') {
      const o = await body(req);
      if (actor.role === 'member') { // a signed-up person gets a small fixed budget and a few productions, whatever they ask for
        const cap = Number(env.MEMBER_PRODUCTIONS) || 3; if ((await S.countOwned(db, actor)) >= cap) throw new HttpError(403, `You can have up to ${cap} productions. Ask the person who runs this studio for more.`);
        const u = await db.prepare('SELECT credits FROM users WHERE id=?').bind(actor.id.slice(2)).first(); // a production may use the whole account's allowance; the account total is what stops it
        o.budget = u ? u.credits : Number(env.MEMBER_BUDGET) || 15; o.shot_cap = 0;
      }
      return json(await S.createProduction(db, actor, o), 201);
    }
  }
  const pid = b;
  if (actor.role === 'member') await S.ownProduction(db, actor, pid);
  if (!c && m === 'GET') {
    const pr = await S.getProduction(db, pid), cnt = {};
    for (const x of (await db.prepare('SELECT status, COUNT(*) n FROM artifacts WHERE production=? GROUP BY status').bind(pid).all()).results) cnt[x.status] = x.n;
    return json({ ...pr, counts: cnt, budget_status: await S.budgetStatus(db, pid) });
  }
  if (c === 'artifacts' && m === 'GET') {
    if (d) return json(await S.getArtifact(db, pid, d));
    const q = url.searchParams, assets = q.get('assets') === '1' ? await S.assetsByRef(db, pid) : null;
    return json((await S.listArtifacts(db, pid, { kind: q.get('kind'), status: q.get('status'), parent: q.get('parent'), stale: q.has('stale') ? q.get('stale') === '1' : undefined }))
      .map(({ data, ...r }) => ({ ...r, ...(q.get('data') === '1' ? { data } : {}), ...(assets ? { assets: assets[r.ref] || [] } : {}) })));
  }
  if (c === 'comments') {
    if (m === 'GET') return json(await S.listComments(db, pid, { ref: url.searchParams.get('ref') || undefined, status: url.searchParams.get('status') || undefined }));
    if (m === 'POST' && !d) return json(await S.addComment(db, actor, pid, await body(req)), 201);
    if (m === 'POST' && d) return json(await S.resolveComment(db, actor, pid, d, (await body(req)).resolved !== false));
  }
  if (c === 'pulse' && m === 'GET') return json(await S.pulse(db, actor, pid));
  if (c === 'backup' && m === 'GET') { must(actor, 'decide'); return json(await S.backup(db, pid)); }
  if (c === 'meta' && m === 'POST') { // the Meta models, called from the Worker so the key never reaches a browser
    if (d === 'adherence') { must(actor, 'call_tool'); const r = await checkAdherence(env, db, pid, await body(req)); await S.logEvent(db, pid, r.stage, 'meta_adherence', actor, `${r.shot}: score ${r.score}`); return json(r); }
    if (d === 'transcribe') { must(actor, 'comment'); if (Number(req.headers.get('content-length') || 0) > 32 * 1024 * 1024) throw new HttpError(413, 'recording too large (32 MB max)'); return json(await transcribe(env, await req.arrayBuffer(), { language: url.searchParams.get('lang') || undefined })); }
    if (d === 'agent') { if (actor.kind !== 'human' || !can(actor, 'decide')) throw new HttpError(403, 'only a human starts the AI'); const r = await runAgent(env, db, pid, await body(req).catch(() => ({}))); await S.logEvent(db, pid, null, 'agent_run', actor, `${r.steps.length} steps`); return json(r); }
  }
  if (c === 'wizard' && m === 'POST') { // the wizard's actions: each is started by a human, the AI proposes, the human reviews
    const b2 = await body(req).catch(() => ({})), act = { read: () => W.readStory(env, db, actor, pid), scenes: () => W.draftScenes(env, db, actor, pid), brief: () => W.draftBrief(env, db, actor, pid, b2), beats: () => W.draftBeats(env, db, actor, pid, b2), view: () => W.makeView(env, db, actor, pid, b2), revise: () => W.reviseItem(env, db, actor, pid, b2), clips: async () => ({ shots: await W.ensureClips(db, actor, pid, b2.scene) }), face: () => W.makeFace(env, db, actor, pid, b2), plate: () => W.makePlate(env, db, actor, pid, b2), frame: () => W.makeFrame(env, db, actor, pid, b2), take: () => W.addTake(db, actor, pid, b2) }[d];
    if (!act) throw new HttpError(404, `no wizard action ${d}`);
    return json(await act(), 201);
  }
  if (c === 'autopilot') { // Roll camera, run by the server so it carries on when the page is closed
    if (m === 'GET') return json(await AP.status(db, pid));
    if (m === 'POST' && d === 'start') { must(actor, 'decide'); if (actor.kind !== 'human') throw new HttpError(403, 'only a human starts Roll camera'); return json(await AP.start(env, db, actor, pid, ctx), 201); }
    if (m === 'POST' && d === 'stop') { must(actor, 'decide'); return json(await AP.stop(db, pid)); }
  }
  if (c === 'queue' && m === 'GET') return json(await S.queue(db, pid));
  if (c === 'next-work' && m === 'GET') return json(await S.nextWork(db, pid));
  if (c === 'continuity' && m === 'GET') return json(await S.checkContinuity(db, pid, url.searchParams.get('ref') || undefined));
  if (c === 'events' && m === 'GET') return json(await S.events(db, pid, url.searchParams.get('since'), url.searchParams.get('tail') === '1'));
  if (c === 'budget' && !d && m === 'GET') return json(await S.budgetStatus(db, pid));
  if (m === 'POST') {
    if (c === 'propose') return json(await S.propose(db, actor, pid, await body(req)), 201);
    if (c === 'decide') return json(await S.decide(db, actor, pid, await body(req)));
    if (c === 'lock') return json(await S.setLock(db, actor, pid, await body(req)));
    if (c === 'assets') return json(await S.attachAsset(db, actor, pid, await body(req)), 201);
    if (c === 'tool-call') return json(await callTool(db, env, actor, pid, await body(req)), 201);
    if (c === 'budget' && d === 'grant') return json(await S.grantBudget(db, actor, pid, await body(req)));
    if (c === 'budget' && d === 'request') return json(await S.requestBudget(db, actor, pid, await body(req)), 201);
  }
  if (c === 'media' && d && /^[A-Za-z0-9._-]{1,100}$/.test(d)) {
    if (!env.MEDIA) throw new HttpError(501, 'media storage is not configured');
    await S.getProduction(db, pid);
    const key = `${pid}/${d}`;
    if (m === 'PUT') {
      must(actor, 'propose');
      if (Number(req.headers.get('content-length') || 0) > MAX_MEDIA) throw new HttpError(413, 'file too large (25 MB max)');
      await env.MEDIA.put(key, req.body, { httpMetadata: { contentType: req.headers.get('content-type') || 'application/octet-stream' } });
      return json({ uri: `media/${key}` }, 201);
    }
    if (m === 'GET') {
      const head = await env.MEDIA.head(key);
      if (!head) throw new HttpError(404, 'no such file');
      const base = { 'content-type': head.httpMetadata?.contentType || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" };
      const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
      if (!rg || (!rg[1] && !rg[2])) return new Response((await env.MEDIA.get(key)).body, { headers: { ...base, 'content-length': String(head.size) } });
      const size = head.size, start = rg[1] ? Number(rg[1]) : Math.max(0, size - Number(rg[2])), end = rg[1] && rg[2] ? Math.min(Number(rg[2]), size - 1) : size - 1;
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
      const o = await env.MEDIA.get(key, { range: { offset: start, length: end - start + 1 } });
      return new Response(o.body, { status: 206, headers: { ...base, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) } });
    }
  }
  throw new HttpError(404, 'not found');
}
