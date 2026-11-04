// Pure helpers behind the wizard's Stage and Pictures pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starterStage, camFor, nudgeStage, slotsOf, plainError } from '../public/js/w-stage-pure.js';
import { checkStage } from '../public/js/stage-math.js';

const d = { who: ['canon.cast:a', 'canon.cast:b'], place: 'p', notes: { happens: 'A beam creaks.', cam: 'slow push-in' }, clips: [{ seconds: 6, join: null }, { seconds: 6, join: 'cont' }], seconds: 12 };
test('starter stage is valid and the end of the move differs from the start', () => {
  const s = starterStage('x', d, () => ({ anchor: 'img' }), () => ({ must_keep: [] }));
  assert.deepEqual(checkStage(s, { aspect: '9:16', cast: d.who }).map((c) => c.lvl), ['ok']);
  assert.deepEqual(Object.keys(s.shots), ['shot:x-c1', 'shot:x-c2']);
  assert.notDeepEqual(camFor(s, 'x', 1, 'start').pos, camFor(s, 'x', 1, 'end').pos);
});
test('nudge moves a person by 0.2 m per click', () => {
  const s = starterStage('x', d, () => ({}), () => ({})), z = s.characters[0].pos[2];
  assert.ok(nudgeStage(s, 'obj:a', { dx: 2, dz: -1 })); assert.equal(s.characters[0].pos[2], Math.round((z - 0.2) * 100) / 100);
  assert.equal(nudgeStage(s, 'obj:nobody', { dx: 1 }), false);
});
test('slots: start of clip 1, cuts, end of the last clip', () => {
  assert.deepEqual(slotsOf('x', d).map((s) => s.ref), ['keyframe:x-c1-start', 'keyframe:x-c2-end']);
  assert.equal(slotsOf('x', { ...d, clips: [{ seconds: 6 }, { seconds: 6, join: 'cut' }] }).length, 3);
});
test('plain errors', () => {
  assert.match(plainError('Approve the look (step 3) first.', 'x').href, /look/);
  assert.match(plainError('Approve the scene brief first, so', 'x').href, /brief/);
  assert.match(plainError('over budget for production: ask', 'x').text, /credit budget/);
  assert.match(plainError('MODEL_API_KEY is not set', 'x').text, /not available/);
});

test('floor plan: what can be grabbed, what is nearest, and where things end up', async () => {
  const { planItems, planBounds, planHit, moveTo, setCamera, snap } = await import('../public/js/w-stage-pure.js');
  const stage = { set: [{ id: 'beam', name: 'Main beam', type: 'prop', pos: [0, 2, -1.6] }, { id: 'lamp', type: 'light', pos: [3, 3, 0] }], characters: [{ id: 'ines', pos: [-0.5, 0, 0.2] }, { id: 'vale', pos: [0.6, 0, 0] }],
    cameras: { A: { lens: 35, pos: [0, 1.4, 4.6], target: [0, 1.2, 0], move: { type: 'push-in', seconds: 6 } } } };
  const items = planItems(stage);
  assert.deepEqual(items.map((i) => i.id), ['ines', 'vale', 'beam', 'cam-A', 'aim-A'], 'lights are not grabbed');
  const b = planBounds(stage); assert.ok(b.x1 - b.x0 >= 6 && b.z1 - b.z0 >= 6 && b.z1 >= 4.6 && b.z0 <= -1.6);
  assert.equal(planHit(items, -0.45, 0.25).id, 'ines'); assert.equal(planHit(items, 0, 4.5).id, 'cam-A'); assert.equal(planHit(items, 2, 2), null);
  assert.equal(planHit(items, 0.02, 0.0).id, 'aim-A', 'the camera\'s aim handle wins over a person standing on it');
  assert.equal(snap(1.037), 1.05);
  assert.ok(moveTo(stage, items[0], -1.234, 0.9) && stage.characters[0].pos.join() === '-1.25,0,0.9');
  assert.ok(moveTo(stage, items[2], 1, -1) && stage.set[0].pos.join() === '1,2,-1', 'only the floor position changes, not the height');
  moveTo(stage, items[3], 1, 5); assert.deepEqual([stage.cameras.A.pos, stage.cameras.A.target], [[1, 1.4, 5], [0, 1.2, 0]]);
  moveTo(stage, items[4], -2, 0.5); assert.deepEqual(stage.cameras.A.target, [-2, 1.2, 0.5]);
  stage.cameras.A.move.to = [1, 1.4, 3]; moveTo(stage, items[3], 2, 6); assert.deepEqual(stage.cameras.A.move.to, [2, 1.4, 4]);
  assert.equal(moveTo(stage, { kind: 'char', id: 'nobody' }, 0, 0), false);
  assert.ok(setCamera(stage, 'A', { lens: 50, move: 'orbit' }) && stage.cameras.A.lens === 50 && stage.cameras.A.move.type === 'orbit' && !stage.cameras.A.move.to);
  assert.equal(setCamera(stage, 'A', { lens: 33 }), false); assert.equal(setCamera(stage, 'A', { move: 'spin' }), false); assert.equal(setCamera(stage, 'Z', { lens: 50 }), false);
});
