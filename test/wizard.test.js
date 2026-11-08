// The wizard: reading a story, drafting scenes, making pictures, bringing a clip back. Meta is replaced by a stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, human, agent } from './d1.js';
import * as S from '../src/store.js';
import * as W from '../src/wizard.js';
import { R, REFS, clipPlan, composeClip, review, sceneReadiness, counts } from '../public/js/wizard-model.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const reply = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const msg = (o) => ({ id: 'r1', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Here you go:\n```json\n' + JSON.stringify(o) + '\n```' }] }] });
const fakeR2 = () => { const m = new Map(); return { m, put: async (k, b) => { m.set(k, b); }, get: async (k) => (m.has(k) ? { arrayBuffer: async () => PNG, httpMetadata: { contentType: 'image/png' } } : null) }; };

const READ = { title: 'The Beam', summary: 'A widow warns of a collapse.', tone: ['tense'], period: 'Kestrel Station 2089', language: 'German',
  people: [{ name: 'Ines', role: 'widow', desc: 'A woman in her forties, wool cloak', voice: 'warm, controlled' }, { name: 'Adelheid', role: 'daughter', desc: 'a girl', invented: true }],
  places: [{ name: 'Cathedral scaffold', desc: 'timber scaffold', time: 'dusk' }], beats: [{ text: 'She sees the crack.' }, { text: 'It falls.' }],
  questions: [{ q: 'Show the fall?', options: ['On screen', 'Sound only'] }], invented: ['A daughter'], forbidden: ['electric light'],
  looks: [{ name: 'Muted film', sub: 'grain', desc: 'Muted film, fine grain' }, { name: 'Noir', sub: 'hard', desc: 'Hard noir' }, { name: 'Fresco', sub: 'warm', desc: 'Warm fresco' }] };
const SCENES = { scenes: [{ name: 'The beam', tag: 'hook', seconds: 12, place: 'Cathedral scaffold', time: 'dusk', who: ['Ines'], transcript: [{ who: 'ines', text: 'Es wird nicht tragen.', en: 'It will not bear.', sec: 3 }], notes: { happens: 'She looks up.', mood: 'dread', cam: 'push in', sound: 'creak', never: 'No collapse yet', cont: 'First scene' } }, { name: 'The fall', tag: 'crash', seconds: 8, place: 'Cathedral scaffold', time: 'dusk', who: [], notes: { happens: 'Dust falls.' } }] };
const stand = (calls = []) => async (url, init) => {
  calls.push(url);
  if (url.endsWith('/responses')) { const b = JSON.parse(init.body); return reply(msg(/read a story/.test(b.instructions) ? READ : SCENES)); }
  return reply({ output_format: 'png', data: [{ b64_json: PNG.toString('base64') }] });
};
async function setup(key = 'LLM_x') {
  const db = makeDb(), { id } = await S.createProduction(db, human, { name: 'W', format: 'movie', budget: 20 }), R2 = fakeR2(), env = { DB: db, MEDIA: R2, ...(key ? { MODEL_API_KEY: key } : {}) };
  await S.propose(db, human, id, { ref: REFS.story, data: { text: 'Kestrel Station, 2089. The cathedral rises. Ines knows it will fail. Nobody listens.', format: { seconds: 20, aspect: '9:16', speech: 'German' } }, auto_approve: true });
  return { db, id, env, R2 };
}
const ok = (t, ref) => S.decide(t.db, human, t.id, { ref, action: 'approve' });

test('reading the story proposes the reading, people, voices, places and looks, and sets up the episode', async () => {
  const t = await setup(), r = await W.readStory(t.env, t.db, human, t.id, stand());
  assert.equal(r.via, 'muse-spark');
  const by = Object.fromEntries((await S.listArtifacts(t.db, t.id)).map((a) => [a.ref, a]));
  assert.equal(by[REFS.episode].status, 'approved', 'structure is the human\'s own');
  for (const ref of [REFS.reading, R.cast('ines'), R.cast('adelheid'), R.voice('ines'), R.place('cathedral-scaffold'), REFS.look]) assert.equal(by[ref].status, 'proposed', ref);
  assert.equal(by[R.cast('adelheid')].data.invented, true);
  assert.equal(by[REFS.reading].data.sentences.length, 4); assert.equal(by[REFS.look].data.options.length, 3);
  assert.equal(by[REFS.look].data.forbidden[0], 'electric light'); assert.equal(by[R.cast('ines')].author, 'muse-spark');
});

test('a re-read keeps the person\'s sentence marks and answers, and never rewrites a locked item', async () => {
  const t = await setup(); await W.readStory(t.env, t.db, human, t.id, stand());
  await ok(t, REFS.reading); const b = await S.getArtifact(t.db, t.id, REFS.reading);
  await S.propose(t.db, human, t.id, { ref: REFS.reading, data: { ...b.data, sentences: b.data.sentences.map((s, i) => (i === 1 ? { ...s, mark: 'keep' } : s)), questions: b.data.questions.map((q) => ({ ...q, answer: 'Sound only' })) }, auto_approve: true });
  await ok(t, R.cast('ines')); await S.setLock(t.db, human, t.id, { ref: R.cast('ines'), lock: true });
  await W.readStory(t.env, t.db, human, t.id, stand());
  const after = await S.getArtifact(t.db, t.id, REFS.reading);
  assert.equal(after.data.sentences[1].mark, 'keep'); assert.equal(after.data.questions[0].answer, 'Sound only');
  assert.equal((await S.getArtifact(t.db, t.id, R.cast('ines'))).status, 'locked');
});

test('without a key the story is still read locally, so the wizard works offline', async () => {
  const t = await setup(null), r = await W.readStory(t.env, t.db, human, t.id);
  assert.equal(r.via, 'local'); assert.ok((await S.getArtifact(t.db, t.id, REFS.reading)).data.beats.length);
  await assert.rejects(W.readStory(t.env, t.db, agent, t.id), (e) => e.status === 403);
  const empty = await setup(null); await S.propose(empty.db, human, empty.id, { ref: REFS.story, data: { text: '  ' }, auto_approve: true });
  await assert.rejects(W.readStory(empty.env, empty.db, human, empty.id), (e) => e.status === 400);
});

test('scenes are drafted from the reading, then clips, pictures and a returned take follow the review order', async () => {
  const t = await setup(), calls = [], f = stand(calls);
  await W.readStory(t.env, t.db, human, t.id, f); await ok(t, REFS.reading); await ok(t, R.cast('ines')); await ok(t, R.place('cathedral-scaffold'));
  const d = await W.draftScenes(t.env, t.db, human, t.id, f); assert.deepEqual(d.made, ['scene:the-beam', 'scene:the-fall']);
  const sc = await S.getArtifact(t.db, t.id, 'scene:the-beam');
  assert.deepEqual([sc.data.seconds, sc.data.who, sc.data.place, sc.data.clips.map((c) => c.seconds), sc.data.transcript[0].who], [12, ['canon.cast:ines'], 'canon.world:place-cathedral-scaffold', [6, 6], 'INES']);
  await assert.rejects(W.makeFrame(t.env, t.db, human, t.id, { scene: 'the-beam', which: 'start' }, f), (e) => e.status === 409 && /look/i.test(e.message));
  await ok(t, REFS.look);
  await assert.rejects(W.makeFrame(t.env, t.db, human, t.id, { scene: 'the-beam', which: 'start' }, f), (e) => e.status === 409 && /brief/i.test(e.message));
  await ok(t, 'scene:the-beam');
  const fr = await W.makeFrame(t.env, t.db, human, t.id, { scene: 'the-beam', which: 'start' }, f);
  assert.equal(fr.ref, 'keyframe:the-beam-c1-start'); assert.match(fr.asset.uri, /^media\//);
  const kf = await S.getArtifact(t.db, t.id, fr.ref); assert.equal(kf.assets.length, 1); assert.equal(kf.assets[0].provenance.input.tag, 'start');
  assert.ok((await S.getArtifact(t.db, t.id, 'shot:the-beam-c2')), 'every clip has its shot');
  assert.equal((await S.budgetStatus(t.db, t.id)).spent, 1);
  await t.R2.put(`${t.id}/clip.mp4`, new Uint8Array([1]));
  const tk = await W.addTake(t.db, human, t.id, { scene: 'the-beam', clip: 1, uri: `media/${t.id}/clip.mp4`, first: 91, last: 74 });
  assert.equal(tk.ref, 'take:the-beam-c1-a'); const take = await S.getArtifact(t.db, t.id, tk.ref); assert.deepEqual([take.status, take.data.first, take.assets.length], ['approved', 91, 1]);
  await assert.rejects(W.addTake(t.db, human, t.id, { scene: 'the-beam', clip: 1, uri: 'https://x/y.mp4' }), (e) => e.status === 400);
});

const judged = (verdicts, prompts = []) => { const base = stand(); let i = 0; return async (url, init) => { if (url.endsWith('/responses') && /check ONE picture/.test(JSON.parse(init.body).instructions)) { const v = verdicts[Math.min(i++, verdicts.length - 1)]; return reply(msg(v)); } if (url.includes('/images/')) prompts.push(JSON.parse(init.body).prompt); return base(url, init); }; };
test('a picture that is not what was asked for is looked at and drawn again once with the correction; a check that cannot run lets it through', async () => {
  const t = await setup(); await W.readStory(t.env, t.db, human, t.id, stand());
  const prompts = [], wrong = { ok: false, major: true, seen: 'A man holding a toy penguin.', problem: 'It shows a man, not a penguin.' };
  let r = await W.makeFace(t.env, t.db, human, t.id, { id: 'ines' }, judged([wrong, wrong, { ok: true, seen: 'A woman.', problem: '' }], prompts));
  assert.deepEqual([r.check.ok, r.check.redrew], [true, true]); assert.equal(prompts.length, 2); assert.match(prompts[1], /Correction: It shows a man, not a penguin\./);
  assert.equal((await S.getArtifact(t.db, t.id, R.cast('ines'))).data.candidates[0].check.redrew, true, 'what the check saw is kept with the picture');
  r = await W.makeFace(t.env, t.db, human, t.id, { id: 'ines', variant: 1 }, judged([wrong, wrong])); assert.deepEqual([r.check.ok, r.check.redrew, r.check.problem], [false, true, 'It shows a man, not a penguin.']);
  r = await W.makeFace(t.env, t.db, human, t.id, { id: 'ines', variant: 0 }, judged([{ ok: false, major: false, seen: 'A woman.', problem: 'The coat is blue, not grey.' }])); assert.deepEqual([r.check.ok, r.check.major], [false, false], 'a small detail is noted, not treated as a stop');
  r = await W.makeFace(t.env, t.db, human, t.id, { id: 'ines', variant: 0 }, judged([{ ok: false, kind: 'detail', seen: 'A woman.', problem: 'There are too many bubbles.' }])); assert.deepEqual([r.check.ok, r.check.major], [false, false], 'a size or number that is a little off does not stop the run');
  r = await W.makeFace(t.env, t.db, human, t.id, { id: 'ines', variant: 0 }, judged([{ ok: false, kind: 'stage', seen: 'A plant.', problem: 'A plant stands where there should be bare soil.' }])); assert.equal(r.check.major, true, 'a thing at the wrong stage does');
  r = await W.makeFace(t.env, t.db, human, t.id, { id: 'ines', variant: 2 }, stand()); assert.equal(r.check.ok, true, 'an answer the check cannot read is not a failure'); assert.equal(r.check.skipped, true);
});
test('a face is made as a candidate and stored on the person; an unknown person or a missing key is explained', async () => {
  const t = await setup(), f = stand(); await W.readStory(t.env, t.db, human, t.id, f);
  const r = await W.makeFace(t.env, t.db, human, t.id, { id: 'ines', variant: 1, instruction: 'older' }, f);
  assert.equal(r.letter, 'B'); const p = await S.getArtifact(t.db, t.id, R.cast('ines')); assert.equal(p.data.candidates[0].letter, 'B'); assert.equal(p.assets.length, 1);
  await W.makeFace(t.env, t.db, human, t.id, { id: 'ines', variant: 1 }, f);
  assert.equal((await S.getArtifact(t.db, t.id, R.cast('ines'))).data.candidates.length, 1, 'making B again replaces B');
  await assert.rejects(W.makeFace(t.env, t.db, human, t.id, { id: 'nobody' }, f), (e) => e.status === 409);
  await assert.rejects(W.makeFace({ ...t.env, MODEL_API_KEY: undefined }, t.db, human, t.id, { id: 'ines' }, f), (e) => e.status === 503);
  const pl = await W.makePlate(t.env, t.db, human, t.id, { id: 'cathedral-scaffold' }, f); assert.ok(pl.asset.uri);
});

test('the model: clip plans, the prompt, review states and scene readiness', () => {
  assert.deepEqual(clipPlan(12).map((c) => c.seconds), [6, 6]); assert.deepEqual(clipPlan(10, 8).map((c) => c.seconds), [5, 5]); assert.deepEqual(clipPlan(7).map((c) => c.seconds), [7]); assert.equal(clipPlan(3, 8, [null, 'cut'])[0].join, null);
  assert.equal(clipPlan(20, 8, [null, 'cut'])[1].join, 'cut');
  const scene = { data: { seconds: 12, clips: clipPlan(12, 8, [null, 'cut']), notes: { happens: 'She looks up.', mood: 'dread', cam: 'push in', sound: 'creak', never: 'No collapse. No wristwatch', cont: 'first' }, transcript: [{ who: 'INES', text: 'Hallo', en: 'Hi' }] } };
  const a = composeClip(scene, { look: { look: 'Muted film', aspect: '9:16', fps: 24, forbidden: ['electric light'] }, speech: 'German' }, 1), b = composeClip(scene, { look: {} }, 2);
  assert.match(a.prompt, /She looks up\.\nMood and pace: dread\nCamera: push in/); assert.match(a.prompt, /INES says, in German, "Hallo" \(Hi\)/); assert.match(a.prompt, /6 seconds/);
  assert.equal(a.negative, 'No collapse. No wristwatch. no electric light'); assert.match(b.prompt, /cut to a new view/);
  assert.deepEqual([review(null).state, review({ status: 'proposed' }).state, review({ status: 'approved' }).state, review({ status: 'approved', stale: true }).state, review({ status: 'changes_requested' }).state], ['none', 'review', 'approved', 'review', 'change']);
  assert.deepEqual(counts([{ status: 'proposed' }, { status: 'approved' }, { status: 'rejected' }]), { review: 1, approved: 1, change: 1, none: 0, total: 3, open: 2 });
  const ctx = (m) => ({ get: (r) => m[r], assets: () => [] });
  const sc = { ref: 'scene:x', status: 'approved', data: { ...scene.data, start: { mode: 'stage' }, end: { mode: 'skip' } } };
  assert.deepEqual(sceneReadiness(sc, ctx({})).slice(0, 3), [2, 0, 0]);
  assert.notEqual(sceneReadiness(sc, ctx({ 'keyframe:x-c1-start': { data: { chosen: 'a1' } } }))[2], 2, 'the cut also needs its own start picture');
  assert.equal(sceneReadiness(sc, ctx({ 'keyframe:x-c1-start': { data: { chosen: 'a1' } }, 'keyframe:x-c2-start': { data: { chosen: 'a2' } } }))[2], 2);
});

test('three faces made at the same moment are all kept: a clash is retried, not lost or a 500', async () => {
  const t = await setup(), f = stand(); await W.readStory(t.env, t.db, human, t.id, f);
  await Promise.all([0, 1, 2].map((variant) => W.makeFace(t.env, t.db, human, t.id, { id: 'ines', variant }, f)));
  const p = await S.getArtifact(t.db, t.id, R.cast('ines')); assert.deepEqual(p.data.candidates.map((c) => c.letter).sort(), ['A', 'B', 'C']);
  await Promise.all([0, 1, 2].map(() => W.makePlate(t.env, t.db, human, t.id, { id: 'cathedral-scaffold' }, f)));
  assert.equal((await S.getArtifact(t.db, t.id, R.place('cathedral-scaffold'))).data.plates.length, 3);
});

test('revising one item: only the allowed text fields change, the feedback thread is answered, and the person is told when nothing changed', async () => {
  const t = await setup(), f = stand(); await W.readStory(t.env, t.db, human, t.id, f); await ok(t, REFS.reading);
  const f2 = async (url, init) => { if (url.endsWith('/responses') && /revise ONE item/.test(JSON.parse(init.body).instructions)) return reply(msg({ data: { summary: 'A widow warns of a collapse at the cathedral, and is ignored.', beats: [{ text: 'She measures the crack.' }, 'It falls at dawn.'], sentences: [], title: 'HACKED' }, note: 'Made the summary concrete.' })); return f(url, init); };
  const c = await S.addComment(t.db, human, t.id, { ref: REFS.reading, body: 'Too vague', verdict: 'change', anchor: 'part:summary' });
  const r = await W.reviseItem(t.env, t.db, human, t.id, { ref: REFS.reading, part: 'summary', instruction: 'Too vague' }, f2);
  assert.equal(r.changed, 2);
  const a = await S.getArtifact(t.db, t.id, REFS.reading);
  assert.deepEqual([a.version, a.status, a.author], [2, 'proposed', 'muse-spark']);
  assert.equal(a.data.summary, 'A widow warns of a collapse at the cathedral, and is ignored.'); assert.deepEqual(a.data.beats, [{ id: 'b1', text: 'She measures the crack.' }, { id: 'b2', text: 'It falls at dawn.' }]);
  assert.equal(a.data.title, 'The Beam', 'a field outside the allowed list is never taken'); assert.equal(a.data.sentences.length, 4, 'the sentences and the person\'s marks stay');
  const th = (await S.listComments(t.db, t.id, { ref: REFS.reading })).find((x) => x.id === c.id); assert.equal(th.status, 'addressed');
  await assert.rejects(W.reviseItem(t.env, t.db, human, t.id, { ref: REFS.reading, instruction: 'x' }, async (u, i) => (u.endsWith('/responses') ? reply(msg({ data: {}, note: '' })) : f(u, i))), (e) => e.status === 502 && /did not change anything/.test(e.message));
  await assert.rejects(W.reviseItem(t.env, t.db, human, t.id, { ref: 'logline:main' }, f), (e) => e.status === 400);
  await assert.rejects(W.reviseItem({ ...t.env, MODEL_API_KEY: undefined }, t.db, human, t.id, { ref: REFS.reading }, f), (e) => e.status === 503);
  await assert.rejects(W.reviseItem(t.env, t.db, agent, t.id, { ref: REFS.reading }, f), (e) => e.status === 403);
});

test('start and end pictures follow the film\'s shape, not always portrait', async () => {
  const t = await setup(), sizes = [], f0 = stand();
  const f = async (url, init) => { if (/images\//.test(url)) sizes.push(JSON.parse(init.body).size); return f0(url, init); };
  await W.readStory(t.env, t.db, human, t.id, f); await ok(t, REFS.reading); await ok(t, R.cast('ines')); await ok(t, R.place('cathedral-scaffold')); await ok(t, REFS.look);
  await W.draftScenes(t.env, t.db, human, t.id, f); await ok(t, 'scene:the-beam');
  await W.makeFrame(t.env, t.db, human, t.id, { scene: 'the-beam', which: 'start' }, f);
  const [w, h] = sizes.pop().split('x').map(Number); assert.ok(w < h, 'the sample film is 9:16, so portrait');
  const look = await S.getArtifact(t.db, t.id, REFS.look); await S.propose(t.db, human, t.id, { ref: REFS.look, data: { ...look.data, aspect: '16:9' }, auto_approve: true });
  await W.makeFrame(t.env, t.db, human, t.id, { scene: 'the-beam', which: 'end', clip: 2 }, f);
  const [w2, h2] = sizes.pop().split('x').map(Number); assert.ok(w2 > h2, 'a 16:9 film gets landscape pictures');
});

test('scene lengths stay between the bounds fixed on the Start page', async () => {
  const { sceneBounds, clampScene } = await import('../public/js/wizard-model.js');
  assert.deepEqual(sceneBounds({}), [4, 20]);
  assert.deepEqual(sceneBounds({ sceneMin: 10, sceneMax: 5 }), [10, 10]);
  assert.deepEqual([clampScene(1, { sceneMin: 5, sceneMax: 12 }), clampScene(99, { sceneMin: 5, sceneMax: 12 }), clampScene(8, { sceneMin: 5, sceneMax: 12 })], [5, 12, 8]);
});

test('a video model connects over MCP: list clips, read one, fetch its picture, bring a take back for review', async () => {
  const { handleMcp } = await import('../src/mcp.js'), t = await setup(), f = stand(), bot = { id: 'v1', name: 'videobot', kind: 'ai', role: 'agent' };
  await W.readStory(t.env, t.db, human, t.id, f); await ok(t, REFS.reading); await ok(t, R.cast('ines')); await ok(t, R.place('cathedral-scaffold'));
  await W.draftScenes(t.env, t.db, human, t.id, f); await ok(t, REFS.look); await ok(t, 'scene:the-beam');
  await W.makeFrame(t.env, t.db, human, t.id, { scene: 'the-beam', which: 'start' }, f);
  const kf = await S.getArtifact(t.db, t.id, 'keyframe:the-beam-c1-start'); await S.propose(t.db, human, t.id, { ref: kf.ref, data: { ...kf.data, chosen: kf.assets[0].id }, parent: 'shot:the-beam-c1', deps: [REFS.look], auto_approve: true }); // the person chooses the picture
  const files = new Map([[`${t.id}/clip.mp4`, new Uint8Array([1, 2, 3])]]);
  const env = { ...t.env, MEDIA: { ...t.R2, head: async (k) => (k.endsWith('.png') || k.includes('keyframe') ? { size: PNG.length, httpMetadata: { contentType: 'image/png' } } : null), get: async () => ({ arrayBuffer: async () => PNG }), put: async (k, b, o) => { files.set(k, b); } } };
  const post = (body, extra = {}) => handleMcp(new Request('https://mf.test/mcp', { method: 'POST', body: JSON.stringify(body), ...extra }), env, bot, async () => new Response(new Uint8Array([9, 9]), { headers: { 'content-type': 'video/mp4' } }));
  const call = async (name, args) => { const r = await (await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { production: t.id, ...args } } })).json(); return r.result; };
  const init = await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json();
  assert.equal(init.result.protocolVersion, '2025-06-18');
  const batch = await (await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'prompts/list' }])).json();
  assert.deepEqual(batch.map((x) => x.id), [1, 2]);
  assert.equal((await post('{nope')).status, 400);
  const list = (await call('list_clips', {})).structuredContent.items;
  assert.deepEqual(list.filter((c) => c.scene === 'the-beam').map((c) => [c.clip, c.of, c.seconds, c.start_picture, c.end_picture]), [[1, 2, 6, true, false], [2, 2, 6, false, false]]);
  const clip = (await call('get_clip', { scene: 'the-beam', clip: 1 })).structuredContent;
  assert.match(clip.prompt, /Dialogue/); assert.equal(clip.aspect, '9:16'); assert.match(clip.start_picture.url, /^https:\/\/mf\.test\/api\/p\/.+\/media\//);
  assert.equal((await call('get_clip', { scene: 'the-beam', clip: 9 })).isError, true);
  assert.equal((await call('get_clip', { scene: 'the-beam' })).isError, undefined);
  const gen = (await call('get_clip', { scene: 'the-beam', clip: 1, generator: 'minimax-h3' })).structuredContent; assert.equal(gen.generator.id, 'minimax-h3'); assert.equal(gen.negative_prompt, '');
  assert.ok((await call('list_generators', {})).structuredContent.generators.some((g) => g.id === 'minimax-h3'));
  const img = await call('get_media', { uri: clip.start_picture.uri }); assert.equal(img.content[0].type, 'image');
  assert.equal((await call('submit_take', { scene: 'the-beam' })).isError, true, 'clip is required');
  const r = (await call('submit_take', { scene: 'the-beam', clip: 1, url: 'https://gen.test/a.mp4', seed: 42, hold: 2.5, cuts: 1, smooth: { median: 5, max: 60, at: 3, flag: true }, note: 'first try' })).structuredContent;
  assert.equal(r.ref, 'take:the-beam-c1-a'); assert.match(r.uri, new RegExp(`^media/${t.id}/take-`));
  const take = await S.getArtifact(t.db, t.id, r.ref); assert.deepEqual([take.status, take.author, take.assets.length, take.assets[0].provenance.generator], ['proposed', 'videobot', 1, 'videobot']);
  assert.equal((await call('submit_take', { scene: 'the-beam', clip: 1, url: 'http://gen.test/a.mp4' })).isError, true, 'https only');
  assert.equal((await call('get_clip', { scene: 'the-beam', clip: 1 })).structuredContent.takes[0].status, 'proposed');
  assert.deepEqual([take.data.seed, take.data.hold, take.data.cuts, take.data.smooth.flag], [42, 2.5, 1, true]);
  const again = (await call('get_clip', { scene: 'the-beam', clip: 1 })).structuredContent;
  assert.deepEqual([again.takes[0].seed, again.takes[0].cuts, again.retry.attempt, again.retry.try_again], [42, 1, 2, true]); assert.match(again.retry.add_to_prompt, /continuous shot/);
  assert.ok(['low', 'medium', 'high'].includes(again.risk)); assert.ok(Array.isArray(again.voices.speakers)); assert.deepEqual(again.dialogue_load.warnings, []); assert.equal(again.retry.max_attempts, { low: 2, medium: 3, high: 4 }[again.risk]);
});
test('a one-off "model was not found" from Meta is tried again, a real failure is not hidden', async () => {
  const { spark } = await import('../src/meta.js'); let n = 0;
  const flaky = async () => (++n === 1 ? new Response(JSON.stringify({ error: { message: 'The requested model was not found.' } }), { status: 404 }) : reply({ output_text: 'ok' }));
  assert.equal((await spark({ MODEL_API_KEY: 'k' }, { input: 'hi' }, flaky)).output_text, 'ok'); assert.equal(n, 2);
  const gone = async () => new Response(JSON.stringify({ error: { message: 'The requested model was not found.' } }), { status: 404 });
  await assert.rejects(spark({ MODEL_API_KEY: 'k', MODEL_SPARK: 'nope' }, { input: 'hi' }, gone), /404/);
});

test('the continuity review corrects the states of a scene that skips a stage, and leaves the rest', async () => {
  const mk = (n, states) => ({ n, name: `S${n}`, time: 'day', notes: { happens: 'x' }, props: [{ name: 'plant', look: 'a green plant' }], states });
  const scenes = [mk(1, ['Soil.', 'Soil with a seed.']), mk(2, ['Soil with a seed.', 'A huge carrot.'])];
  const f = async (url, init) => reply(msg({ issues: [{ scene: 2, problem: 'The seed becomes a huge carrot in one clip.' }], fixes: [{ scene: 2, states: ['Soil with a seed.', 'A small green sprout.'] }, { scene: 1, states: ['too few'] }] }));
  const r = await W.reviewContinuity({ MODEL_API_KEY: 'k' }, scenes, f);
  assert.equal(r.fixed, 1); assert.deepEqual(scenes[1].states, ['Soil with a seed.', 'A small green sprout.']); assert.deepEqual(scenes[0].states, ['Soil.', 'Soil with a seed.'], 'a fix of the wrong length is ignored');
  assert.equal(r.issues[0].scene, 2);
  assert.deepEqual(await W.reviewContinuity({ MODEL_API_KEY: 'k' }, [mk(1, [])], f), { issues: [], fixed: 0 }, 'nothing to review');
  assert.deepEqual(await W.reviewContinuity({ MODEL_API_KEY: 'k' }, scenes, async () => reply({ error: { message: 'x' } }, 500)), { issues: [], fixed: 0 }, 'a review that cannot run never blocks the scenes');
});

test('the clip review reads frames against what was asked, and never blocks when it cannot run', async () => {
  const { reviewFrames } = await import('../src/takereview.js'); const frames = ['QUJD', 'QUJE', 'QUJF'];
  const f = async (url, init) => { const b = JSON.parse(init.body); assert.equal(b.input[0].content.filter((c) => c.type === 'input_image').length, 3); return reply(msg({ ok: false, seen: 'A bottle that stays closed.', issues: [{ kind: 'physics', problem: 'She blows through a closed bottle.', frames: '1 to 3' }], advice: 'The bottle is open, cap off.' })); };
  const r = await reviewFrames({ MODEL_API_KEY: 'k' }, { frames, asked: 'x' }, f); assert.deepEqual([r.ok, r.issues[0].kind, r.advice], [false, 'physics', 'The bottle is open, cap off.']);
  assert.equal((await reviewFrames({ MODEL_API_KEY: 'k' }, { frames: ['QUJD'], asked: 'x' }, f)).skipped, true, 'one frame is not a clip');
  assert.equal((await reviewFrames({ MODEL_API_KEY: 'k' }, { frames, asked: 'x' }, async () => reply({}, 400))).ok, true);
});
test('a picture that fails once is looked at again, and one bad look does not fail it; a wrong picture is redrawn up to twice', async () => {
  const t = await setup(); await W.readStory(t.env, t.db, human, t.id, stand()); const wrong = { ok: false, kind: 'stage', seen: 'A sprout.', problem: 'A sprout is growing.' }, right = { ok: true, seen: 'Flat soil.', problem: '' };
  let prompts = []; let r = await W.makeFace(t.env, t.db, human, t.id, { id: 'ines' }, judged([wrong, right], prompts)); assert.deepEqual([r.check.ok, r.check.redrew], [true, false], 'the second look agreed it was fine: no redraw'); assert.equal(prompts.length, 1);
  prompts = []; r = await W.makeFace(t.env, t.db, human, t.id, { id: 'ines', variant: 1 }, judged([wrong, wrong, wrong, wrong, right, right], prompts)); assert.deepEqual([r.check.ok, r.check.redrew], [true, true]); assert.equal(prompts.length, 3, 'two redraws at most');
});
test('the clip review answers a checklist and scores, and two takes can be compared', async () => {
  const { reviewFrames, reviewPair } = await import('../src/takereview.js'); const frames = ['QUJD', 'QUJE', 'QUJF'], list = ['Does the first frame match this: a', 'Is there exactly 1 seed in every frame where it is visible?'];
  const f = async () => reply(msg({ ok: true, seen: 'x', issues: [], advice: '', scores: { quality: 4, match: 3, physics: 9 }, answers: [{ n: 1, yes: true, note: '' }, { n: 2, yes: false, note: 'three seeds in frame 3' }] }));
  const r = await reviewFrames({ MODEL_API_KEY: 'k' }, { frames, asked: 'x', checklist: list }, f);
  assert.equal(r.ok, false, 'a no answer is a fault even when the judge said ok'); assert.equal(r.issues[0].kind, 'count'); assert.match(r.issues[0].problem, /three seeds in frame 3/); assert.deepEqual(r.scores, { quality: 4, match: 3, physics: null }, 'a score out of range is dropped');
  const p = await reviewPair({ MODEL_API_KEY: 'k' }, { framesA: frames, framesB: frames, asked: 'x' }, async () => reply(msg({ winner: 'B', reason: 'A has a closed bottle.', a_problems: ['closed bottle'], b_problems: [] })));
  assert.deepEqual([p.winner, p.a_problems], ['B', ['closed bottle']]); assert.equal((await reviewPair({ MODEL_API_KEY: 'k' }, { framesA: ['QUJD'], framesB: frames }, f)).skipped, true);
  assert.equal((await reviewPair({ MODEL_API_KEY: 'k' }, { framesA: frames, framesB: frames }, async () => reply({}, 400))).winner, 'tie', 'a comparison that cannot run never blocks');
});
