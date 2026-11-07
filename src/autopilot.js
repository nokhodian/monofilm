// "Roll camera" on the server: the AI does every step of the wizard and approves it, and carries on when the page is closed.
// What to do next is decided by the same pure planner the page used (public/js/w-auto-pure.js), from the production's real state before every move, so a run that was
// interrupted simply goes on from where the work really is. A cron tick every minute (see worker.js) picks up any run that is still going; starting one also begins it at once.
// The approvals are the person's own: they are recorded under their name as "Approved by Roll camera".
import { HttpError, bad, parseJson } from './util.js';
import * as S from './store.js';
import * as W from './wizard.js';
import { R } from '../public/js/wizard-model.js';
import { starterStage } from '../public/js/w-stage-pure.js';
import { plan, remaining, describe, pageOf } from '../public/js/w-auto-pure.js';

const LEASE_MS = 150 * 1000, MAX_STEPS = 7, MAX_MS = 8 * 60 * 1000; // one worker run does a few moves, then the next tick carries on (a worker may only make so many calls at a time)
const now = () => Date.now();
const NO_CREDITS = 'The credits for this production are used up. Ask the person who runs this studio to add credits, then press Resume. Everything made so far is kept.';

const rowOf = (db, pid) => db.prepare('SELECT * FROM autopilot WHERE production=?').bind(pid).first();
const view = (r) => (r ? { status: r.status, done: r.done, log: parseJson(r.log, []), err: r.err, cur: parseJson(r.cur, null), left: r.left, spent0: r.spent0, started: r.started, finished: r.finished, updated: r.updated } : { status: 'idle', done: 0, log: [], err: '', cur: null, left: 0, spent0: 0, started: 0, finished: 0, updated: 0 });
export const status = async (db, pid) => view(await rowOf(db, pid));

// The state the planner reads: every artifact with its data and pictures.
async function state(db, pid) {
  const [arts, assets] = await Promise.all([S.listArtifacts(db, pid, {}), S.assetsByRef(db, pid)]);
  const list = arts.map((a) => ({ ...a, assets: assets[a.ref] || [] }));
  return { arts: list, by: Object.fromEntries(list.map((a) => [a.ref, a])) };
}

const save = (db, pid, f) => db.prepare('UPDATE autopilot SET status=?, err=?, cur=?, left=?, done=?, log=?, finished=?, lease=?, updated=? WHERE production=?').bind(f.status, f.err ?? '', f.cur ? JSON.stringify(f.cur) : null, f.left ?? 0, f.done, JSON.stringify((f.log || []).slice(0, 40)), f.finished ?? 0, f.lease ?? 0, now(), pid).run();

export async function start(env, db, actor, pid, ctx) {
  const d = await state(db, pid), a = plan(d);
  if (a.type === 'blocked') throw bad(a.why);
  const cur = await rowOf(db, pid), b = await S.budgetStatus(db, pid), t = now(), who = JSON.stringify({ id: actor.id, name: actor.name, kind: actor.kind, role: actor.role });
  const fresh = !cur || cur.status === 'done' || cur.status === 'idle', log = [{ t, text: fresh ? 'Started. Rolling camera.' : 'Carrying on.' }, ...(fresh ? [] : parseJson(cur.log, []))].slice(0, 40);
  await db.prepare('INSERT INTO autopilot (production,status,actor,done,log,err,cur,left,spent0,started,finished,lease,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(production) DO UPDATE SET status=excluded.status, actor=excluded.actor, done=excluded.done, log=excluded.log, err=excluded.err, cur=NULL, left=excluded.left, spent0=excluded.spent0, started=excluded.started, finished=0, lease=0, updated=excluded.updated')
    .bind(pid, 'running', who, fresh ? 0 : cur.done, JSON.stringify(log), '', null, remaining(d), fresh ? b.spent : cur.spent0, fresh ? t : cur.started || t, 0, 0, t).run();
  if (ctx && ctx.waitUntil) ctx.waitUntil(runOnce(env, pid)); // begin now; the cron tick takes over if this is cut short
  return status(db, pid);
}
export async function stop(db, pid) {
  await db.prepare("UPDATE autopilot SET status='paused', err='Paused. Press Resume to carry on.', updated=? WHERE production=? AND status='running'").bind(now(), pid).run();
  return status(db, pid);
}

// One move of the plan, done as the person who started the run.
async function exec(env, db, actor, pid, a, d) {
  const retry = async (f) => { try { return await f(); } catch (e) { if (e instanceof HttpError && e.status >= 500) { await new Promise((r) => setTimeout(r, 1500)); return f(); } throw e; } };
  const edit = async (ref, fn, why) => { // the person's own edit: read, change, save only if nothing changed in between, else read again
    for (let i = 0; ; i++) {
      const x = await S.getArtifact(db, pid, ref), data = fn(JSON.parse(JSON.stringify(x.data)));
      try { return await S.propose(db, actor, pid, { ref, data, parent: x.parent || undefined, deps: (x.deps || []).filter((y) => y !== x.parent), auto_approve: x.status !== 'proposed', rationale: why, base_version: x.version }); }
      catch (e) { if (!/changed while you were saving/.test(String(e.message)) || i >= 4) throw e; }
    }
  };
  const worry = (r, what) => { if (r && r.check && !r.check.ok) throw new Error(`I stopped because ${what} does not look right, even after drawing it again: ${r.check.problem || r.check.seen}. Look at it, change the description or redraw it, then press Resume.`); return r; };
  switch (a.type) {
    case 'read': return retry(() => W.readStory(env, db, actor, pid));
    case 'approve': { let ok = 0, last; for (const ref of a.refs) { try { await S.decide(db, actor, pid, { ref, action: 'approve', comment: 'Approved by Roll camera' }); ok++; } catch (e) { last = e; } } if (!ok) throw last; return; }
    case 'face': return worry(await retry(() => W.makeFace(env, db, actor, pid, { id: a.id, variant: 0 })), `the picture of ${a.name}`);
    case 'anchor': return edit(a.ref, (x) => ({ ...x, anchor: a.assetId }), 'Main face chosen by Roll camera');
    case 'plate': return worry(await retry(() => W.makePlate(env, db, actor, pid, { id: a.id })), `the picture of ${a.name}`);
    case 'scenes': return retry(() => W.draftScenes(env, db, actor, pid));
    case 'stage': { const sc = d.by[R.scene(a.scene)]; return S.propose(db, actor, pid, { ref: R.stage(a.scene), data: starterStage(a.scene, sc.data, (r) => (d.by[r] || {}).data, (r) => (r && d.by[r] || {}).data || null), parent: R.scene(a.scene), deps: [], auto_approve: true, rationale: 'A first layout made by Roll camera' }); }
    case 'frame': return worry(await retry(() => W.makeFrame(env, db, actor, pid, { scene: a.scene, clip: a.clip, which: a.which })), `the ${a.which} picture for scene ${a.n}, ${a.name}`);
    case 'pick': return edit(a.ref, (x) => ({ ...x, chosen: a.assetId }), 'Picture put in use by Roll camera');
    default: throw new Error(`I do not know how to do "${a.type}".`);
  }
}

// A few moves, then let go. Safe to call from several places: only one caller holds the lease on a production at a time.
export async function runOnce(env, pid) {
  const db = env.DB, t0 = now();
  const got = await db.prepare("UPDATE autopilot SET lease=? WHERE production=? AND status='running' AND lease<?").bind(t0 + LEASE_MS, pid, t0).run();
  if (!got.meta.changes) return;
  try {
    for (let n = 0; n < MAX_STEPS && now() - t0 < MAX_MS; n++) {
      const r = await rowOf(db, pid); if (!r || r.status !== 'running') return; // stopped in the meantime
      const actor = parseJson(r.actor, null); if (!actor) return;
      const f = { status: 'running', done: r.done, log: parseJson(r.log, []), err: '', finished: 0, lease: now() + LEASE_MS };
      const d = await state(db, pid), a = plan(d); f.left = remaining(d);
      if (a.type === 'done') { await save(db, pid, { ...f, status: 'done', cur: { ...describe(a), page: '#/w/ship' }, left: 0, log: [{ t: now(), text: 'All done. Everything is made and approved.' }, ...f.log], finished: now(), lease: 0 }); return; }
      if (a.type === 'blocked') { await save(db, pid, { ...f, status: 'error', err: a.why, lease: 0 }); return; }
      const sig = JSON.stringify(a), prev = parseJson(r.cur, null), cur = { ...describe(a), page: pageOf(a), cost: a.cost || 0, sig, same: prev && prev.sig === sig ? (prev.same || 0) + 1 : 0 };
      if (cur.same >= 2) { await save(db, pid, { ...f, status: 'error', cur, err: `I got stuck on "${describe(a).title}": it did not change anything. Look at that page, then press Resume.`, lease: 0 }); return; }
      if (a.cost) { const b = await S.budgetStatus(db, pid); if (b.remaining < a.cost) { await save(db, pid, { ...f, status: 'paused', cur, err: NO_CREDITS, lease: 0 }); return; } }
      await save(db, pid, { ...f, cur }); // show what is being done now
      try { await exec(env, db, actor, pid, a, d); }
      catch (e) {
        const out = (e instanceof HttpError && e.status === 402) || /budget|credit/i.test(String(e.message));
        await save(db, pid, { ...f, status: out ? 'paused' : 'error', cur, err: out ? NO_CREDITS : (e.message || 'Something went wrong.'), lease: 0 }); return;
      }
      await save(db, pid, { ...f, cur, done: r.done + 1, log: [{ t: now(), text: cur.title }, ...f.log] });
    }
  } catch (e) {
    console.error('roll camera', pid, e);
    await db.prepare("UPDATE autopilot SET status='error', err=?, lease=0, updated=? WHERE production=?").bind('Something went wrong on the server. Press Resume to try again.', now(), pid).run().catch(() => {});
  } finally { await db.prepare('UPDATE autopilot SET lease=0 WHERE production=?').bind(pid).run().catch(() => {}); }
}

// Every minute: carry on every run that is still going.
export async function tick(env) {
  const rows = (await env.DB.prepare("SELECT production FROM autopilot WHERE status='running' AND lease<? LIMIT 5").bind(now()).all()).results;
  await Promise.all(rows.map((r) => runOnce(env, r.production)));
}
