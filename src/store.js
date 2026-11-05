// Domain logic: artifacts move proposed -> approved -> locked. Editing anything marks what was built on it stale.
import { HttpError, bad, id8, parseJson } from './util.js';
import { KINDS, PIPELINE, DONE, FORMATS, REQUIRES, VERDICTS, NEEDS_NOTE, isCanon, parseRef, can } from './kinds.js';

const MAX_DATA = 1_500_000;
const ts = () => Date.now();
const p = (db, sql, ...a) => db.prepare(sql).bind(...a);
const need = (actor, action) => { if (!can(actor, action)) throw new HttpError(403, `role ${actor.role} cannot ${action}`); };
const needHuman = (actor, action) => { need(actor, action); if (actor.kind !== 'human') throw new HttpError(403, `${action} is for humans`); };
const view = (r) => r && { ...r, stale: !!r.stale, data: parseJson(r.data) };
const num = (v, name) => { const n = Number(v ?? 0); if (!Number.isFinite(n) || n < 0) throw bad(`${name} must be a number >= 0`); return n; };

export async function createProduction(db, actor, { name, format = 'series', budget = 0, shot_cap = 0 }) {
  need(actor, 'propose');
  if (!FORMATS.includes(format)) throw bad(`format must be one of ${FORMATS.join(', ')}`);
  const id = id8(), now = ts();
  await p(db, 'INSERT INTO productions (id,name,format,budget,shot_cap,created,updated,owner) VALUES (?,?,?,?,?,?,?,?)', id, String(name || 'Untitled').slice(0, 80), format, num(budget, 'budget'), num(shot_cap, 'shot_cap'), now, now, actor.id).run();
  return { id };
}
export async function getProduction(db, pid) {
  const r = await p(db, 'SELECT * FROM productions WHERE id=?', pid).first();
  if (!r) throw new HttpError(404, 'no such production');
  return r;
}
// A member sees only the productions they made; everyone else (admin, approver, agents) sees all.
export const listProductions = async (db, actor) => (await (actor && actor.role === 'member' ? p(db, 'SELECT id,name,format,updated FROM productions WHERE owner=? ORDER BY updated DESC', actor.id) : p(db, 'SELECT id,name,format,updated FROM productions ORDER BY updated DESC')).all()).results;
export const countOwned = async (db, actor) => (await p(db, 'SELECT COUNT(*) n FROM productions WHERE owner=?', actor.id).first()).n;
// A member may only reach their own production; to them anyone else's does not exist.
export async function ownProduction(db, actor, pid) {
  const r = await p(db, 'SELECT owner FROM productions WHERE id=?', pid).first();
  if (!r || r.owner !== actor.id) throw new HttpError(404, 'no such production');
}

const getRow = (db, pid, ref) => p(db, 'SELECT * FROM artifacts WHERE production=? AND ref=?', pid, ref).first();
async function mustGet(db, pid, ref) {
  if (!parseRef(ref)) throw bad('ref must look like <kind>:<key>');
  const r = await getRow(db, pid, ref);
  if (!r) throw new HttpError(404, `no artifact ${ref}`);
  return r;
}
export async function assetsByRef(db, pid) {
  const out = {};
  for (const x of (await p(db, 'SELECT id,ref,uri,mime,bytes,provenance,cost,author,ts FROM assets WHERE production=? ORDER BY ts', pid).all()).results) (out[x.ref] ||= []).push({ ...x, provenance: parseJson(x.provenance) });
  return out;
}
// UPDATE statement that marks everything built on ref (transitively) as stale.
const staleStmt = (db, pid, ref) => p(db, `WITH RECURSIVE d(r) AS (SELECT ref FROM deps WHERE production=? AND on_ref=? UNION SELECT deps.ref FROM deps JOIN d ON deps.on_ref=d.r WHERE deps.production=?) UPDATE artifacts SET stale=1 WHERE production=? AND ref IN (SELECT r FROM d)`, pid, ref, pid, pid);
const eventStmt = (db, pid, ref, version, action, actor, comment = '') => p(db, 'INSERT INTO events (production,ref,version,action,actor,comment,ts) VALUES (?,?,?,?,?,?,?)', pid, ref, version, action, actor.name, String(comment).slice(0, 2000), ts());

export async function listArtifacts(db, pid, { kind, status, stale, parent } = {}) {
  let sql = 'SELECT * FROM artifacts WHERE production=?'; const a = [pid];
  if (kind) { sql += ' AND kind=?'; a.push(kind); }
  if (status) { sql += ' AND status=?'; a.push(status); }
  if (parent) { sql += ' AND parent=?'; a.push(parent); }
  if (stale !== undefined && stale !== null) { sql += ' AND stale=?'; a.push(stale ? 1 : 0); }
  return (await p(db, sql + ' ORDER BY kind, ref', ...a).all()).results.map(view);
}

export async function getArtifact(db, pid, ref) {
  const r = await mustGet(db, pid, ref);
  const [versions, events, assets, deps, users] = await Promise.all([
    p(db, 'SELECT version,data,rationale,cost,author,ts FROM artifact_versions WHERE production=? AND ref=? ORDER BY version DESC', pid, ref).all(),
    p(db, 'SELECT id,version,action,actor,comment,ts FROM events WHERE production=? AND ref=? ORDER BY id DESC LIMIT 100', pid, ref).all(),
    p(db, 'SELECT id,uri,mime,bytes,provenance,cost,author,ts FROM assets WHERE production=? AND ref=? ORDER BY ts', pid, ref).all(),
    p(db, 'SELECT on_ref FROM deps WHERE production=? AND ref=?', pid, ref).all(),
    p(db, 'SELECT ref FROM deps WHERE production=? AND on_ref=?', pid, ref).all()]);
  return { ...view(r), versions: versions.results.map((v) => ({ ...v, data: parseJson(v.data) })), events: events.results, assets: assets.results.map((x) => ({ ...x, provenance: parseJson(x.provenance) })), deps: deps.results.map((x) => x.on_ref), dependents: users.results.map((x) => x.ref) };
}

// Does `target` appear among the transitive dependencies of `refs`? (cycle guard)
async function reaches(db, pid, refs, target) {
  const seen = new Set(refs); let front = [...refs];
  while (front.length) {
    if (front.includes(target)) return true;
    const next = [];
    for (const r of front) for (const x of (await p(db, 'SELECT on_ref FROM deps WHERE production=? AND ref=?', pid, r).all()).results) if (!seen.has(x.on_ref)) { seen.add(x.on_ref); next.push(x.on_ref); }
    front = next;
  }
  return false;
}

// base_version (optional): the version the caller built its change on. If someone saved in between, the write is refused instead of silently replacing theirs.
export async function propose(db, actor, pid, { ref, data, rationale = '', cost = 0, parent = null, deps = [], addresses = [], auto_approve = false, base_version }) {
  need(actor, 'propose'); await getProduction(db, pid);
  if (auto_approve) needHuman(actor, 'decide'); // a human's own edit needs no second approval
  if (!Array.isArray(addresses)) throw bad('addresses must be an array of comment ids');
  const r = parseRef(ref); if (!r) throw bad('ref must look like <kind>:<key>, with a known kind');
  const spec = KINDS[r.kind];
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad('data must be an object');
  const text = JSON.stringify(data); if (text.length > MAX_DATA) throw bad('data too large');
  if (!Array.isArray(deps)) throw bad('deps must be an array of refs');
  if (spec.parent) { const pr = parseRef(parent); if (!pr || pr.kind !== spec.parent) throw bad(`${r.kind} needs a parent of kind ${spec.parent}`); }
  else if (parent) throw bad(`${r.kind} has no parent`);
  const all = [...new Set([...(parent ? [parent] : []), ...deps])];
  if (all.includes(ref)) throw bad('an artifact cannot depend on itself');
  const notReady = [];
  for (const d of all) {
    if (!parseRef(d)) throw bad(`bad dependency ref ${d}`);
    const dr = await getRow(db, pid, d);
    if (!dr) throw new HttpError(409, `unknown dependency ${d}`);
    if (!DONE.has(dr.status)) notReady.push(`${d} (${dr.status})`);
  }
  if (notReady.length) throw new HttpError(409, `dependency not approved: ${notReady.join(', ')}`);
  for (const k of REQUIRES[r.kind] || []) if (!all.some((d) => parseRef(d).kind === k)) throw new HttpError(409, `a ${r.kind} must depend on an approved ${k}`);
  if (await reaches(db, pid, all, ref)) throw new HttpError(409, 'dependency cycle');
  const cur = await getRow(db, pid, ref);
  if (cur?.status === 'locked') throw new HttpError(409, `${ref} is locked; a human must unlock it first`);
  if (base_version !== undefined && (cur ? cur.version : 0) !== base_version) throw new HttpError(409, `${ref} changed while you were saving it. Try again.`);
  const version = cur ? cur.version + 1 : 1, now = ts(), c = num(cost, 'cost'), why = String(rationale).slice(0, 4000), status = auto_approve ? 'approved' : 'proposed';
  for (const id of addresses) if (!(await p(db, 'SELECT 1 x FROM comments WHERE production=? AND id=? AND ref=? AND parent IS NULL', pid, id, ref).first())) throw bad(`comment ${id} is not a feedback thread on ${ref}`);
  const stmts = [
    p(db, `INSERT INTO artifacts (production,ref,kind,parent,version,status,stale,data,rationale,cost,author,created,updated) VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?)
      ON CONFLICT(production,ref) DO UPDATE SET parent=excluded.parent,version=excluded.version,status=excluded.status,stale=0,data=excluded.data,rationale=excluded.rationale,cost=excluded.cost,author=excluded.author,updated=excluded.updated`,
      pid, ref, r.kind, parent, version, status, text, why, c, actor.name, now, now),
    p(db, 'INSERT INTO artifact_versions VALUES (?,?,?,?,?,?,?,?)', pid, ref, version, text, why, c, actor.name, now),
    p(db, 'DELETE FROM deps WHERE production=? AND ref=?', pid, ref),
    ...all.map((d) => p(db, 'INSERT INTO deps VALUES (?,?,?)', pid, ref, d)),
    eventStmt(db, pid, ref, version, 'propose', actor, why),
    p(db, 'UPDATE productions SET updated=? WHERE id=?', now, pid)];
  if (r.kind === 'stage') for (const sh of Object.keys(data.shots || {})) if (parseRef(sh)?.kind === 'shot' && (await getRow(db, pid, sh))) stmts.push(p(db, 'INSERT OR IGNORE INTO deps VALUES (?,?,?)', pid, sh, ref)); // what is built on this layout goes stale when it changes
  if (cur) stmts.push(staleStmt(db, pid, ref));
  for (const id of addresses) stmts.push(p(db, "UPDATE comments SET status='addressed',addressed_in=?,updated=? WHERE production=? AND id=?", version, now, pid, id), eventStmt(db, pid, ref, version, 'addressed', actor, id));
  if (auto_approve) stmts.push(eventStmt(db, pid, ref, version, 'approve', actor, 'own edit'), resolveAddressed(db, pid, ref));
  try { await db.batch(stmts); } catch (e) { if (/UNIQUE constraint/.test(String(e.message))) throw new HttpError(409, `${ref} changed while you were saving it. Try again.`); throw e; } // two writers read the same version
  return { ref, version, status };
}

// Approving a version closes the feedback threads it was written to address.
const resolveAddressed = (db, pid, ref) => p(db, "UPDATE comments SET status='resolved',updated=? WHERE production=? AND ref=? AND parent IS NULL AND status='addressed'", ts(), pid, ref);
const ACTIONS = { approve: 'approved', request_changes: 'changes_requested', reject: 'rejected' };
export async function decide(db, actor, pid, { ref, action, comment = '', version }) {
  needHuman(actor, 'decide');
  const cur = await mustGet(db, pid, ref);
  if (action === 'keep') { // a human confirms a stale artifact is still valid
    if (!cur.stale) throw new HttpError(409, `${ref} is not stale`);
    await db.batch([p(db, 'UPDATE artifacts SET stale=0,updated=? WHERE production=? AND ref=?', ts(), pid, ref), eventStmt(db, pid, ref, cur.version, 'keep', actor, comment)]);
    return { ref, status: cur.status };
  }
  if (!ACTIONS[action]) throw bad('action must be approve, request_changes, reject or keep');
  if (cur.status !== 'proposed') throw new HttpError(409, `${ref} is ${cur.status}, not proposed`);
  if (version !== undefined && version !== cur.version) throw new HttpError(409, `${ref} is at version ${cur.version}, not ${version}`);
  if (action !== 'approve' && !String(comment).trim()) throw bad(`${action} needs a comment so the agent knows what to fix`);
  if (action === 'approve') {
    const bad2 = [];
    for (const x of (await p(db, 'SELECT d.on_ref, a.status FROM deps d JOIN artifacts a ON a.production=d.production AND a.ref=d.on_ref WHERE d.production=? AND d.ref=?', pid, ref).all()).results) if (!DONE.has(x.status)) bad2.push(x.on_ref);
    if (bad2.length) throw new HttpError(409, `dependency no longer approved: ${bad2.join(', ')}`);
  }
  const stmts = [p(db, 'UPDATE artifacts SET status=?,updated=? WHERE production=? AND ref=?', ACTIONS[action], ts(), pid, ref), eventStmt(db, pid, ref, cur.version, action, actor, comment)];
  if (action === 'approve') stmts.push(resolveAddressed(db, pid, ref));
  if (action === 'reject') stmts.push(staleStmt(db, pid, ref));
  await db.batch(stmts);
  return { ref, status: ACTIONS[action] };
}

export async function setLock(db, actor, pid, { ref, lock }) {
  needHuman(actor, 'decide');
  const cur = await mustGet(db, pid, ref);
  if (lock) {
    if (cur.status !== 'approved') throw new HttpError(409, `only approved artifacts can be locked (${ref} is ${cur.status})`);
    await db.batch([p(db, "UPDATE artifacts SET status='locked',updated=? WHERE production=? AND ref=?", ts(), pid, ref), eventStmt(db, pid, ref, cur.version, 'lock', actor)]);
    return { ref, status: 'locked' };
  }
  if (cur.status !== 'locked') throw new HttpError(409, `${ref} is not locked`);
  await db.batch([p(db, "UPDATE artifacts SET status='approved',updated=? WHERE production=? AND ref=?", ts(), pid, ref), eventStmt(db, pid, ref, cur.version, 'unlock', actor), staleStmt(db, pid, ref)]);
  return { ref, status: 'approved' };
}

async function dependentCounts(db, pid) {
  const o = {};
  for (const x of (await p(db, 'SELECT on_ref, COUNT(*) n FROM deps WHERE production=? GROUP BY on_ref', pid).all()).results) o[x.on_ref] = x.n;
  return o;
}
// What a human should look at: stale work first (it is already built), then earliest pipeline stage, since approving upstream unblocks the rest.
export async function queue(db, pid) {
  const [rows, dc] = await Promise.all([p(db, "SELECT * FROM artifacts WHERE production=? AND (status='proposed' OR stale=1) ORDER BY updated", pid).all(), dependentCounts(db, pid)]);
  return rows.results.map((r) => ({ ref: r.ref, kind: r.kind, version: r.version, status: r.status, stale: !!r.stale, cost: r.cost, author: r.author, rationale: r.rationale, dependents: dc[r.ref] || 0, updated: r.updated }))
    .sort((a, b) => b.stale - a.stale || PIPELINE.indexOf(a.kind) - PIPELINE.indexOf(b.kind) || b.dependents - a.dependents || b.cost - a.cost);
}

// What an agent should do next: fix what was sent back, refresh what went stale, then the next gap in the pipeline.
export async function nextWork(db, pid) {
  const work = [];
  for (const c of (await p(db, "SELECT c.*, a.version cur FROM comments c JOIN artifacts a ON a.production=c.production AND a.ref=c.ref WHERE c.production=? AND c.parent IS NULL AND c.status='open' AND c.author_kind='human' ORDER BY c.created LIMIT 100", pid).all()).results) {
    const replies = (await p(db, 'SELECT author,body FROM comments WHERE production=? AND parent=? ORDER BY created', pid, c.id).all()).results;
    work.push({ type: 'feedback', comment_id: c.id, ref: c.ref, version: c.cur, context: c.context, anchor: c.anchor, verdict: c.verdict, body: c.body, attachment: c.attachment, by: c.author, thread: replies, hint: 'revise the artifact and propose it with addresses:[comment_id], or reply explaining why not' });
  }
  const back = (await p(db, "SELECT * FROM artifacts WHERE production=? AND status IN ('changes_requested','rejected') ORDER BY updated", pid).all()).results;
  for (const r of back) {
    const e = await p(db, "SELECT comment,actor FROM events WHERE production=? AND ref=? AND action IN ('request_changes','reject') ORDER BY id DESC LIMIT 1", pid, r.ref).first();
    work.push({ type: r.status === 'rejected' ? 'rejected' : 'changes_requested', ref: r.ref, version: r.version, comment: e?.comment || '', by: e?.actor || '' });
  }
  for (const r of (await p(db, "SELECT ref,version FROM artifacts WHERE production=? AND stale=1 AND status NOT IN ('changes_requested','rejected') ORDER BY updated", pid).all()).results) work.push({ type: 'stale', ref: r.ref, version: r.version, hint: 'something it was built on changed: re-propose it, or ask a human to keep it' });
  const have = new Set((await p(db, 'SELECT DISTINCT kind FROM artifacts WHERE production=?', pid).all()).results.map((x) => x.kind));
  const gap = PIPELINE.find((k) => !have.has(k));
  if (gap) work.push({ type: 'gap', kind: gap, hint: `no ${gap} artifact exists yet` });
  const waiting = (await p(db, "SELECT COUNT(*) n FROM artifacts WHERE production=? AND status='proposed'", pid).first()).n;
  return { work, waiting_on_human: waiting };
}

const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (['negative', 'avoid', 'forbidden'].includes(k) ? undefined : v)));
// Cheap deterministic continuity check: forbidden terms from canon, staleness, unapproved dependencies.
export async function checkContinuity(db, pid, ref) {
  const canon = (await p(db, "SELECT data FROM artifacts WHERE production=? AND kind IN ('canon.world','canon.style') AND status IN ('approved','locked')", pid).all()).results;
  const forbidden = [...new Set(canon.flatMap((c) => (parseJson(c.data).forbidden || []).map((t) => String(t).toLowerCase())))];
  const rows = ref ? [await mustGet(db, pid, ref)] : (await p(db, "SELECT * FROM artifacts WHERE production=? AND status!='rejected'", pid).all()).results;
  const issues = [];
  for (const r of rows) {
    if (isCanon(r.kind)) continue;
    const text = JSON.stringify(strip(parseJson(r.data))).toLowerCase();
    for (const t of forbidden) if (t && text.includes(t)) issues.push({ ref: r.ref, type: 'forbidden', term: t });
    if (r.stale) issues.push({ ref: r.ref, type: 'stale' });
    for (const d of (await p(db, 'SELECT d.on_ref, a.status FROM deps d JOIN artifacts a ON a.production=d.production AND a.ref=d.on_ref WHERE d.production=? AND d.ref=?', pid, r.ref).all()).results) if (!DONE.has(d.status)) issues.push({ ref: r.ref, type: 'dependency_not_approved', on: d.on_ref });
  }
  return { ok: !issues.length, checked: rows.length, forbidden_terms: forbidden.length, issues };
}

// ---- money ----
export async function budgetStatus(db, pid) {
  const pr = await getProduction(db, pid);
  const [tot, by] = await Promise.all([p(db, 'SELECT COALESCE(SUM(credits),0) s FROM ledger WHERE production=?', pid).first(), p(db, 'SELECT scope, SUM(credits) s FROM ledger WHERE production=? GROUP BY scope', pid).all()]);
  return { budget: pr.budget, shot_cap: pr.shot_cap, spent: tot.s, remaining: pr.budget - tot.s, by_scope: Object.fromEntries(by.results.map((x) => [x.scope, x.s])) };
}
export async function grantBudget(db, actor, pid, { add = 0, shot_cap }) {
  needHuman(actor, 'budget'); const pr = await getProduction(db, pid);
  const stmts = [p(db, 'UPDATE productions SET budget=budget+?, updated=? WHERE id=?', num(add, 'add'), ts(), pid), ...(String(pr.owner || '').startsWith('u:') && num(add, 'add') > 0 ? [p(db, 'UPDATE users SET credits=credits+? WHERE id=?', num(add, 'add'), pr.owner.slice(2))] : []), eventStmt(db, pid, null, null, 'budget_grant', actor, `+${add}${shot_cap !== undefined ? `, shot_cap ${shot_cap}` : ''}`)];
  if (shot_cap !== undefined) stmts.push(p(db, 'UPDATE productions SET shot_cap=? WHERE id=?', num(shot_cap, 'shot_cap'), pid));
  await db.batch(stmts);
  return budgetStatus(db, pid);
}
export async function requestBudget(db, actor, pid, { amount, reason = '' }) {
  need(actor, 'request_budget'); await getProduction(db, pid);
  await eventStmt(db, pid, null, null, 'budget_request', actor, `${num(amount, 'amount')} credits: ${reason}`).run();
  return { requested: Number(amount) };
}
async function scopeOf(db, pid, ref) {
  const r = await mustGet(db, pid, ref);
  return r.kind === 'shot' ? ref : (r.parent && parseRef(r.parent)?.kind === 'shot' ? r.parent : ref);
}
// Atomic: the row is only inserted if it fits the production budget, the per-shot cap and, for a signed-up person, the allowance of the whole account.
export async function charge(db, actor, pid, { ref, tool, credits }) {
  if (!credits) return 0;
  const scope = await scopeOf(db, pid, ref), now = ts();
  const r = await p(db, `INSERT INTO ledger (production,ref,scope,tool,credits,actor,ts) SELECT ?,?,?,?,?,?,? WHERE
    (SELECT COALESCE(SUM(credits),0) FROM ledger WHERE production=?)+? <= (SELECT budget FROM productions WHERE id=?)
    AND ((SELECT shot_cap FROM productions WHERE id=?)=0 OR (SELECT COALESCE(SUM(credits),0) FROM ledger WHERE production=? AND scope=?)+? <= (SELECT shot_cap FROM productions WHERE id=?))
    AND (COALESCE((SELECT owner FROM productions WHERE id=?),'') NOT LIKE 'u:%' OR (SELECT COALESCE(SUM(l.credits),0) FROM ledger l JOIN productions q ON q.id=l.production WHERE q.owner=(SELECT owner FROM productions WHERE id=?))+? <= COALESCE((SELECT u.credits FROM users u WHERE u.role='member' AND 'u:'||u.id=(SELECT owner FROM productions WHERE id=?)), 1e18))`,
    pid, ref, scope, tool, credits, actor.name, now, pid, credits, pid, pid, pid, scope, credits, pid, pid, pid, credits, pid).run();
  if (!r.meta.changes) throw new HttpError(402, `over budget for ${scope}: ask a human via request_budget`);
  return credits;
}
export const refund = (db, actor, pid, { ref, tool, credits }) => scopeOf(db, pid, ref).then((scope) => p(db, 'INSERT INTO ledger (production,ref,scope,tool,credits,actor,ts) VALUES (?,?,?,?,?,?,?)', pid, ref, scope, `${tool}:refund`, -credits, actor.name, ts()).run());

const URI_RE = /^(https:\/\/|mock:\/\/|media\/|audio\/)/;
// Store an asset row. Paid work done outside the studio is charged here; tool calls charge before running and pass charged:true.
export async function attachAsset(db, actor, pid, { ref, uri, mime = '', bytes = 0, provenance = {}, cost = 0 }, { charged = false } = {}) {
  need(actor, 'propose'); await mustGet(db, pid, ref);
  if (typeof uri !== 'string' || !URI_RE.test(uri) || uri.length > 2000) throw bad('uri must start with https://, media/, audio/ or mock://');
  const c = num(cost, 'cost');
  if (!charged) await charge(db, actor, pid, { ref, tool: provenance.tool || 'external', credits: c });
  const id = id8();
  await db.batch([p(db, 'INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?)', id, pid, ref, uri, String(mime).slice(0, 100), num(bytes, 'bytes'), JSON.stringify(provenance).slice(0, 20000), c, actor.name, ts()), eventStmt(db, pid, ref, null, 'attach_asset', actor, uri)]);
  return { id, uri };
}
export const assertArtifact = mustGet;

export async function events(db, pid, since = 0, tail = false) {
  if (tail) return (await p(db, 'SELECT id,ref,version,action,actor,comment,ts FROM events WHERE production=? ORDER BY id DESC LIMIT 400', pid).all()).results.reverse();
  return (await p(db, 'SELECT id,ref,version,action,actor,comment,ts FROM events WHERE production=? AND id>? ORDER BY id LIMIT 500', pid, Number(since) || 0).all()).results;
}
export const logEvent = (db, pid, ref, action, actor, comment) => eventStmt(db, pid, ref, null, action, actor, comment).run();

// ---- feedback: threads on any artifact. Humans open them, the agent replies and revises, approving the revision closes them. ----
const ATTACH_RE = /^media\/[A-Za-z0-9]+\/[A-Za-z0-9._-]+$/;
export async function addComment(db, actor, pid, { ref, body = '', anchor = null, context = null, verdict = null, parent = null, addressed = false, attachment = null }) {
  need(actor, 'comment');
  const art = await mustGet(db, pid, ref), text = String(body).trim();
  if (verdict && !VERDICTS.includes(verdict)) throw bad(`verdict must be one of ${VERDICTS.join(', ')}`);
  if (!text && !verdict && !attachment) throw bad('a comment needs text, a verdict or a drawing');
  if (NEEDS_NOTE.includes(verdict) && !text) throw bad(`a ${verdict} flag needs a note saying what is wrong`);
  if (attachment && !ATTACH_RE.test(attachment)) throw bad('attachment must be a file stored in this studio (media/...)');
  if (text.length > 4000) throw bad('comment too long (4000 characters max)');
  let root = null;
  if (parent) {
    const pr = await p(db, 'SELECT * FROM comments WHERE production=? AND id=?', pid, parent).first();
    if (!pr || pr.ref !== ref) throw new HttpError(404, 'no such thread on this artifact');
    root = pr.parent || pr.id;
  }
  const id = id8(), now = ts(), stmts = [p(db, 'INSERT INTO comments (id,production,ref,version,context,anchor,verdict,body,author,author_kind,parent,status,addressed_in,created,updated,attachment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, pid, ref, art.version, context && String(context).slice(0, 80), anchor && String(anchor).slice(0, 120), verdict, text, actor.name, actor.kind, root, root ? 'reply' : 'open', null, now, now, attachment), eventStmt(db, pid, ref, art.version, root ? 'reply' : 'comment', actor, text || verdict)];
  if (root && actor.kind === 'human') stmts.push(p(db, "UPDATE comments SET status='open',updated=? WHERE production=? AND id=? AND status!='open'", now, pid, root)); // a human answer reopens the thread
  if (root && addressed && actor.kind === 'ai') stmts.push(p(db, "UPDATE comments SET status='addressed',addressed_in=?,updated=? WHERE production=? AND id=?", art.version, now, pid, root));
  await db.batch(stmts);
  return { id };
}
export async function listComments(db, pid, { ref, status } = {}) {
  let sql = 'SELECT * FROM comments WHERE production=?'; const a = [pid];
  if (ref) { sql += ' AND ref=?'; a.push(ref); }
  const rows = (await p(db, sql + ' ORDER BY created', ...a).all()).results, replies = {};
  rows.filter((r) => r.parent).forEach((r) => (replies[r.parent] ||= []).push(r));
  return rows.filter((r) => !r.parent && (!status || r.status === status)).map((r) => ({ ...r, replies: replies[r.id] || [] })).reverse();
}
export async function resolveComment(db, actor, pid, id, resolved) {
  needHuman(actor, 'decide');
  const c = await p(db, 'SELECT * FROM comments WHERE production=? AND id=? AND parent IS NULL', pid, id).first();
  if (!c) throw new HttpError(404, 'no such thread');
  await db.batch([p(db, 'UPDATE comments SET status=?,updated=? WHERE production=? AND id=?', resolved ? 'resolved' : 'open', ts(), pid, id), eventStmt(db, pid, c.ref, null, resolved ? 'resolve' : 'reopen', actor, id)]);
  return { id, status: resolved ? 'resolved' : 'open' };
}

// ---- presence and backup ----
// One cheap call per open page every few seconds: who is here, and the id of the latest event so the page knows when to reload.
export async function pulse(db, actor, pid) {
  await getProduction(db, pid);
  const now = ts();
  await p(db, 'INSERT INTO presence VALUES (?,?,?) ON CONFLICT(project,who) DO UPDATE SET ts=excluded.ts', pid, actor.name, now).run();
  const [here, last] = await Promise.all([p(db, 'SELECT who FROM presence WHERE project=? AND ts>? ORDER BY who', pid, now - 30000).all(), p(db, 'SELECT id,actor,ts FROM events WHERE production=? ORDER BY id DESC LIMIT 1', pid).first()]);
  return { here: here.results.map((r) => r.who), last_event: last ? last.id : 0, last_actor: last ? last.actor : null, last_ts: last ? last.ts : null };
}
export async function backup(db, pid) {
  const production = await getProduction(db, pid);
  const [arts, vers, deps, assets, comments, events, ledger] = await Promise.all(['artifacts', 'artifact_versions', 'deps', 'assets', 'comments', 'events', 'ledger'].map((t) => p(db, `SELECT * FROM ${t} WHERE ${t === 'events' || t === 'artifacts' || t === 'artifact_versions' || t === 'deps' || t === 'assets' || t === 'comments' || t === 'ledger' ? 'production' : 'id'}=?`, pid).all().then((r) => r.results)));
  return { schema: 'monofilm/backup@1', saved: new Date().toISOString(), production, artifacts: arts, versions: vers, deps, assets, comments, events, ledger, note: 'Media files are in R2 under media/<production>/ and are not included here.' };
}

// ---- restore: replay a backup file into a new production ----
const COLS = { artifacts: ['ref', 'kind', 'parent', 'version', 'status', 'stale', 'data', 'rationale', 'cost', 'author', 'created', 'updated'], artifact_versions: ['ref', 'version', 'data', 'rationale', 'cost', 'author', 'ts'], deps: ['ref', 'on_ref'], assets: ['ref', 'uri', 'mime', 'bytes', 'provenance', 'cost', 'author', 'ts'], events: ['ref', 'version', 'action', 'actor', 'comment', 'ts'], ledger: ['ref', 'scope', 'tool', 'credits', 'actor', 'ts'] };
export async function restoreBackup(db, actor, b) {
  needHuman(actor, 'decide');
  if (!b || b.schema !== 'monofilm/backup@1' || !b.production || !Array.isArray(b.artifacts)) throw bad('not a Monofilm backup file');
  const id = id8(), now = ts(), stmts = [p(db, 'INSERT INTO productions (id,name,format,budget,shot_cap,created,updated,owner) VALUES (?,?,?,?,?,?,?,?)', id, `${b.production.name} (restored)`.slice(0, 80), b.production.format, num(b.production.budget, 'budget'), num(b.production.shot_cap, 'shot_cap'), now, now, actor.id)];
  const put = (table, row, extra = {}) => { const cols = COLS[table], names = ['production', ...cols, ...Object.keys(extra)]; stmts.push(p(db, `INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`, id, ...cols.map((c) => row[c] ?? null), ...Object.values(extra))); };
  for (const r of b.artifacts) put('artifacts', r);
  for (const r of b.versions || []) put('artifact_versions', r);
  for (const r of b.deps || []) put('deps', r);
  for (const r of b.assets || []) put('assets', r, { id: id8() });
  for (const r of b.ledger || []) put('ledger', r);
  for (const r of b.events || []) put('events', r);
  const cid = Object.fromEntries((b.comments || []).map((c) => [c.id, id8()]));
  for (const c of b.comments || []) stmts.push(p(db, 'INSERT INTO comments (id,production,ref,version,context,anchor,verdict,body,author,author_kind,parent,status,addressed_in,created,updated,attachment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', cid[c.id], id, c.ref, c.version, c.context, c.anchor, c.verdict, c.body, c.author, c.author_kind, c.parent ? cid[c.parent] || null : null, c.status, c.addressed_in, c.created, c.updated, c.attachment));
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90)); // D1 limits a batch, so write in slices
  return { id, artifacts: b.artifacts.length, comments: (b.comments || []).length, assets: (b.assets || []).length, note: 'Files stay under the original production in storage and are still reachable.' };
}
