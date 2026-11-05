// Roll camera on the server: it does every step and approves it, a few moves at a time, and carries on from where the work really is. Meta is replaced by a stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, human } from './d1.js';
import * as S from '../src/store.js';
import * as AP from '../src/autopilot.js';
import { REFS } from '../public/js/wizard-model.js';

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

const stand = async (url, init) => {
  if (url.endsWith('/responses')) { const b = JSON.parse(init.body); return reply(msg(/read a story/.test(b.instructions) ? READ : SCENES)); }
  return reply({ output_format: 'png', data: [{ b64_json: PNG.toString('base64') }] });
};
const realFetch = globalThis.fetch;
async function setup(budget) {
  const db = makeDb(), { id } = await S.createProduction(db, human, { name: 'Run', format: 'movie', budget }), env = { DB: db, MEDIA: fakeR2(), MODEL_API_KEY: 'LLM_x' };
  await S.propose(db, human, id, { ref: REFS.story, data: { text: 'Kestrel Station, 2089. The cathedral rises. Ines knows it will fail. Nobody listens.', format: { seconds: 20, aspect: '9:16', speech: 'German' } }, auto_approve: true });
  return { db, id, env };
}
const drive = async (t, rounds = 40) => { for (let i = 0; i < rounds; i++) { await AP.runOnce(t.env, t.id); const s = await AP.status(t.db, t.id); if (s.status !== 'running') return s; } return AP.status(t.db, t.id); };

test('it needs a story, then does every step by itself, a few moves each time, and approves as the person who started it', async () => {
  globalThis.fetch = stand; try {
    const empty = makeDb(), { id: e } = await S.createProduction(empty, human, { name: 'E', format: 'movie', budget: 5 });
    await assert.rejects(AP.start({ DB: empty }, empty, human, e, null), /story/i);
    const t = await setup(60); const s0 = await AP.start(t.env, t.db, human, t.id, null); assert.equal(s0.status, 'running'); assert.ok(s0.left > 5);
    await AP.runOnce(t.env, t.id); const s1 = await AP.status(t.db, t.id); assert.equal(s1.status, 'running', 'a few moves, then it lets go'); assert.ok(s1.done >= 1 && s1.done <= 7);
    const end = await drive(t); assert.equal(end.status, 'done', end.err); assert.match(end.log[0].text, /All done/); assert.ok(end.done > 8 && end.finished > 0);
    const arts = await S.listArtifacts(t.db, t.id, {});
    const kf = arts.filter((a) => a.kind === 'keyframe' && a.data.chosen); assert.ok(kf.length >= 2, 'start and end pictures are in use');
    const ev = (await t.db.prepare("SELECT COUNT(*) n FROM events WHERE production=? AND action='approve' AND comment LIKE '%Roll camera%'").bind(t.id).first()).n; assert.ok(ev >= 3, 'approvals are recorded as Roll camera');
    assert.ok((await S.budgetStatus(t.db, t.id)).spent > 0 && (await S.budgetStatus(t.db, t.id)).remaining >= 0);
    const again = await AP.start(t.env, t.db, human, t.id, null); assert.equal(again.status, 'running', 'it can be rolled again'); assert.equal(again.done, 0);
  } finally { globalThis.fetch = realFetch; }
});

test('a stopped run does nothing more; two workers cannot run the same production at once', async () => {
  globalThis.fetch = stand; try {
    const t = await setup(60); await AP.start(t.env, t.db, human, t.id, null);
    await Promise.all([AP.runOnce(t.env, t.id), AP.runOnce(t.env, t.id)]); const a = await AP.status(t.db, t.id); assert.ok(a.done >= 1 && a.done <= 7, 'only one of them held the lease');
    await AP.stop(t.db, t.id); const s = await AP.status(t.db, t.id); assert.equal(s.status, 'paused');
    await AP.runOnce(t.env, t.id); assert.equal((await AP.status(t.db, t.id)).done, s.done, 'paused means nothing more is done');
    await AP.start(t.env, t.db, human, t.id, null); assert.equal((await AP.status(t.db, t.id)).done, s.done, 'resume keeps what was counted');
  } finally { globalThis.fetch = realFetch; }
});

test('when the credits run out it pauses with a plain message and keeps everything made; the cron tick picks up what is running', async () => {
  globalThis.fetch = stand; try {
    const t = await setup(3); await AP.start(t.env, t.db, human, t.id, null); const end = await drive(t);
    assert.equal(end.status, 'paused'); assert.match(end.err, /credits for this production are used up/); assert.ok((await S.listArtifacts(t.db, t.id, {})).length > 3);
    await S.grantBudget(t.db, human, t.id, { add: 60 }); await AP.start(t.env, t.db, human, t.id, null);
    await AP.tick(t.env); assert.ok((await AP.status(t.db, t.id)).done > end.done, 'a tick carries on without anyone holding the page');
    const done = await drive(t); assert.equal(done.status, 'done', done.err);
  } finally { globalThis.fetch = realFetch; }
});
