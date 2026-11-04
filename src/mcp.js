// The studio as an MCP server (streamable HTTP, stateless JSON-RPC). An agent connects with its actor token and works the production.
import { HttpError, json, parseJson } from './util.js';
import * as S from './store.js';
import { listTools, callTool } from './tools.js';
import { isCanon } from './kinds.js';
import { checkCut } from '../public/js/checks.js';
import { loadStage, validateStage, stageInput } from './stage.js';
import { composePrompt } from '../public/js/stage-math.js';
import { checkAdherence } from './adherence.js';
import { VIDEO_TOOLS } from './mcp-video.js';

const str = { type: 'string' }, obj = { type: 'object' };
const prod = { production: { ...str, description: 'production id' } };
const T = (name, description, props, required, run) => ({ name, description, inputSchema: { type: 'object', properties: props, required }, run });

export const TOOLS = [
  T('list_productions', 'List productions you can work on.', {}, [], (c) => S.listProductions(c.db, c.actor)),
  T('next_work', 'What to do next: items a human sent back, stale items, then the next missing pipeline stage. Start here.', prod, ['production'], (c, a) => S.nextWork(c.db, a.production)),
  T('get_canon', 'Approved logline, bible and canon (style, world, cast, voice). Everything you create must match it.', prod, ['production'], async (c, a) =>
    (await S.listArtifacts(c.db, a.production)).filter((x) => (isCanon(x.kind) || ['logline', 'bible', 'reference'].includes(x.kind)) && ['approved', 'locked'].includes(x.status)).map((x) => ({ ref: x.ref, status: x.status, data: x.data }))),
  T('list_artifacts', 'List artifacts, optionally by kind, status or parent ref.', { ...prod, kind: str, status: str, parent: str }, ['production'], (c, a) => S.listArtifacts(c.db, a.production, a).then((l) => l.map(({ data, ...r }) => r))),
  T('get_artifact', 'One artifact with its data, versions, assets, deps, dependents and review comments.', { ...prod, ref: str }, ['production', 'ref'], (c, a) => S.getArtifact(c.db, a.production, a.ref)),
  T('propose', 'Create or revise an artifact for human review. ref is "<kind>:<key>". Dependencies and parent must already be approved. Say why in rationale and give a cost estimate in credits.',
    { ...prod, ref: str, data: obj, rationale: str, cost: { type: 'number' }, parent: str, deps: { type: 'array', items: str }, addresses: { type: 'array', items: str, description: 'ids of human feedback threads this revision answers; they move to addressed, and approval closes them' } }, ['production', 'ref', 'data'], (c, a) => S.propose(c.db, c.actor, a.production, a)),
  T('get_feedback', 'Human feedback threads (comments with optional verdict keep/change/cut/question). Filter by ref or status (open, addressed, resolved). Read before revising.', { ...prod, ref: str, status: str }, ['production'], (c, a) => S.listComments(c.db, a.production, a)),
  T('comment', 'Add a comment or reply on an artifact: answer a feedback thread (parent = its id; addressed:true when you changed nothing and explain why), or raise a question for the human.', { ...prod, ref: str, body: str, parent: str, anchor: str, addressed: { type: 'boolean' } }, ['production', 'ref', 'body'], (c, a) => S.addComment(c.db, c.actor, a.production, a)),
  T('changes', 'Everything that happened since an event id (human edits, approvals, comments). Use the last id you saw.', { ...prod, since: { type: 'number' } }, ['production'], (c, a) => S.events(c.db, a.production, a.since)),
  T('attach_asset', 'Attach a produced file (https://, media/, audio/ or mock:// uri) to an artifact. Paid work done outside the studio is charged to the budget.',
    { ...prod, ref: str, uri: str, mime: str, bytes: { type: 'number' }, cost: { type: 'number' }, provenance: obj }, ['production', 'ref', 'uri'], (c, a) => S.attachAsset(c.db, c.actor, a.production, a)),
  T('check_continuity', 'Check one artifact (or all) against canon: forbidden terms, stale items, unapproved dependencies.', { ...prod, ref: str }, ['production'], (c, a) => S.checkContinuity(c.db, a.production, a.ref)),
  T('check_cut', 'Run the editorial checks on a storyline: runtime vs target, hook, title card, fiction label, spoilers, speech overrun, missing images or clips, new lines to voice, unsettled shots. The human sees the same list.', { ...prod, cut: { ...str, description: 'cut ref, e.g. cut:morteza' } }, ['production', 'cut'], async (c, a) => {
    const all = await S.listArtifacts(c.db, a.production), by = Object.fromEntries(all.map((x) => [x.ref, x])), cut = by[a.cut];
    if (!cut || cut.kind !== 'cut') throw new HttpError(404, `no cut ${a.cut}`);
    const assets = await S.assetsByRef(c.db, a.production), kids = (id) => all.filter((x) => x.kind === 'dialogue' && x.parent === `shot:${id}`).map((x) => x.data);
    return checkCut(cut.data, { shot: (i) => by[`shot:${i}`]?.data || null, lines: kids, hasImage: (i) => !!(assets[`keyframe:${i}`] || []).length, hasClip: (i) => !!(assets[`take:${i}`] || []).length, state: (i) => (by[`shot:${i}`] ? { status: by[`shot:${i}`].status, stale: by[`shot:${i}`].stale } : null), bible: by['bible:main']?.data, style: by['canon.style:look']?.data });
  }),
  T('get_stage', 'The staged scene: objects, characters, cameras, the files rendered from it, and the layout written as a prompt for each shot. Build from this, not from guesses.', { ...prod, ref: { ...str, description: 'e.g. stage:hook' } }, ['production', 'ref'], async (c, a) => {
    const { artifact, stage, assets, style } = await loadStage(c.db, a.production, a.ref);
    return { ref: a.ref, version: artifact.version, status: artifact.status, stage, assets, prompts: Object.fromEntries(Object.keys(stage.shots || {}).map((s) => [s, composePrompt(stage, s, style)])) };
  }),
  T('check_stage', 'Check a stage: everyone in frame, must-keep objects visible, no camera inside an object, anchors present, cast links valid.', { ...prod, ref: str }, ['production', 'ref'], (c, a) => validateStage(c.db, a.production, a.ref)),
  T('check_adherence', 'Measure whether a generated picture followed the stage. SAM 3.1 finds each person and object and the result says how far each is from its planned place. Use it after generating a keyframe, then fix what drifted.', { ...prod, stage: str, shot: str, uri: { ...str, description: 'media/... uri of the picture' } }, ['production', 'stage', 'shot', 'uri'], (c, a) => checkAdherence(c.env, c.db, a.production, a, c.fetch)),
  T('stage_input', 'The exact input for one generator call: the control images and camera path the tool accepts, plus words for what it cannot take. Pass tool to use its declared accepts. call_tool also accepts input.stage = {ref, shot} and expands it the same way.', { ...prod, ref: str, shot: str, tool: str }, ['production', 'ref', 'shot'], async (c, a) => {
    const t = a.tool ? await c.db.prepare('SELECT target FROM tools WHERE name=?').bind(a.tool).first() : null;
    return stageInput(c.db, a.production, { ref: a.ref, shot: a.shot, accepts: t ? (JSON.parse(t.target).accepts || undefined) : undefined });
  }),
  T('budget_status', 'Credits budget, spent, remaining and spend per shot.', prod, ['production'], (c, a) => S.budgetStatus(c.db, a.production)),
  T('request_budget', 'Ask the human for more credits, with a reason.', { ...prod, amount: { type: 'number' }, reason: str }, ['production', 'amount'], (c, a) => S.requestBudget(c.db, c.actor, a.production, a)),
  T('list_tools', 'Registered generation tools (image, video, voice, lipsync, music, sfx, edit, render) with their cost model.', {}, [], (c) => listTools(c.db)),
  T('call_tool', 'Run a generation tool for an artifact. The estimated cost is checked against the budget first; the output is stored as an asset.',
    { ...prod, tool: str, ref: str, input: obj }, ['production', 'tool', 'ref'], (c, a) => callTool(c.db, c.env, c.actor, a.production, a, c.fetch)),
];
TOOLS.push(...VIDEO_TOOLS); // the tools for a video generation model, after the studio's own

const rpcOk = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id', 'access-control-max-age': '86400' };
const reply = (body, status = 200, extra = {}) => { const r = json(body, status); for (const [k, v] of Object.entries({ ...CORS, ...extra })) r.headers.set(k, v); return r; };

// What a client needs before it can connect: answer the browser preflight, and say how to sign in when there is no valid token.
export const mcpPreflight = () => new Response(null, { status: 204, headers: CORS });
export const mcpUnauthorized = () => reply(rpcErr(null, -32001, 'A bearer token is required. Send "Authorization: Bearer <token>" with an actor token from the studio.'), 401, { 'www-authenticate': 'Bearer realm="monofilm"' });

async function one(msg, ctx) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcErr(msg && msg.id !== undefined ? msg.id : null, -32600, 'invalid request');
  if (msg.id === undefined || msg.id === null) return null; // notification: no answer
  switch (msg.method) {
    case 'initialize': { const want = msg.params && msg.params.protocolVersion; return rpcOk(msg.id, { protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'monofilm', version: '1' },
      instructions: 'Call next_work first: it lists human feedback (type feedback), things sent back, stale work, then the next gap. Read get_canon before proposing. For feedback, revise the artifact and propose it with addresses:[comment_id], or reply with comment explaining why not; the human sees a before/after diff and approving closes the thread. Humans also edit cuts, shots, canon and the grade themselves (see changes); work from their version. Feedback may carry a drawing (attachment, a file in media/) and framing numbers in its body; read both. Verdicts continuity and anachronism are risk flags with a reason; anchor img:<id> says which image, fails:<list> what looks wrong. Run check_cut on a storyline before proposing changes to it. Propose artifacts for human approval; never assume approval. If you make video: list_clips, then get_clip for the prompt, start and end pictures and references (fetch urls with this same bearer token, or get_media for a picture), make the clip, then submit_take; the human reviews it and picks the take.' }); }
    case 'ping': return rpcOk(msg.id, {});
    case 'tools/list': return rpcOk(msg.id, { tools: TOOLS.map(({ run, ...t }) => t) });
    case 'resources/list': return rpcOk(msg.id, { resources: [] });
    case 'resources/templates/list': return rpcOk(msg.id, { resourceTemplates: [] });
    case 'prompts/list': return rpcOk(msg.id, { prompts: [] });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === (msg.params && msg.params.name));
      if (!tool) return rpcErr(msg.id, -32602, `unknown tool ${msg.params && msg.params.name}`);
      const args = (msg.params && msg.params.arguments) || {}, missing = (tool.inputSchema.required || []).filter((k) => args[k] === undefined || args[k] === null || args[k] === '');
      if (missing.length) return rpcOk(msg.id, { isError: true, content: [{ type: 'text', text: `missing ${missing.join(', ')}` }] });
      try {
        const out = await tool.run(ctx, args);
        if (out && Array.isArray(out.__content)) return rpcOk(msg.id, { content: out.__content });
        return rpcOk(msg.id, { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: Array.isArray(out) ? { items: out } : out });
      } catch (e) {
        if (!(e instanceof HttpError)) console.error(e);
        return rpcOk(msg.id, { isError: true, content: [{ type: 'text', text: e instanceof HttpError ? `${e.status}: ${e.message}` : 'internal error' }] });
      }
    }
    default: return rpcErr(msg.id, -32601, `method not found: ${msg.method}`);
  }
}

export async function handleMcp(req, env, actor, fetchImpl = fetch) {
  if (req.method === 'OPTIONS') return mcpPreflight();
  if (req.method !== 'POST') return new Response('POST JSON-RPC to /mcp', { status: 405, headers: { allow: 'POST, OPTIONS', ...CORS } });
  const msg = parseJson(await req.text(), undefined);
  if (msg === undefined || msg === null || typeof msg !== 'object') return reply(rpcErr(null, -32700, 'parse error: send one JSON-RPC message or a batch'), 400);
  const ctx = { db: env.DB, env, actor, fetch: fetchImpl, origin: new URL(req.url).origin };
  if (Array.isArray(msg)) {
    if (!msg.length) return reply(rpcErr(null, -32600, 'empty batch'), 400);
    const out = (await Promise.all(msg.map((m) => one(m, ctx)))).filter(Boolean);
    return out.length ? reply(out) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await one(msg, ctx);
  return out ? reply(out, out.error && out.error.code === -32600 ? 400 : 200) : new Response(null, { status: 202, headers: CORS });
}
