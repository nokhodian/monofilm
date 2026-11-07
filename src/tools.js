// Tool registry: one contract for every generator (image, video, voice, lipsync, music, sfx, edit, render), reached over http, mcp or mock.
// A call is budget-checked first, refunded if the provider fails, and its output is stored as an asset with provenance.
import { HttpError, bad, parseJson, sha256hex } from './util.js';
import { TOOL_KINDS, TRANSPORTS, can } from './kinds.js';
import { attachAsset, assertArtifact, charge, refund, logEvent } from './store.js';
import { stageInput, ACCEPTS } from './stage.js';
import { museImage, dataUrl, modelOf } from './meta.js';
import { frame } from '../public/js/stage-math.js';
import { id8 } from './util.js';

export async function registerTool(db, { name, kind, transport, target = {}, cost_model = {}, enabled = true }) {
  if (!/^[a-z0-9._-]{1,40}$/i.test(name || '')) throw bad('tool name: letters, digits . _ - (max 40)');
  if (!TOOL_KINDS.includes(kind)) throw bad(`kind must be one of ${TOOL_KINDS.join(', ')}`);
  if (!TRANSPORTS.includes(transport)) throw bad(`transport must be one of ${TRANSPORTS.join(', ')}`);
  if (!['mock', 'meta-image'].includes(transport)) {
    if (!/^https:\/\//.test(target.url || '')) throw bad('target.url must be an https:// URL');
    if (transport === 'mcp' && !target.tool) throw bad('mcp tools need target.tool (the remote tool name)');
  }
  if (target.accepts && (!Array.isArray(target.accepts) || target.accepts.some((a) => !ACCEPTS.includes(a)))) throw bad(`target.accepts must be a list drawn from ${ACCEPTS.join(', ')}`);
  await db.prepare('INSERT INTO tools VALUES (?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET kind=excluded.kind,transport=excluded.transport,target=excluded.target,cost_model=excluded.cost_model,enabled=excluded.enabled')
    .bind(name, kind, transport, JSON.stringify(target), JSON.stringify(cost_model), enabled ? 1 : 0).run();
  return { name };
}
// Never return target.auth_env's value, only that one is configured.
export const listTools = async (db) => (await db.prepare('SELECT * FROM tools ORDER BY kind,name').all()).results.map((t) => ({ name: t.name, kind: t.kind, transport: t.transport, cost_model: parseJson(t.cost_model), accepts: parseJson(t.target).accepts || [], enabled: !!t.enabled }));

const MIME = { image: 'image/png', video: 'video/mp4', voice: 'audio/mpeg', lipsync: 'video/mp4', music: 'audio/mpeg', sfx: 'audio/mpeg', edit: 'application/json', render: 'video/mp4' };
const estimate = (cm, input) => (Number(cm.per_call) || 0) + (Number(cm.per_second) || 0) * (Number(input.seconds) || 0);

async function mock(tool, input) {
  return { uri: `mock://${tool.kind}/${(await sha256hex(tool.name + JSON.stringify(input))).slice(0, 12)}`, mime: MIME[tool.kind], meta: { mock: true } };
}
// Muse Image from the stage package: the anchor face of each character plus the flat layout go in as reference images, the prompt describes the shot.
async function metaImage(tool, target, input, env, f, ctx) {
  if (!env.MEDIA) throw new Error('media storage is not configured');
  const read = async (uri) => { const o = await env.MEDIA.get(String(uri).replace(/^media\//, '')); return o ? dataUrl(await o.arrayBuffer(), (o.httpMetadata && o.httpMetadata.contentType) || 'image/png') : null; };
  const refs = [], notes = [], [aw, ah] = input.aspect || [9, 16];
  // The layout goes first: the edit endpoint has no size field, so the first picture sets the frame.
  const layout = (input.files || []).find((x) => x.role === 'layout'), lu = layout && await read(layout.uri);
  if (lu) { refs.push(lu); notes.push(`Image 1 is a flat layout of the scene. Make a ${aw}:${ah} ${input.medium || 'photograph'} with exactly this camera angle and framing, and put the people and objects where it shows them. Do not copy its flat colours.`); }
  for (const a of (input.anchors || []).filter((x) => x.role === 'base').slice(0, 1)) { const u = await read(a.uri); if (u) { refs.push(u); notes.push(`Image ${refs.length} is the picture just before this one. Keep exactly the same place, background, camera angle, framing, light and positions, and change only what the description says changed.`); } }
  for (const a of (input.anchors || []).filter((x) => x.role !== 'base').slice(0, 4)) { const u = await read(a.uri); if (u) { refs.push(u); notes.push(`Image ${refs.length} is the character ${a.id}. Keep this character exactly: the same face, shape, colours, markings and clothes.`); } }
  const prompt = [input.prompt, ...notes].filter(Boolean).join('\n\n');
  if (!prompt) throw new Error('nothing to generate from: pass a prompt or a stage');
  const [W, H] = frame((input.aspect || [9, 16]).join(':'), 1536), [img] = await museImage(env, { prompt, images: refs, size: `${W}x${H}` }, f);
  const key = `${ctx.pid}/gen-${id8()}.png`; await env.MEDIA.put(key, img.bytes, { httpMetadata: { contentType: img.mime } });
  return { uri: `media/${key}`, mime: img.mime, bytes: img.bytes.length, meta: { model: modelOf(env, 'image'), prompt, references: refs.length, size: `${W}x${H}`, stage: (input.stage || input.shot) ? { ref: input.stage, shot: input.shot } : undefined } };
}
async function http(tool, target, input, env, f) {
  if (!/^https:\/\//.test(target.url)) throw new Error('tool target must be https');
  const headers = { 'content-type': 'application/json' };
  if (target.auth_env && env[target.auth_env]) headers.authorization = `Bearer ${env[target.auth_env]}`;
  const res = await f(target.url, { method: 'POST', headers, body: JSON.stringify({ tool: tool.name, input }), signal: AbortSignal.timeout(target.timeout_ms || 60000) });
  if (!res.ok) throw new Error(`provider answered ${res.status}`);
  const o = await res.json();
  return { uri: o.uri || o.url, mime: o.mime || MIME[tool.kind], bytes: o.bytes || 0, meta: o.meta };
}
// MCP over streamable HTTP: initialize, then tools/call. Replies may be plain JSON or an SSE stream.
async function mcp(tool, target, input, env, f) {
  const base = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (target.auth_env && env[target.auth_env]) base.authorization = `Bearer ${env[target.auth_env]}`;
  const rpc = async (body, headers) => {
    const res = await f(target.url, { method: 'POST', headers: { ...base, ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(target.timeout_ms || 60000) });
    if (!res.ok) throw new Error(`mcp server answered ${res.status}`);
    const text = await res.text();
    if (!body.id) return { session: res.headers.get('mcp-session-id') };
    let msg;
    if ((res.headers.get('content-type') || '').includes('text/event-stream')) msg = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => parseJson(l.slice(5).trim(), null)).find((m) => m && m.id === body.id);
    else msg = parseJson(text, null);
    if (!msg) throw new Error('empty mcp reply');
    if (msg.error) throw new Error(`mcp error: ${msg.error.message}`);
    return { msg, session: res.headers.get('mcp-session-id') };
  };
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'monofilm', version: '1' } } });
  const sh = init.session ? { 'mcp-session-id': init.session } : {};
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, sh);
  const { msg } = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: target.tool, arguments: input } }, sh);
  const r = msg.result || {};
  if (r.isError) throw new Error(`mcp tool failed: ${(r.content?.[0]?.text || '').slice(0, 200)}`);
  const o = r.structuredContent || parseJson(r.content?.find((c) => c.type === 'text')?.text || '', {});
  return { uri: o.uri || o.url, mime: o.mime || MIME[tool.kind], bytes: o.bytes || 0, meta: o.meta };
}

export async function callTool(db, env, actor, pid, { tool: name, ref, input: given = {} }, f = fetch) {
  let input = given;
  if (!can(actor, 'call_tool')) throw new HttpError(403, `role ${actor.role} cannot call tools`);
  const t = await db.prepare('SELECT * FROM tools WHERE name=?').bind(name).first();
  if (!t || !t.enabled) throw new HttpError(404, `no enabled tool ${name}`);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('input must be an object');
  await assertArtifact(db, pid, ref);
  const target = parseJson(t.target);
  if (input.stage) { const { stage, ...rest } = input; input = { ...(await stageInput(db, pid, { ref: stage.ref, shot: stage.shot, accepts: target.accepts || ACCEPTS })), ...rest }; } // expand a stage into the files this tool accepts
  const credits = estimate(parseJson(t.cost_model), input);
  await charge(db, actor, pid, { ref, tool: name, credits });
  try {
    const out = await ({ mock, http, mcp, 'meta-image': metaImage }[t.transport])(t, target, input, env, f, { db, pid, ref });
    if (!out.uri) throw new Error('provider returned no uri');
    const asset = await attachAsset(db, actor, pid, { ref, uri: out.uri, mime: out.mime, bytes: out.bytes, cost: credits, provenance: { tool: name, kind: t.kind, transport: t.transport, input, meta: out.meta || {} } }, { charged: true });
    return { asset, credits };
  } catch (e) { // the provider failed or returned something unusable: give the credits back
    if (credits) await refund(db, actor, pid, { ref, tool: name, credits });
    await logEvent(db, pid, ref, 'tool_failed', actor, `${name}: ${e.message}`);
    throw new HttpError(502, `${name} failed: ${e.message}`);
  }
}
