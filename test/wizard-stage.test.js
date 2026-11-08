// Pure helpers behind the wizard's Stage and Pictures pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starterStage, camFor, nudgeStage, slotsOf, plainError } from '../public/js/w-stage-pure.js';
import { startOf, pictureCount, composeClip, oneMove, forGenerator } from '../public/js/wizard-model.js';
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
test('slots: start of clip 1, a start after a cut, and an end for every clip', () => {
  assert.deepEqual(slotsOf('x', d).map((s) => s.ref), ['keyframe:x-c1-start', 'keyframe:x-c1-end', 'keyframe:x-c2-end'], 'clip 2 starts from the end picture of clip 1, so it has no start picture of its own');
  assert.deepEqual(slotsOf('x', { ...d, clips: [{ seconds: 6 }, { seconds: 6, join: 'cut' }] }).map((s) => s.ref), ['keyframe:x-c1-start', 'keyframe:x-c1-end', 'keyframe:x-c2-start', 'keyframe:x-c2-end']);
  assert.deepEqual(slotsOf('x', { ...d, end: { mode: 'skip' } }).map((s) => [s.ref, s.mode]), [['keyframe:x-c1-start', 'stage'], ['keyframe:x-c1-end', 'skip'], ['keyframe:x-c2-end', 'skip']], 'skipping end pictures skips them for every clip');
  assert.equal(slotsOf('x', { ...d, clips: [{ seconds: 6 }] }).length, 2);
});
test('ends: last keeps only the scene end, so a middle clip carries on from the last frame and costs less', () => {
  const c = { ...d, ends: 'last' };
  assert.deepEqual(slotsOf('x', c).map((s) => [s.ref, s.mode]), [['keyframe:x-c1-start', 'stage'], ['keyframe:x-c1-end', 'skip'], ['keyframe:x-c2-end', 'stage']]);
  assert.equal(startOf(c, 2), 'prev-frame'); assert.equal(startOf(d, 2), 'prev-end');
  assert.equal(pictureCount('x', c), 2); assert.equal(pictureCount('x', d), 3);
  assert.match(composeClip({ data: c }, {}, 1).prompt, /do not freeze at the end/); assert.match(composeClip({ data: c }, {}, 2).prompt, /reach the end picture on the very last frame/);
});
test('a clip gets one camera move, an English line has no repeated gloss, and a generator without a negative prompt gets it in the words', () => {
  assert.equal(oneMove('Close handheld shots of hands, pages, then her face'), 'Close handheld shot of hands, pages');
  assert.equal(oneMove('Over shoulder to wide sea, then hard zoom to tiny blinking dot'), 'Over shoulder to wide sea');
  assert.equal(oneMove('slow push-in'), 'slow push-in'); assert.equal(oneMove(''), '');
  const sc = { data: { seconds: 6, notes: { happens: 'A speaks.', cam: 'static wide, then cut to a close-up', never: 'no crowds' }, transcript: [{ who: 'A', text: 'Hello there.', en: 'Hello there.', sec: 2 }, { who: 'A', text: 'Hallo.', en: 'Hello.', sec: 2 }] } };
  const p = composeClip(sc, { speech: 'German' }, 1).prompt;
  assert.match(p, /Camera: static wide, the camera holds still, one continuous shot/); assert.doesNotMatch(p, /close-up/); assert.match(p, /"Hello there\."(?! \()/); assert.match(p, /"Hallo\." \(Hello\.\)/);
  const g = forGenerator(composeClip(sc, {}, 1), 'minimax-h3'); assert.match(g.prompt, /Do not show: no crowds/); assert.equal(g.negative, ''); assert.equal(g.generator.id, 'minimax-h3');
  assert.equal(forGenerator(composeClip(sc, {}, 1), 'nope').generator.id, 'generic'); assert.equal(forGenerator(composeClip(sc, {}, 1), 'constructor').generator.id, 'generic');
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
import { mediumOf, beingOf, isDrawn } from '../public/js/wizard-model.js';
test('a cartoon look gives an illustration, and an animal is a character, not a person', () => {
  assert.equal(mediumOf({ look: 'Round 3D shapes in soft pastel colors with warm sunny light' }), 'illustration');
  assert.equal(mediumOf({ look: 'Muted film, fine grain, natural light' }), 'photograph'); assert.equal(isDrawn({ look: 'Hand-drawn storybook' }), true); assert.equal(mediumOf({}), 'photograph');
  assert.equal(beingOf('A chubby baby penguin with a black back and a red knitted hat'), 'creature');
  assert.equal(beingOf('A tiny baby polar bear cub with big eyes'), 'creature');
  assert.equal(beingOf('A 30-year-old woman with a braid, walking her dog'), 'person');
  assert.equal(beingOf('An 80-year-old man with a thick white beard'), 'person'); assert.equal(beingOf(''), 'person'); for (const d of ['A small green frog sitting on a lily pad', 'A baby hedgehog with a round brown body', 'A slow old tortoise with round glasses', 'A baby elephants with big ears']) assert.equal(beingOf(d), 'creature', d);
});
import { clipStates, propsOf } from '../public/js/wizard-model.js';
test('a clip is asked for from states: how it begins, how it ends, and how each tracked thing looks', () => {
  const sc = { data: { seconds: 12, clips: [{ seconds: 6 }, { seconds: 6 }], notes: { happens: 'Mimi digs and plants.' }, states: ['Bare soil, Mimi kneels with the seed in her paw.', 'A small hole in the soil, the seed still in her paw.', 'Flat soil, the seed buried, no plant.'], props: [{ name: 'seed', look: 'a tiny orange seed the size of a pea' }] } };
  assert.deepEqual(clipStates(sc.data), sc.data.states); assert.equal(propsOf(sc.data).length, 1);
  const p1 = composeClip(sc, {}, 1).prompt, p2 = composeClip(sc, {}, 2).prompt;
  assert.match(p1, /It begins like this: Bare soil, Mimi kneels/); assert.match(p1, /It ends like this, and nothing further happens: A small hole/); assert.match(p2, /It begins like this: A small hole/); assert.match(p2, /It ends like this[^\n]*Flat soil, the seed buried, no plant\./);
  assert.match(p1, /Things in this scene \(always look exactly like this[^)]*\): seed: a tiny orange seed the size of a pea/);
  assert.ok(p1.indexOf('It begins like this') < p1.indexOf('Look:'), 'the states come before the look line');
  assert.equal(clipStates({ ...sc.data, states: ['only one'] }), null, 'a list of the wrong length is ignored'); assert.doesNotMatch(composeClip({ data: { ...sc.data, states: [], props: [] } }, {}, 1).prompt, /It begins like this|Things in this scene/);
});
import { propsInClip } from '../public/js/wizard-model.js';
test('only the things really in view are named in a clip, so a generator is not told about a plant that is not there yet', () => {
  const d = { seconds: 12, clips: [{ seconds: 6 }, { seconds: 6 }], states: ['Mimi kneels by soft soil holding a tiny orange seed.', 'A small hole in the soil, Mimi holds the seed above it.', 'Flat brown soil, Mimi sits back, no carrot plant yet.'], props: [{ name: 'tiny orange seed', look: 'a seed' }, { name: 'carrot plant', look: 'a plant' }] };
  assert.deepEqual(propsInClip(d, 1).map((p) => p.name), ['tiny orange seed']); assert.deepEqual(propsInClip(d, 2).map((p) => p.name), ['tiny orange seed'], 'the seed is in view at the start of clip 2; the plant is named only to say it is absent');
  assert.doesNotMatch(composeClip({ data: d }, {}, 2).prompt, /carrot plant: a plant/);
});
import { movesOf, PHYSICS } from '../public/js/wizard-model.js';
test('a clip carries how it moves, the physics rules, and the exact count of a thing', () => {
  const sc = { data: { seconds: 12, clips: [{ seconds: 6 }, { seconds: 6 }], notes: { happens: 'x' }, moves: ['She scoops soil sideways with both front paws.', 'She opens the bottle, then blows through the wand.'], states: ['a', 'b', 'c'], props: [{ name: 'seed', look: 'a pea-sized orange seed', count: 1 }] } };
  assert.deepEqual(movesOf(sc.data), sc.data.moves); assert.deepEqual(movesOf({ ...sc.data, moves: ['only one'] }), []);
  const p = composeClip({ data: { ...sc.data, states: ['a seed in her paw', 'a seed in the soil', 'flat soil'] } }, {}, 2).prompt;
  assert.match(p, /How it moves: She opens the bottle, then blows through the wand\./); assert.ok(p.includes(PHYSICS)); assert.match(p, /seed: a pea-sized orange seed \(exactly 1\)/);
  assert.doesNotMatch(composeClip({ data: { ...sc.data, moves: [] } }, {}, 1).prompt, /How it moves/);
});
test('the medium follows the chosen look option, not only the look text', () => {
  assert.equal(mediumOf({ look: 'Smooth round shapes with soft pastel colours', options: [{ id: 'l1', name: 'Soft 3D Cartoon', desc: 'Smooth round shapes' }], chosen: 'l1' }), 'illustration');
  assert.equal(mediumOf({ look: 'Muted film', options: [{ id: 'l1', name: 'Muted film' }], chosen: 'l1' }), 'photograph');
});

test('with a start picture the words do not describe the characters again', () => {
  const sc = { data: { seconds: 6, notes: { happens: 'x' }, who: ['canon.cast:mimi'] } }, film = { cast: { 'canon.cast:mimi': { name: 'Mimi', desc: 'A bunny in tiny blue overalls.' } } };
  assert.match(composeClip(sc, film, 1).prompt, /Mimi: A bunny in tiny blue overalls\./);
  const p = composeClip(sc, { ...film, pictures: true }, 1).prompt; assert.doesNotMatch(p, /blue overalls/); assert.match(p, /Characters: Mimi look exactly as in the start picture/);
});

import { compactPrompt, isHandmade, GENERATORS } from '../public/js/wizard-model.js';
test('the words are fitted to the generator: negatives by its mode, length by its limit, and a handmade look moves in steps', () => {
  const sc = { data: { seconds: 6, notes: { happens: 'A fox looks up.', cam: 'slow push-in', mood: 'calm', sound: 'wind', never: 'no crowds. no cars' }, who: ['canon.cast:fox'], moves: ['The fox lifts its head slowly.'] } }, film = { cast: { 'canon.cast:fox': { name: 'Fox', desc: 'A small red fox.' } }, look: { look: 'felt stop-motion, soft light' } }, clip = composeClip(sc, film, 1);
  assert.match(clip.prompt, /Motion feel: stepped, like stop-motion/); assert.match(composeClip(sc, { ...film, look: { look: 'soft 3D cartoon' } }, 1).prompt, /Motion feel: soft squash and stretch/); assert.doesNotMatch(composeClip(sc, { ...film, look: { look: 'muted film grain' } }, 1).prompt, /Motion feel/);
  assert.equal(isHandmade({ look: 'Smooth round shapes', options: [{ id: 'a', name: 'Clay Play' }], chosen: 'a' }), true); assert.equal(mediumOf({ look: 'needle felt puppets' }), 'illustration'); assert.equal(mediumOf({ look: 'paper cut-out collage' }), 'illustration'); assert.equal(mediumOf({ look: 'muted film grain' }), 'photograph');
  assert.match(forGenerator(clip, 'minimax-h3').prompt, /Do not show: no crowds/); assert.equal(forGenerator(clip, 'minimax-h3').negative, '');
  assert.equal(forGenerator(clip, 'veo-3.1').negative, 'crowds, cars', 'a negative field takes nouns'); assert.doesNotMatch(forGenerator(clip, 'veo-3.1').prompt, /Do not show/);
  assert.equal(forGenerator(clip, 'runway-gen-4.5').negative, ''); assert.doesNotMatch(forGenerator(clip, 'runway-gen-4.5').prompt, /Do not show|crowds/, 'negation can backfire, so it is left out');
  const short = forGenerator(clip, 'runway-gen-4.5', 1); assert.ok(GENERATORS['runway-gen-4.5'].max_chars === 1000 && short.prompt.length <= 1000);
});
test('a prompt over the limit loses its least important lines first and keeps the action, the move, the states and the dialogue', () => {
  const p = ['The fox looks up.', 'How it moves: the head lifts slowly.', 'Camera: slow push-in', 'Physics: ' + 'x'.repeat(300), 'Characters: Fox: ' + 'y'.repeat(300), 'Look: z', 'Audio: a', 'Timing: t'].join('\n');
  const r = compactPrompt(p, 200); assert.equal(r.compacted, true); assert.ok(r.prompt.length <= 200); assert.match(r.prompt, /^The fox looks up\.\nHow it moves/); assert.doesNotMatch(r.prompt, /Physics|Characters/);
  assert.deepEqual(compactPrompt('short', 200), { prompt: 'short', compacted: false });
  const hard = compactPrompt('A. ' + 'word '.repeat(100), 120); assert.ok(hard.prompt.length <= 120);
});

import { normalizeCamera, cameraCommand, clipRisk, attemptBudget, dialogueLoad, clipChecklist } from '../public/js/wizard-model.js';
test('a camera move always gets a speed word, a still camera is said positively, and Hailuo gets a bracketed command', () => {
  assert.equal(normalizeCamera('push-in'), 'push-in, slowly'); assert.equal(normalizeCamera('slow push-in'), 'slow push-in'); assert.equal(normalizeCamera('static wide'), 'static wide, the camera holds still'); assert.equal(normalizeCamera(''), '');
  assert.equal(cameraCommand('slow push-in'), 'Push in'); assert.equal(cameraCommand('pan left'), 'Pan left'); assert.equal(cameraCommand('gentle arc around'), 'Tracking shot'); assert.equal(cameraCommand('static wide'), 'Static shot');
  const clip = composeClip({ data: { seconds: 6, notes: { happens: 'x', cam: 'slow push-in' } } }, {}, 1);
  assert.match(forGenerator(clip, 'minimax-hailuo').prompt, /^Camera: \[Push in\]$/m); assert.match(forGenerator(clip, 'veo-3.1').prompt, /Camera: slow push-in, only a small move, one continuous shot/); assert.match(forGenerator(clip, 'minimax-h3').prompt, /^Camera: static, the camera holds still, one continuous shot$/m, 'H3 reshapes the scene on a camera move, so its camera is held still'); assert.ok(forGenerator(clip, 'minimax-h3').hints.some((h) => /camera is held still/.test(h)));
  assert.ok(forGenerator(clip, 'minimax-hailuo').hints.some((h) => /optimiser/.test(h))); assert.ok(forGenerator(clip, 'ltx-video').hints.some((h) => /divisible by 32/.test(h)));
});
test('a risky clip gets more tries than a quiet one, and speech that is too long or has too many speakers is warned about', () => {
  const quiet = { seconds: 6, notes: { happens: 'A fox looks at the sky.' }, who: ['canon.cast:a'], moves: ['The fox lifts its head.'] }, risky = { seconds: 6, notes: { happens: 'x' }, who: ['canon.cast:a', 'canon.cast:b'], moves: ['Bo pours water from the can while Mimi digs with her paws and jumps.'], transcript: [{ who: 'A', text: 'Hello', sec: 2 }] };
  assert.equal(clipRisk(quiet, 1), 'low'); assert.equal(clipRisk(risky, 1), 'high'); assert.deepEqual([2, 3, 4], [attemptBudget('low'), attemptBudget('medium'), attemptBudget('high')]);
  const talk = { seconds: 4, transcript: [{ who: 'A', text: 'one two three four five six seven eight nine ten eleven twelve', sec: 4 }, { who: 'B', text: 'x', sec: 0.1 }, { who: 'C', text: 'y', sec: 0.1 }] };
  const l = dialogueLoad(talk, 1); assert.equal(l.words >= 12, true); assert.equal(l.warnings.length, 2); assert.deepEqual(dialogueLoad({ seconds: 6, transcript: [{ who: 'A', text: 'Hi there', sec: 2 }] }, 1).warnings, []);
});
test('the reviewer gets atomic yes/no questions built from the states, the counts and the moves', () => {
  const d = { seconds: 12, clips: [{ seconds: 6 }, { seconds: 6 }], notes: { happens: 'x' }, states: ['A seed lies in a hollow.', 'The hollow is half filled.', 'Flat soil.'], props: [{ name: 'seed', look: 'a pea-sized seed', count: 1 }], moves: ['She pushes soil in.', 'She pats it flat.'] };
  const q = clipChecklist(d, 1); assert.match(q[0], /first frame match this: A seed lies in a hollow/); assert.match(q[1], /last frame match this: The hollow is half filled/); assert.ok(q.some((x) => /exactly 1 seed/.test(x))); assert.ok(q.some((x) => /same in every frame/.test(x))); assert.match(q[q.length - 1], /She pushes soil in/);
  assert.ok(!clipChecklist({ seconds: 6, notes: {} }, 1).some((x) => /first frame match/.test(x)), 'no states, no state questions');
});

import { beastOf, shortLook, expandNames, plainDesc } from '../public/js/wizard-model.js';
test('a character is known by its kind: the animal word, a short look, and a name that carries its kind into a state', () => {
  assert.deepEqual([beastOf('Moss is a small grey-green clay snail with a low soft body'), beastOf('Pip is a tiny orange clay beetle'), beastOf('A woman in her forties')], ['snail', 'beetle', '']); assert.equal(beingOf('Pip is a tiny orange clay beetle'), 'creature');
  assert.equal(shortLook('Moss is a small grey-green clay snail with a low soft body and a big round spiral shell', 'Moss'), 'small grey-green clay snail'); assert.equal(shortLook('A tiny baby bunny with soft cream fur, long ears', 'Mimi'), 'tiny baby bunny');
  assert.equal(expandNames('Moss left and Pip right, Moss looking up.', [{ name: 'Moss', look: 'small clay snail' }, { name: 'Pip', look: 'orange clay beetle' }]), 'The small clay snail left and the orange clay beetle right, the small clay snail looking up.', 'the name is replaced, because a name like Moss pulls the picture toward moss');
  assert.equal(expandNames('Nobody here.', [{ name: 'Moss', look: 'snail' }]), 'Nobody here.'); assert.equal(plainDesc('Moss is a small grey-green clay snail with a shell.', 'Moss'), 'A small grey-green clay snail with a shell.');
});
import { sizesOf, sizesLine, gentleCamera, cameraNote } from '../public/js/wizard-model.js';
test('sizes are kept in every clip prompt, a camera move is small and changes only the framing, and the end picture knows what the camera did', () => {
  const sc = { data: { seconds: 6, notes: { happens: 'x', cam: 'slow push-in' }, sizes: [{ name: 'Moss', size: 'about a quarter of the frame height' }, { name: 'Pip', size: 'half of Moss' }, { name: '', size: 'x' }] } };
  assert.equal(sizesOf(sc.data).length, 2); assert.equal(sizesLine(sc.data), 'Sizes (kept in every frame, in this proportion): Moss about a quarter of the frame height; Pip half of Moss.'); assert.equal(sizesLine({}), '');
  const p = composeClip(sc, {}, 1).prompt; assert.match(p, /Sizes \(kept in every frame/); assert.match(p, /Camera: slow push-in, only a small move, one continuous shot/); assert.match(p, /A camera move changes only the framing: it never reshapes, redraws or moves the ground, the background or any object/); assert.doesNotMatch(p, /the framing[^.]* stay the same/);
  assert.equal(gentleCamera('slow push-in'), 'slow push-in, only a small move'); assert.equal(gentleCamera('slight slow pan left'), 'slight slow pan left'); assert.equal(gentleCamera('static wide'), 'static wide, the camera holds still'); assert.equal(gentleCamera(''), '');
  assert.match(cameraNote('static wide', 'end'), /has not moved/); assert.match(cameraNote('slow push-in', 'end'), /only a little closer/); assert.match(cameraNote('slow pull back', 'end'), /only a little further back/); assert.match(cameraNote('', 'end'), /has not moved/); assert.equal(cameraNote('slow push-in', 'start'), '');
});
test('the reviewer is asked about the background, the framing, every size and one of each character', () => {
  const d = { seconds: 6, notes: { happens: 'x' }, states: ['a', 'b'] }, q = clipChecklist(d, 1, [{ name: 'Moss', kind: 'snail' }, { name: 'Pip', kind: 'beetle' }]);
  assert.ok(q.some((x) => /background keep exactly the same shapes/.test(x))); assert.ok(q.some((x) => /framing change only by one slow camera move/.test(x))); assert.ok(q.some((x) => /same size relative to the frame/.test(x)));
  assert.ok(q.includes('Is there exactly one snail (Moss) in every frame, never two?')); assert.ok(q.includes('Is there exactly one beetle (Pip) in every frame, never two?'));
});
