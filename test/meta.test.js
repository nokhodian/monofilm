// The Meta Model API, replaced by a stand-in that speaks the documented formats (https://dev.meta.ai/docs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, human, agent } from './d1.js';
import * as S from '../src/store.js';
import { registerTool, callTool } from '../src/tools.js';
import { museImage, parseBoxes, transcribe, sam } from '../src/meta.js';
import { checkAdherence } from '../src/adherence.js';
import { runAgent } from '../src/agent.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const fakeR2 = () => { const m = new Map(); return { m, put: async (k, b, o) => { m.set(k, { b: new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer ? b : b), ct: o && o.httpMetadata && o.httpMetadata.contentType }); }, get: async (k) => { const x = m.get(k); return x ? { arrayBuffer: async () => x.b.buffer.slice(x.b.byteOffset, x.b.byteOffset + x.b.byteLength), httpMetadata: { contentType: x.ct || 'image/png' } } : null; } }; };
const reply = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const msg = (text) => ({ id: 'r' + Math.random().toString(36).slice(2, 6), output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

const STAGE = { set: [{ id: 'beam', type: 'prop', name: 'Main beam', size: [0.3, 0.3, 4], pos: [0.5, 1.5, 0], rot: [0, 0, 0] }], characters: [{ id: 'ines', cast: 'canon.cast:ines', anchor: 'cx-warning', pos: [-0.6, 0, 0], facing: 20, pose: 'stand', height: 1.7 }], light: { key: { dir: [-1, -1, -0.5], tone: 'warm' } }, cameras: { A: { lens: 35, pos: [0, 1.2, 5], target: [0, 1.3, 0] } }, shots: { 'shot:H1': { camera: 'A' } } };
async function world() {
  const db = makeDb(), { id } = await S.createProduction(db, human, { name: 'Meta', format: 'movie', budget: 20 }), R2 = fakeR2();
  const ok = async (ref, data = { x: 1 }, extra = {}) => { await S.propose(db, agent, id, { ref, data, ...extra }); await S.decide(db, human, id, { ref, action: 'approve' }); };
  await ok('canon.style:look', { aspect: '9:16', rules: 'No modern objects.' }); await ok('canon.cast:ines', { name: 'Ines' }, { deps: ['canon.style:look'] });
  R2.m.set(`${id}/img-cx-warning.jpg`, { b: new Uint8Array(PNG), ct: 'image/jpeg' }); await S.attachAsset(db, agent, id, { ref: 'canon.cast:ines', uri: `media/${id}/img-cx-warning.jpg`, mime: 'image/jpeg' });
  await ok('episode:e1'); await ok('scene:hook', {}, { parent: 'episode:e1' }); await ok('stage:hook', STAGE, { parent: 'scene:hook' });
  await ok('shot:H1', { title: 'The beam', prompt: 'Ines looks up at a cracking beam' }, { parent: 'scene:hook', deps: ['canon.style:look'] }); await ok('keyframe:H1', { images: [] }, { parent: 'shot:H1', deps: ['canon.style:look'] });
  R2.m.set(`${id}/stage-hook-H1-layout.png`, { b: new Uint8Array(PNG), ct: 'image/png' }); await S.attachAsset(db, human, id, { ref: 'stage:hook', uri: `media/${id}/stage-hook-H1-layout.png`, mime: 'image/png', provenance: { role: 'layout', shot: 'shot:H1' } });
  return { db, id, ok, env: { DB: db, MEDIA: R2, MODEL_API_KEY: 'LLM_test' }, R2 };
}

test('Muse Image: edits with references when there are some, plain generation when there are none; errors are explained', async () => {
  const calls = [], f = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization }); return reply({ output_format: 'png', data: [{ b64_json: PNG.toString('base64') }] }); };
  const env = { MODEL_API_KEY: 'LLM_test' };
  const a = await museImage(env, { prompt: 'a door', size: '864x1536' }, f), b = await museImage(env, { prompt: 'a door', images: ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'] }, f);
  assert.equal(a[0].mime, 'image/png'); assert.ok(a[0].bytes.length > 10);
  assert.deepEqual(calls.map((c) => c.url), ['https://api.meta.ai/v1/images/generations', 'https://api.meta.ai/v1/images/edits']);
  assert.deepEqual([calls[0].body.model, calls[0].body.size, calls[0].auth], ['muse-image-1.0', '864x1536', 'Bearer LLM_test']); assert.equal(calls[1].body.images.length, 2);
  await assert.rejects(museImage({}, { prompt: 'x' }, f), (e) => e.status === 503 && /MODEL_API_KEY/.test(e.message));
  await assert.rejects(museImage(env, { prompt: 'x' }, async () => reply({ error: { code: 'content_policy_violation', message: 'blocked' } }, 400)), (e) => e.status === 400 && /blocked/.test(e.message));
});

test('the meta-image tool feeds Muse Image the anchor face and the layout, stores the picture, and charges the budget', async () => {
  const w = await world(), seen = [];
  await registerTool(w.db, { name: 'muse-image', kind: 'image', transport: 'meta-image', target: { accepts: ['layout', 'prompt'] }, cost_model: { per_call: 1 } });
  const f = async (url, init) => { seen.push(JSON.parse(init.body)); return reply({ output_format: 'png', data: [{ b64_json: PNG.toString('base64') }] }); };
  const r = await callTool(w.db, w.env, agent, w.id, { tool: 'muse-image', ref: 'keyframe:H1', input: { stage: { ref: 'stage:hook', shot: 'shot:H1' }, prompt: 'Ines looks up at a cracking beam' } }, f);
  const b = seen[0]; assert.equal(b.images.length, 2, 'the anchor face and the layout'); assert.match(b.prompt, /Image 1 is a flat layout.*9:16/); assert.match(b.prompt, /Image 2 is the character ines/); assert.equal(b.size, undefined, 'edits take their frame from the first picture');
  assert.match(r.asset.uri, new RegExp(`^media/${w.id}/gen-[a-z0-9]+\\.png$`)); assert.ok(w.R2.m.has(r.asset.uri.slice(6)), 'the picture is stored');
  const kf = await S.getArtifact(w.db, w.id, 'keyframe:H1'); assert.deepEqual([kf.assets[0].provenance.tool, kf.assets[0].provenance.transport, kf.assets[0].provenance.meta.model], ['muse-image', 'meta-image', 'muse-image-1.0']);
  assert.equal((await S.budgetStatus(w.db, w.id)).spent, 1);
  await assert.rejects(callTool(w.db, { ...w.env, MODEL_API_KEY: undefined }, agent, w.id, { tool: 'muse-image', ref: 'keyframe:H1', input: { prompt: 'x' } }, f), (e) => e.status === 502 && /MODEL_API_KEY/.test(e.message));
  assert.equal((await S.budgetStatus(w.db, w.id)).spent, 1, 'a failed call is refunded');
});

test('SAM boxes are parsed from the documented token format', () => {
  const t = '<0f>1<|box;x1=100;y1=200;x2=300;y2=800;w=864;h=1536;c=0.93|>2<|mask;data=2,2,~xx|>,3<|box;x1=0;y1=0;x2=432;y2=768;w=864;h=1536|>';
  const b = parseBoxes(t); assert.equal(b.length, 2); assert.deepEqual(b[0].box.map((x) => Math.round(x * 1000) / 1000), [0.116, 0.130, 0.347, 0.521]); assert.equal(b[0].conf, 0.93); assert.equal(b[1].conf, null); assert.deepEqual(parseBoxes(''), []);
});

test('adherence says how far each thing is from its place on the stage', async () => {
  const w = await world(); w.R2.m.set(`${w.id}/gen-x.png`, { b: new Uint8Array(PNG), ct: 'image/png' });
  const asked = [];
  const f = async (url, init) => { const b = JSON.parse(init.body), concept = b.input[0].content[0].text; asked.push([b.model, concept, b.input[0].content[1].image_url.slice(0, 22)]);
    // the stand-in puts the person far to the right and the beam where the stage put it
    return reply(msg(concept === 'person' ? '<0f>1<|box;x1=560;y1=300;x2=780;y2=1400;w=864;h=1536|>' : '')); };
  const r = await checkAdherence(w.env, w.db, w.id, { stage: 'stage:hook', shot: 'shot:H1', uri: `media/${w.id}/gen-x.png` }, f);
  assert.deepEqual(asked.map((a) => a[1]).sort(), ['main beam', 'person'], 'one SAM request per concept'); assert.equal(asked[0][0], 'sam-3.1'); assert.match(asked[0][2], /^data:image\/png;base64,/);
  const m = r.rows.find((x) => x.id === 'ines'); assert.notEqual(m.verdict, 'ok'); assert.match(m.note, /too far right/); assert.ok(m.dx > 0.2);
  assert.equal(r.rows.find((x) => x.id === 'beam').verdict, 'missing'); assert.ok(r.summary.length >= 2 && r.score < 0.5); assert.ok(m.found, 'the person is matched to the character even with no overlap');
  await assert.rejects(checkAdherence(w.env, w.db, w.id, { stage: 'stage:hook', shot: 'shot:H1', uri: 'https://evil.example/x.png' }, f), (e) => e.status === 400);
});

test('Muse Voice Transcribe: a WAV goes out as multipart and the words come back', async () => {
  let form; const f = async (url, init) => { form = init.body; assert.match(url, /\/asr\/transcribe\?sessionId=/); return reply({ sessionId: 's', transcript: 'Make her sound less sure.', audioDurationMs: 2400, turns: [] }); };
  const r = await transcribe({ MODEL_API_KEY: 'k' }, new Uint8Array([82, 73, 70, 70]), { language: 'en' }, f);
  assert.deepEqual(r, { transcript: 'Make her sound less sure.', seconds: 2.4 });
  assert.equal(JSON.parse(await form.get('request').text()).model, 'muse-voice-transcribe-1.0'); assert.equal(form.get('audio').type, 'audio/wav');
});

test('the Muse Spark agent reads feedback, revises and answers it, and has no way to approve', async () => {
  const w = await world(), { id: cid } = await S.addComment(w.db, human, w.id, { ref: 'shot:H1', body: 'Open on the beam, not her face.', verdict: 'change' });
  const turns = [
    { id: 'r1', output: [{ type: 'function_call', name: 'next_work', call_id: 'c1', arguments: JSON.stringify({ production: w.id }) }] },
    { id: 'r2', output: [{ type: 'function_call', name: 'propose', call_id: 'c2', arguments: JSON.stringify({ production: w.id, ref: 'shot:H1', data: { title: 'The beam', prompt: 'A cracking beam fills the frame; Ines enters below it' }, parent: 'scene:hook', deps: ['canon.style:look'], rationale: 'Opens on the beam as asked.', addresses: [cid] }) }, { type: 'function_call', name: 'approve', call_id: 'c3', arguments: '{}' }] },
    msg('Revised shot:H1 so it opens on the beam.')];
  const sent = []; let n = 0; const f = async (url, init) => { const b = JSON.parse(init.body); sent.push(b); if (n === 1) { const out = b.input.find((x) => x.call_id === 'c1'); assert.match(out.output, /"type":"feedback"/); assert.equal(b.previous_response_id, 'r1'); } return reply(turns[n++]); };
  const r = await runAgent(w.env, w.db, w.id, {}, f);
  assert.equal(sent[0].model, 'muse-spark-1.3'); assert.ok(sent[0].tools.some((t) => t.name === 'propose') && !sent[0].tools.some((t) => /approve|decide/.test(t.name)), 'it cannot approve');
  assert.deepEqual(r.steps.map((s) => [s.tool, s.ok]), [['next_work', true], ['propose', true], ['approve', false]]); assert.match(r.text, /opens on the beam/); assert.equal(r.finished, true);
  const a = await S.getArtifact(w.db, w.id, 'shot:H1'); assert.deepEqual([a.version, a.author, a.status], [2, 'muse-spark', 'proposed']);
  assert.equal((await S.listComments(w.db, w.id, { status: 'addressed' }))[0].id, cid);
});

test('an object can say what SAM should look for', async () => {
  const { expectedBoxes } = await import('../public/js/stage-math.js');
  const st = { ...STAGE, set: [{ ...STAGE.set[0], name: 'Prop', find_as: 'Wooden Beam' }] };
  assert.equal(expectedBoxes(st, 'shot:H1').find((e) => e.id === 'beam').concept, 'wooden beam');
  assert.equal(expectedBoxes({ ...STAGE, set: [{ ...STAGE.set[0], name: 'Main beam' }] }, 'shot:H1').find((e) => e.id === 'beam').concept, 'main beam');
});
