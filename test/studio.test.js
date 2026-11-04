import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, human, agent } from './d1.js';
import * as S from '../src/store.js';
import { registerTool, callTool } from '../src/tools.js';

const rejects = (p, status, re) => assert.rejects(p, (e) => e.status === status && (!re || re.test(e.message)));
async function setup(opts = {}) {
  const db = makeDb(), { id } = await S.createProduction(db, human, { name: 'Test', format: 'series', ...opts });
  const ok = async (ref, data = { x: 1 }, extra = {}) => { await S.propose(db, agent, id, { ref, data, ...extra }); await S.decide(db, human, id, { ref, action: 'approve' }); };
  return { db, id, ok };
}
// canon.style -> episode -> scene -> shot, all approved
async function chain(t) {
  await t.ok('canon.style:look', { base: 'muted film' });
  await t.ok('episode:e1');
  await t.ok('scene:s1', {}, { parent: 'episode:e1' });
  await t.ok('shot:sh1', { prompt: 'a door' }, { parent: 'scene:s1', deps: ['canon.style:look'] });
}

test('proposals need approved parents and valid refs', async () => {
  const t = await setup();
  await rejects(S.propose(t.db, agent, t.id, { ref: 'scene:s1', data: {}, parent: 'episode:e1' }), 409, /unknown dependency/);
  await rejects(S.propose(t.db, agent, t.id, { ref: 'nonsense:x', data: {} }), 400);
  await rejects(S.propose(t.db, agent, t.id, { ref: 'logline:a', data: [] }), 400);
  await S.propose(t.db, agent, t.id, { ref: 'episode:e1', data: {} });
  await rejects(S.propose(t.db, agent, t.id, { ref: 'scene:s1', data: {}, parent: 'episode:e1' }), 409, /not approved/);
});

test('only humans decide; changes need a comment; versions are checked', async () => {
  const t = await setup();
  await S.propose(t.db, agent, t.id, { ref: 'logline:l', data: { text: 'v1' } });
  await rejects(S.decide(t.db, agent, t.id, { ref: 'logline:l', action: 'approve' }), 403);
  await rejects(S.decide(t.db, { ...human, kind: 'ai' }, t.id, { ref: 'logline:l', action: 'approve' }), 403);
  await rejects(S.decide(t.db, human, t.id, { ref: 'logline:l', action: 'request_changes' }), 400);
  await rejects(S.decide(t.db, human, t.id, { ref: 'logline:l', action: 'approve', version: 9 }), 409);
  await S.decide(t.db, human, t.id, { ref: 'logline:l', action: 'request_changes', comment: 'shorter' });
  const w = await S.nextWork(t.db, t.id);
  assert.deepEqual(w.work[0], { type: 'changes_requested', ref: 'logline:l', version: 1, comment: 'shorter', by: 'ann' });
  await S.propose(t.db, agent, t.id, { ref: 'logline:l', data: { text: 'v2' } });
  assert.equal((await S.getArtifact(t.db, t.id, 'logline:l')).version, 2);
});

test('editing canon marks everything built on it stale; a human can keep it', async () => {
  const t = await setup(); await chain(t);
  await t.ok('keyframe:k1', {}, { parent: 'shot:sh1', deps: ['canon.style:look'] });
  await S.propose(t.db, agent, t.id, { ref: 'canon.style:look', data: { base: 'hard noir' } });
  const stale = (await S.listArtifacts(t.db, t.id, { stale: true })).map((a) => a.ref).sort();
  assert.deepEqual(stale, ['keyframe:k1', 'shot:sh1']);
  assert.ok((await S.nextWork(t.db, t.id)).work.some((w) => w.type === 'stale' && w.ref === 'shot:sh1'));
  await S.decide(t.db, human, t.id, { ref: 'shot:sh1', action: 'keep' });
  assert.equal((await S.getArtifact(t.db, t.id, 'shot:sh1')).stale, false);
  await rejects(S.decide(t.db, human, t.id, { ref: 'shot:sh1', action: 'keep' }), 409);
});

test('locked artifacts cannot be changed until a human unlocks (which flags dependents)', async () => {
  const t = await setup(); await chain(t);
  await S.setLock(t.db, human, t.id, { ref: 'canon.style:look', lock: true });
  await rejects(S.propose(t.db, agent, t.id, { ref: 'canon.style:look', data: { base: 'x' } }), 409, /locked/);
  await rejects(S.setLock(t.db, agent, t.id, { ref: 'canon.style:look', lock: false }), 403);
  await S.setLock(t.db, human, t.id, { ref: 'canon.style:look', lock: false });
  assert.equal((await S.getArtifact(t.db, t.id, 'shot:sh1')).stale, true);
});

test('video takes are gated behind an approved keyframe and canon', async () => {
  const t = await setup(); await chain(t);
  await rejects(S.propose(t.db, agent, t.id, { ref: 'take:t1', data: {}, parent: 'shot:sh1', deps: ['canon.style:look'] }), 409, /approved keyframe/);
  await S.propose(t.db, agent, t.id, { ref: 'keyframe:k1', data: {}, parent: 'shot:sh1', deps: ['canon.style:look'] });
  await rejects(S.propose(t.db, agent, t.id, { ref: 'take:t1', data: {}, parent: 'shot:sh1', deps: ['canon.style:look', 'keyframe:k1'] }), 409, /not approved/);
  await S.decide(t.db, human, t.id, { ref: 'keyframe:k1', action: 'approve' });
  await S.propose(t.db, agent, t.id, { ref: 'take:t1', data: {}, parent: 'shot:sh1', deps: ['canon.style:look', 'keyframe:k1'] });
});

test('queue lists stale work first, then earliest pipeline stage', async () => {
  const t = await setup(); await chain(t);
  await S.propose(t.db, agent, t.id, { ref: 'dialogue:d1', data: {}, parent: 'shot:sh1' });
  await S.propose(t.db, agent, t.id, { ref: 'canon.cast:a', data: {}, deps: ['canon.style:look'] });
  assert.deepEqual((await S.queue(t.db, t.id)).map((x) => x.ref), ['canon.cast:a', 'dialogue:d1']);
  await S.propose(t.db, agent, t.id, { ref: 'canon.style:look', data: { base: 'new' } });
  assert.equal((await S.queue(t.db, t.id))[0].stale, true);
});

test('dependency cycles are refused', async () => {
  const t = await setup();
  await t.ok('logline:a'); await t.ok('bible:b', {}, { deps: ['logline:a'] });
  await rejects(S.propose(t.db, agent, t.id, { ref: 'logline:a', data: { y: 1 }, deps: ['bible:b'] }), 409, /cycle/);
});

test('budget: total and per-shot caps hold, failures refund', async () => {
  const t = await setup({ budget: 10, shot_cap: 6 }); await chain(t);
  await t.ok('shot:sh2', {}, { parent: 'scene:s1', deps: ['canon.style:look'] });
  await registerTool(t.db, { name: 'img', kind: 'image', transport: 'mock', cost_model: { per_call: 4 } });
  await registerTool(t.db, { name: 'bad', kind: 'video', transport: 'http', target: { url: 'https://p.example/x' }, cost_model: { per_call: 1 } });
  const call = (ref, tool = 'img') => callTool(t.db, {}, agent, t.id, { tool, ref, input: { prompt: 'p' } });
  assert.match((await call('shot:sh1')).asset.uri, /^mock:\/\/image\//);
  await rejects(call('shot:sh1'), 402, /over budget/);
  await call('shot:sh2');
  assert.equal((await S.budgetStatus(t.db, t.id)).spent, 8);
  await rejects(callTool(t.db, {}, agent, t.id, { tool: 'bad', ref: 'shot:sh2', input: {} }, async () => new Response('no', { status: 500 })), 502);
  assert.equal((await S.budgetStatus(t.db, t.id)).spent, 8);
  await rejects(S.grantBudget(t.db, agent, t.id, { add: 5 }), 403);
  assert.equal((await S.grantBudget(t.db, human, t.id, { add: 5 })).remaining, 7);
  await S.requestBudget(t.db, agent, t.id, { amount: 20, reason: 'more takes' });
  assert.ok((await S.events(t.db, t.id)).some((e) => e.action === 'budget_request'));
});

test('http and mcp tool transports', async () => {
  const t = await setup({ budget: 100 }); await chain(t);
  await registerTool(t.db, { name: 'h', kind: 'voice', transport: 'http', target: { url: 'https://p.example/tts', auth_env: 'KEY' }, cost_model: { per_second: 0.5 } });
  await registerTool(t.db, { name: 'm', kind: 'video', transport: 'mcp', target: { url: 'https://mcp.example/mcp', tool: 'make_video' }, cost_model: { per_call: 3 } });
  let seen;
  const r1 = await callTool(t.db, { KEY: 'k1' }, agent, t.id, { tool: 'h', ref: 'shot:sh1', input: { text: 'hi', seconds: 4 } }, async (u, o) => { seen = { u, auth: o.headers.authorization }; return Response.json({ uri: 'https://cdn.example/a.mp3' }); });
  assert.deepEqual(seen, { u: 'https://p.example/tts', auth: 'Bearer k1' });
  assert.equal(r1.credits, 2);
  const calls = [];
  const r2 = await callTool(t.db, {}, agent, t.id, { tool: 'm', ref: 'shot:sh1', input: { prompt: 'p' } }, async (u, o) => {
    const b = JSON.parse(o.body); calls.push(b.method);
    if (b.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: b.id, result: {} }, { headers: { 'mcp-session-id': 's9' } });
    if (b.method === 'tools/call') { assert.equal(o.headers['mcp-session-id'], 's9'); return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: b.id, result: { content: [{ type: 'text', text: '{"uri":"https://cdn.example/v.mp4"}' }] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }); }
    return new Response(null, { status: 202 });
  });
  assert.deepEqual(calls, ['initialize', 'notifications/initialized', 'tools/call']);
  assert.equal(r2.asset.uri, 'https://cdn.example/v.mp4');
  const a = await S.getArtifact(t.db, t.id, 'shot:sh1');
  assert.deepEqual(a.assets.map((x) => x.provenance.transport).sort(), ['http', 'mcp']);
});

test('continuity flags forbidden canon terms but ignores negative prompts', async () => {
  const t = await setup();
  await t.ok('canon.world:w', { forbidden: ['electric light', 'printed paper'] });
  await t.ok('canon.style:look'); await t.ok('episode:e1'); await t.ok('scene:s1', {}, { parent: 'episode:e1' });
  await t.ok('shot:sh1', { prompt: 'Candle and an Electric Light bulb', negative: 'no printed paper' }, { parent: 'scene:s1', deps: ['canon.style:look'] });
  const r = await S.checkContinuity(t.db, t.id);
  assert.deepEqual(r.issues, [{ ref: 'shot:sh1', type: 'forbidden', term: 'electric light' }]);
});

test('asset uris are validated', async () => {
  const t = await setup(); await t.ok('logline:l');
  await rejects(S.attachAsset(t.db, agent, t.id, { ref: 'logline:l', uri: 'javascript:alert(1)' }), 400);
  await S.attachAsset(t.db, agent, t.id, { ref: 'logline:l', uri: 'audio/vo/x.mp3', mime: 'audio/mpeg' });
});

test('feedback loop: human comments, agent sees it, revises, approval closes the thread', async () => {
  const t = await setup(); await chain(t);
  await rejects(S.addComment(t.db, { ...agent, role: 'viewer' }, t.id, { ref: 'shot:sh1', body: 'x' }), 403);
  await rejects(S.addComment(t.db, human, t.id, { ref: 'shot:sh1', body: '' }), 400);
  await rejects(S.addComment(t.db, human, t.id, { ref: 'shot:sh1', verdict: 'maybe' }), 400);
  const { id } = await S.addComment(t.db, human, t.id, { ref: 'shot:sh1', body: 'too dark', verdict: 'change', context: 'cut:main', anchor: 'field:prompt' });
  const w = (await S.nextWork(t.db, t.id)).work[0];
  assert.deepEqual([w.type, w.comment_id, w.ref, w.body, w.verdict, w.context], ['feedback', id, 'shot:sh1', 'too dark', 'change', 'cut:main']);
  await S.addComment(t.db, agent, t.id, { ref: 'shot:sh1', body: 'will brighten', parent: id });
  assert.equal((await S.listComments(t.db, t.id, { ref: 'shot:sh1' }))[0].replies.length, 1);
  await rejects(S.propose(t.db, agent, t.id, { ref: 'shot:sh1', data: { prompt: 'a lit door' }, parent: 'scene:s1', deps: ['canon.style:look'], addresses: ['nope'] }), 400);
  await S.propose(t.db, agent, t.id, { ref: 'shot:sh1', data: { prompt: 'a lit door' }, parent: 'scene:s1', deps: ['canon.style:look'], addresses: [id] });
  assert.equal((await S.listComments(t.db, t.id, { status: 'addressed' }))[0].addressed_in, 2);
  assert.ok(!(await S.nextWork(t.db, t.id)).work.some((x) => x.type === 'feedback'));
  await S.decide(t.db, human, t.id, { ref: 'shot:sh1', action: 'approve' });
  assert.equal((await S.listComments(t.db, t.id, { status: 'resolved' })).length, 1);
  await S.addComment(t.db, human, t.id, { ref: 'shot:sh1', body: 'now too bright', parent: id });
  assert.equal((await S.listComments(t.db, t.id, { status: 'open' })).length, 1); // a human reply reopens the thread
  await rejects(S.resolveComment(t.db, agent, t.id, id, true), 403);
  await S.resolveComment(t.db, human, t.id, id, true);
  assert.equal((await S.listComments(t.db, t.id, { status: 'resolved' })).length, 1);
});

test('a human edit is approved at once and flags what was built on it; versions keep their data', async () => {
  const t = await setup(); await chain(t);
  await t.ok('keyframe:k1', { img: 'a' }, { parent: 'shot:sh1', deps: ['canon.style:look'] });
  await rejects(S.propose(t.db, agent, t.id, { ref: 'shot:sh1', data: {}, parent: 'scene:s1', deps: ['canon.style:look'], auto_approve: true }), 403);
  const r = await S.propose(t.db, human, t.id, { ref: 'shot:sh1', data: { prompt: 'my edit' }, parent: 'scene:s1', deps: ['canon.style:look'], auto_approve: true, rationale: 'tightened' });
  assert.equal(r.status, 'approved');
  const a = await S.getArtifact(t.db, t.id, 'shot:sh1');
  assert.deepEqual(a.versions.map((v) => [v.version, v.author, v.data.prompt]), [[2, 'ann', 'my edit'], [1, 'claude', 'a door']]);
  assert.equal((await S.getArtifact(t.db, t.id, 'keyframe:k1')).stale, true);
  assert.ok((await S.nextWork(t.db, t.id)).work.some((x) => x.type === 'stale' && x.ref === 'keyframe:k1'));
});

test('cut checks flag the same problems for the page and the AI', async () => {
  const { checkCut } = await import('../public/js/checks.js');
  const shots = { H1: { slot: 'hook', spoiler_level: 0, dur_min: 3, dur_max: 6 }, T1: { slot: 'title', spoiler_level: 3, is_new: true, risk: 'unclear rights' } };
  const lines = { H1: [{ role: 'M', speaker: 'Ines', de: 'eins zwei drei vier fünf sechs sieben acht', seconds: 0 }], T1: [{ role: 'CARD', de: 'INES' }] };
  const ctx = { shot: (i) => shots[i], lines: (i) => lines[i] || [], hasImage: (i) => i !== 'T1', hasClip: () => false, state: () => ({ status: 'approved', stale: true }), bible: { fiction_label: { regex: 'fiktion', hint: 'Add a label.' } } };
  const r = checkCut({ order: [{ id: 'H1', seconds: 2 }, { id: 'T1', seconds: 40 }], target_seconds: 60 }, ctx).map((x) => `${x.lvl}:${x.txt}`);
  const has = (re) => assert.ok(r.some((x) => re.test(x)), `missing ${re}: ${r.join(' | ')}`);
  has(/^warn:Runtime 42s against a 60s target/); has(/^ok:Opens on a hook/); has(/^ok:Ends with a title card/); has(/^warn:No fiction label.*Add a label/);
  has(/^bad:Contains an ending-level spoiler \(T1\)/); has(/^warn:Speech may overrun.*H1/); has(/^bad:No image for: T1/); has(/^warn:No clip yet/);
  has(/^warn:Outside the length.*H1 \(2s/); has(/^warn:1 shot with new lines.*T1/); has(/^warn:T1: unclear rights/); has(/^warn:Not settled.*H1, T1/); has(/^ok:Voices needed: Ines/);
  assert.equal(checkCut({ order: [] }, ctx)[0].lvl, 'bad');
});

test('flags need a note, drawings must be stored here, and presence and backup work', async () => {
  const t = await setup(); await t.ok('logline:l');
  await rejects(S.addComment(t.db, human, t.id, { ref: 'logline:l', verdict: 'anachronism' }), 400);
  await rejects(S.addComment(t.db, human, t.id, { ref: 'logline:l', body: 'x', attachment: 'https://evil.example/x.png' }), 400);
  await S.addComment(t.db, human, t.id, { ref: 'logline:l', verdict: 'continuity', body: 'sleeves changed', anchor: 'fails:anchor,period', attachment: `media/${t.id}/markup-1.png` });
  const c = (await S.listComments(t.db, t.id))[0];
  assert.deepEqual([c.verdict, c.anchor, c.attachment], ['continuity', 'fails:anchor,period', `media/${t.id}/markup-1.png`]);
  assert.equal((await S.nextWork(t.db, t.id)).work[0].attachment, c.attachment);
  const a = await S.pulse(t.db, human, t.id), b = await S.pulse(t.db, agent, t.id);
  assert.deepEqual(b.here, ['ann', 'claude']); assert.ok(a.last_event > 0);
  const bk = await S.backup(t.db, t.id);
  assert.deepEqual([bk.schema, bk.artifacts.length, bk.comments.length, bk.versions.length], ['monofilm/backup@1', 1, 1, 1]);
});

const STAGE = {
  units: 'm', set: [{ id: 'beam1', type: 'prop', name: 'Main beam', shape: 'box', size: [0.3, 0.3, 4], pos: [0.5, 1.5, 0], rot: [0, 0, 0], must_keep: true }, { id: 'wall', type: 'set', name: 'Back wall', size: [8, 4, 0.3], pos: [0, 0, -4], rot: 0 }],
  characters: [{ id: 'ines', cast: 'canon.cast:ines', anchor: 'cx-warning', pos: [-0.6, 0, 0], facing: 20, pose: 'stand', height: 1.65, looking_at: 'beam1' }, { id: 'konrad', cast: 'canon.cast:konrad', pos: [0.9, 0, 1.2], facing: 200, pose: 'walk', height: 1.8 }],
  light: { key: { dir: [-1, -1, -0.5], tone: 'warm' } },
  cameras: { A: { lens: 35, pos: [0, 1.2, 5], target: [0, 1.3, 0], roll: 0, move: { type: 'slow push-in', seconds: 3.5 } }, B: { lens: 85, pos: [0, 1.5, 12], target: [8, 1.5, 0] } },
  shots: { 'shot:H1': { camera: 'A' }, 'shot:H2': { camera: 'B' } },
};
async function stageSetup() {
  const t = await setup({ budget: 50 });
  await t.ok('canon.style:look', { aspect: '9:16', rules: 'No modern objects.' }); await t.ok('canon.cast:ines'); await t.ok('episode:e1'); await t.ok('scene:hook', {}, { parent: 'episode:e1' });
  await t.ok('stage:hook', STAGE, { parent: 'scene:hook' });
  return t;
}

test('stage maths: projection, prompt words, and layout checks', async () => {
  const { project, composePrompt, checkStage, frame } = await import('../public/js/stage-math.js');
  const [W, H] = frame('9:16'); assert.deepEqual([W, H], [540, 960]);
  const mid = project([0, 1.3, 0], STAGE.cameras.A, W, H); assert.ok(Math.abs(mid[0] - W / 2) < 1 && Math.abs(mid[1] - H / 2) < 1, 'the target is the middle of the frame');
  assert.equal(project([0, 1, 20], STAGE.cameras.A, W, H), null, 'behind the camera');
  const w = composePrompt(STAGE, 'shot:H1', { rules: 'No modern objects.' });
  assert.match(w, /35 mm lens, eye-level, camera 1\.2 m high, slow push-in over 3\.5 s/); assert.match(w, /Ines .* (left|centre).*facing/); assert.match(w, /Konrad .* right/); assert.match(w, /Rules: No modern objects/);
  const r = checkStage(STAGE, { aspect: '9:16', cast: ['canon.cast:ines'] }).map((x) => `${x.lvl}:${x.txt}`);
  const has = (re) => assert.ok(r.some((x) => re.test(x)), `${re} in ${r.join(' | ')}`);
  has(/bad:konrad points at canon\.cast:konrad/); has(/warn:konrad has no anchor/); has(/warn:Main beam must stay in every shot but is not visible in shot:H2/); has(/warn:ines is out of frame in shot:H2/);
  const inside = checkStage({ ...STAGE, cameras: { A: { ...STAGE.cameras.A, pos: [0.5, 1.6, 0] } } }, {}).map((x) => x.txt); assert.ok(inside.some((x) => /Camera A is inside Main beam/.test(x)));
  assert.equal(checkStage({ set: [], characters: [], cameras: {}, shots: {} })[0].lvl, 'bad');
});

test('stage input gives each generator only the files it accepts and words for the rest', async () => {
  const t = await stageSetup(), { stageInput } = await import('../src/stage.js');
  const put = (uri, role, extra = {}) => S.attachAsset(t.db, human, t.id, { ref: 'stage:hook', uri, mime: role === 'camera' ? 'application/json' : 'image/png', provenance: { role, shot: 'shot:H1', ...extra } });
  for (const r of ['layout', 'depth', 'ids', 'pose', 'camera']) await put(`media/${t.id}/${r}.png`, r);
  const full = await stageInput(t.db, t.id, { ref: 'stage:hook', shot: 'shot:H1' });
  assert.deepEqual(full.files.map((f) => f.role).sort(), ['camera', 'depth', 'ids', 'layout', 'pose']); assert.deepEqual(full.described_in_words, []);
  const lite = await stageInput(t.db, t.id, { ref: 'stage:hook', shot: 'shot:H1', accepts: ['depth', 'prompt'] });
  assert.deepEqual(lite.files.map((f) => f.role), ['depth']); assert.deepEqual(lite.described_in_words.sort(), ['camera', 'ids', 'layout', 'pose']); assert.match(lite.prompt, /slow push-in/); assert.deepEqual(lite.camera.lens, 35);
  await rejects(stageInput(t.db, t.id, { ref: 'stage:hook', shot: 'shot:NOPE' }), 404);
  await registerTool(t.db, { name: 'cn', kind: 'image', transport: 'mock', target: { accepts: ['depth', 'prompt'] }, cost_model: { per_call: 1 } });
  await rejects(registerTool(t.db, { name: 'bad', kind: 'image', transport: 'mock', target: { accepts: ['hologram'] } }), 400);
  await t.ok('shot:H1', { title: 'beam' }, { parent: 'scene:hook', deps: ['canon.style:look'] });
  const r = await callTool(t.db, {}, agent, t.id, { tool: 'cn', ref: 'shot:H1', input: { stage: { ref: 'stage:hook', shot: 'shot:H1' } } });
  const a = await S.getArtifact(t.db, t.id, 'shot:H1'), inp = a.assets[0].provenance.input;
  assert.deepEqual(inp.files.map((f) => f.role), ['depth']); assert.ok(inp.prompt.includes('35 mm lens'));
  assert.equal(r.credits, 1);
});

test('restore replays a backup into a new production with its threads and files', async () => {
  const t = await setup(); await t.ok('logline:l', { text: 'x' }); await t.ok('bible:b', { y: 1 }, { deps: ['logline:l'] });
  await S.attachAsset(t.db, agent, t.id, { ref: 'logline:l', uri: `media/${t.id}/a.png`, mime: 'image/png' });
  const { id } = await S.addComment(t.db, human, t.id, { ref: 'logline:l', body: 'sharper', verdict: 'change' }); await S.addComment(t.db, agent, t.id, { ref: 'logline:l', body: 'on it', parent: id });
  const bk = await S.backup(t.db, t.id), r = await S.restoreBackup(t.db, human, bk);
  assert.notEqual(r.id, t.id); assert.equal((await S.getProduction(t.db, r.id)).name, 'Test (restored)');
  const a = await S.getArtifact(t.db, r.id, 'bible:b'); assert.deepEqual([a.status, a.deps, a.versions.length], ['approved', ['logline:l'], 1]);
  const th = (await S.listComments(t.db, r.id))[0]; assert.deepEqual([th.body, th.replies.length], ['sharper', 1]);
  assert.equal((await S.getArtifact(t.db, r.id, 'logline:l')).assets.length, 1);
  assert.equal((await S.getArtifact(t.db, t.id, 'logline:l')).assets.length, 1, 'the original is untouched');
  await rejects(S.restoreBackup(t.db, agent, bk), 403); await rejects(S.restoreBackup(t.db, human, { schema: 'nope' }), 400);
});

test('saving a stage makes its shots depend on it, so editing the layout flags their pictures stale', async () => {
  const t = await setup({ budget: 50 });
  await t.ok('canon.style:look', { aspect: '9:16' }); await t.ok('episode:e1'); await t.ok('scene:hook', {}, { parent: 'episode:e1' });
  await t.ok('shot:H1', { title: 'beam' }, { parent: 'scene:hook', deps: ['canon.style:look'] });
  await t.ok('keyframe:H1', { images: ['a'] }, { parent: 'shot:H1', deps: ['canon.style:look'] });
  await t.ok('stage:hook', STAGE, { parent: 'scene:hook' }); // the first save links the shot to the stage and flags nothing
  assert.ok((await S.getArtifact(t.db, t.id, 'stage:hook')).dependents.includes('shot:H1'));
  assert.equal((await S.listArtifacts(t.db, t.id, { stale: true })).length, 0);
  await S.propose(t.db, human, t.id, { ref: 'stage:hook', data: { ...STAGE, cameras: { ...STAGE.cameras, A: { ...STAGE.cameras.A, lens: 50 } } }, parent: 'scene:hook', auto_approve: true, rationale: 'tighter lens' });
  assert.deepEqual((await S.listArtifacts(t.db, t.id, { stale: true })).map((a) => a.ref).sort(), ['keyframe:H1', 'shot:H1']);
  assert.ok((await S.nextWork(t.db, t.id)).work.some((w) => w.type === 'stale' && w.ref === 'keyframe:H1'));
});
