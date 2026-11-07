// Roll camera: what to do next, from the state of the studio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, remaining, estimate, describe, pageOf } from '../public/js/w-auto-pure.js';
import { R, REFS, clipPlan } from '../public/js/wizard-model.js';

const mk = (list) => { const arts = list.map((a) => ({ status: 'approved', stale: false, assets: [], ...a })); return { arts, by: Object.fromEntries(arts.map((a) => [a.ref, a])) }; };
const story = { ref: REFS.story, kind: 'logline', data: { text: 'A station AI must ask first.' } };
const bible = { ref: REFS.reading, kind: 'bible', data: {} };
const look = { ref: REFS.look, kind: 'canon.style', data: { look: 'soft' } };
const cast = (id, o = {}) => ({ ref: R.cast(id), kind: 'canon.cast', data: { name: id.toUpperCase(), candidates: [], anchor: null, ...o } });
const place = (id, o = {}) => ({ ref: R.place(id), kind: 'canon.world', data: { name: id, plates: [], source: 'none', ...o } });
const scene = (id, n, o = {}) => ({ ref: R.scene(id), kind: 'scene', data: { n, name: 'S' + n, seconds: 8, clips: clipPlan(8), start: { mode: 'stage' }, end: { mode: 'stage' }, ...o } });

test('it waits for a story, then reads it', () => {
  assert.equal(plan(mk([])).type, 'blocked'); assert.equal(plan(mk([{ ...story, data: { text: '  ' } }])).type, 'blocked');
  assert.equal(plan(mk([story])).type, 'read');
});
test('what the AI made is approved first, in one move, but only the wizard\'s own kinds', () => {
  const a = plan(mk([story, bible, look, { ...cast('ines'), status: 'proposed' }, { ...place('lab'), status: 'proposed' }, { ref: 'canon.world:world', kind: 'canon.world', status: 'proposed', data: {} }, { ref: 'reference:m-1', kind: 'reference', status: 'proposed', data: {} }]));
  assert.deepEqual([a.type, a.refs], ['approve', [R.cast('ines'), R.place('lab')]]);
});
test('faces, then main faces, then places, then scenes, in that order, one at a time', () => {
  const base = [story, bible, look];
  assert.deepEqual(plan(mk([...base, cast('ines'), cast('orca')])), { type: 'face', id: 'ines', name: 'INES', cost: 1 });
  const faced = (id, a) => cast(id, { candidates: [{ id: 'a-' + id, letter: 'A' }], anchor: a ? 'a-' + id : null });
  assert.deepEqual(plan(mk([...base, faced('ines', true), cast('orca')])), { type: 'face', id: 'orca', name: 'ORCA', cost: 1 });
  assert.deepEqual(plan(mk([...base, faced('ines', true), faced('orca', false)])), { type: 'anchor', ref: R.cast('orca'), name: 'ORCA', assetId: 'a-orca' });
  const ready = [...base, faced('ines', true), place('lab'), place('mine', { source: 'photo' })];
  assert.deepEqual(plan(mk(ready)), { type: 'plate', id: 'lab', name: 'lab', cost: 1 }, 'a place the person gave a photo for is left alone');
  assert.equal(plan(mk([...base, faced('ines', true), place('lab', { plates: [{ id: 'p' }] })])).type, 'scenes');
});
test('each scene: its stage, then each picture it needs, made and then put in use', () => {
  const canon = [story, bible, look, cast('ines', { candidates: [{ id: 'f' }], anchor: 'f' }), place('lab', { plates: [{ id: 'p' }] })];
  assert.deepEqual(plan(mk([...canon, scene('one', 1)])), { type: 'stage', scene: 'one', name: 'S1', n: 1 });
  const st = { ref: R.stage('one'), kind: 'stage', data: {} };
  const f1 = plan(mk([...canon, scene('one', 1), st])); assert.deepEqual([f1.type, f1.ref, f1.which, f1.clip], ['frame', R.frame('one', 1, 'start'), 'start', 1]);
  const kf = (which, o = {}) => ({ ref: R.frame('one', 1, which), kind: 'keyframe', data: { chosen: null }, ...o });
  const p1 = plan(mk([...canon, scene('one', 1), st, kf('start', { assets: [{ id: 'x1', mime: 'image/png' }, { id: 'x2', mime: 'image/png' }] })])); assert.deepEqual([p1.type, p1.assetId], ['pick', 'x2']);
  const done1 = kf('start', { data: { chosen: 'x2' } }), f2 = plan(mk([...canon, scene('one', 1), st, done1])); assert.deepEqual([f2.type, f2.which], ['frame', 'end']);
  assert.equal(plan(mk([...canon, scene('one', 1), st, done1, kf('end', { data: { chosen: 'y' } })])).type, 'done');
  assert.deepEqual(plan(mk([...canon, scene('b', 2), scene('one', 1)])).scene, 'one', 'scenes go in story order');
  assert.equal(plan(mk([...canon, scene('one', 1, { start: { mode: 'skip' }, end: { mode: 'chain' } }), st])).type, 'done', 'skipped and carried-over pictures need nothing');
  assert.equal(plan(mk([...canon, { ...scene('one', 1), status: 'proposed' }])).type, 'approve');
});
test('how much is left and what it costs', () => {
  assert.equal(remaining(mk([story])), 14); assert.deepEqual(estimate(mk([story])), { credits: 16, rough: true });
  const canon = [story, bible, look, cast('ines', { candidates: [{ id: 'f' }], anchor: 'f' }), cast('orca'), place('lab')];
  assert.deepEqual(estimate(mk([...canon, scene('one', 1), scene('two', 2)])), { credits: 2 + 4, rough: false }, 'a face, a plate, and two pictures for each of two scenes');
  assert.ok(remaining(mk([...canon, scene('one', 1)])) > remaining(mk([...canon, scene('one', 1), { ref: R.stage('one'), kind: 'stage', data: {} }])), 'it shrinks as work is done');
  assert.deepEqual(estimate(mk([story, bible, look, cast('a', { candidates: [{ id: 'f' }], anchor: 'f' })])), { credits: 0 + 9, rough: true }, 'before the scenes exist it guesses');
});
test('every move has plain words and a page', () => {
  for (const a of [{ type: 'read' }, { type: 'approve', refs: [R.cast('x')] }, { type: 'face', name: 'Ines' }, { type: 'plate', name: 'Lab' }, { type: 'scenes' }, { type: 'stage', scene: 's', name: 'N', n: 1 }, { type: 'frame', scene: 's', which: 'end', name: 'N', n: 2 }, { type: 'done' }]) { const t = describe(a); assert.ok(t.title.length > 5 && t.sub.length > 5, a.type); assert.match(pageOf(a), /^#\/w\//); }
  assert.equal(pageOf({ type: 'frame', scene: 'the-crack', which: 'start', name: 'x', n: 1 }), '#/w/scenes/the-crack/pictures');
  assert.equal(pageOf({ type: 'approve', refs: [REFS.look] }), '#/w/look'); assert.equal(pageOf({ type: 'anchor', name: 'x' }), '#/w/people'); assert.equal(pageOf({ type: 'done' }), '#/w/ship');
});
