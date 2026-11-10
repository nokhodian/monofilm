// The export pack: file layout, trimming to what a generator accepts, subtitles, a valid .zip, and the frame check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sceneEntries, filmEntries, srt, zip, crc32, buildZip, hashOf, similarity, sceneDir, tailHold, smoothness, seedFor, retryAdvice, voicePlan, publishChecklist, settleOf, sizeFaults, sizeIssues, goodUntil } from '../public/js/pack.js';
import { clipPlan, emptyNotes, clipSpans, clipBeats, startOf, linesOfClip, cuesOfClip, composeClip, clipLineCheck } from '../public/js/wizard-model.js';

const film = { name: 'Ines teaser', look: { look: 'Muted film', aspect: '9:16', fps: 24, forbidden: ['electric light'] }, speech: 'German', captions: ['English'], anchors: [{ id: 'ines', name: 'Ines', uri: 'media/p/a.png' }], plates: [{ id: 'scaffold', uri: 'media/p/pl.png' }] };
const scene = { ref: 'scene:the-beam', data: { n: 1, name: 'The beam', seconds: 12, clips: clipPlan(12, 8, [null, 'cut']), who: ['canon.cast:ines'], start: { mode: 'stage' }, end: { mode: 'stage' }, notes: { ...emptyNotes(), happens: 'She looks up.', never: 'No collapse' }, transcript: [{ who: 'INES', text: 'Hallo', en: 'Hi', sec: 2 }, { who: '', text: '', sec: 1 }] },
  frames: { '1-start': 'media/p/s.png', '2-start': 'media/p/s2.jpg', '2-end': 'media/p/e.png' }, stage: [{ role: 'layout', uri: 'media/p/l.png', shot: 'shot:the-beam-c1' }], anchors: film.anchors };
const names = (e) => e.map((x) => x.path);

test('a scene pack has a brief, a transcript, subtitles and one folder per clip, with only what the target takes', () => {
  assert.equal(sceneDir(scene), 'scene-01-the-beam');
  const both = names(sceneEntries(film, scene, { target: 'both' }));
  for (const p of ['brief.md', 'start.png', 'end.png', 'transcript.json', 'transcript.srt', 'clip-01/prompt.txt', 'clip-01/negative.txt', 'clip-01/clip.json', 'clip-01/start.png', 'clip-01/stage/layout.png', 'clip-02/start.jpg', 'clip-02/end.png']) assert.ok(both.includes(`scene-01-the-beam/${p}`), p);
  assert.ok(!both.includes('scene-01-the-beam/clip-01/end.png'), 'only the last clip ends on the end picture');
  const start = names(sceneEntries(film, scene, { target: 'start' })), refs = names(sceneEntries(film, scene, { target: 'refs' })), text = names(sceneEntries(film, scene, { target: 'text' }));
  assert.ok(start.some((p) => p.endsWith('clip-01/start.png')) && !start.some((p) => p.endsWith('end.png')));
  assert.ok(!refs.some((p) => /start\.|end\./.test(p)) && refs.some((p) => p.endsWith('refs/ines.png')));
  assert.ok(!text.some((p) => /\.(png|jpg)$/.test(p)) && text.some((p) => p.endsWith('prompt.txt')));
});
test('with ends: last, a stale middle end picture is not packed, and with every clip it is', () => {
  const sc2 = (ends) => ({ ...scene, data: { ...scene.data, ends }, frames: { ...scene.frames, '1-end': 'media/p/old.png' } }), has = (x) => names(sceneEntries(film, x, { target: 'both' })).includes('scene-01-the-beam/clip-01/end.png');
  assert.equal(has(sc2('last')), false); assert.equal(has(sc2(undefined)), true);
});
test('clip.json says how each clip begins; a skipped anchor is left out', () => {
  const get = (e, p) => JSON.parse(e.find((x) => x.path.endsWith(p)).text), e = sceneEntries(film, scene, { target: 'both' });
  assert.deepEqual([get(e, 'clip-01/clip.json').begins, get(e, 'clip-01/clip.json').start_from, get(e, 'clip-02/clip.json').begins, get(e, 'clip-02/clip.json').start_from], ['start', 'start picture', 'cut', 'own start picture']);
  assert.equal(get(e, 'clip-02/clip.json').ends_with, 'end picture');
  const skip = { ...scene, data: { ...scene.data, start: { mode: 'skip' }, end: { mode: 'skip' }, clips: clipPlan(12, 8, [null, 'cont']) } }, e2 = sceneEntries(film, skip, { target: 'both' });
  assert.equal(get(e2, 'clip-01/clip.json').start_from, null); assert.match(get(e2, 'clip-02/clip.json').start_from, /last frame of clip 01/);
  assert.ok(!names(e2).some((p) => /end\.(png|jpg)$/.test(p)));
});
test('the film pack holds the canon once, every scene, and a manifest', () => {
  const e = filmEntries(film, [scene], { target: 'both' }), p = names(e);
  for (const x of ['ines-teaser/film/look.txt', 'ines-teaser/film/never-on-screen.txt', 'ines-teaser/film/anchors/ines.png', 'ines-teaser/film/plates/scaffold.png', 'ines-teaser/manifest.json', 'ines-teaser/scene-01-the-beam/brief.md']) assert.ok(p.includes(x), x);
  const m = JSON.parse(e.find((y) => y.path.endsWith('manifest.json')).text); assert.deepEqual([m.schema, m.scenes[0].clips, m.target], ['monofilm/pack@1', 2, 'both']);
  assert.match(e.find((y) => y.path.endsWith('prompt.txt')).text, /INES says, in German, "Hallo"/);
});
test('subtitles are timed one after another and skip empty lines', () => {
  assert.equal(srt([{ who: 'A', text: 'one', sec: 2 }, { text: '' }, { who: 'B', text: 'two', en: 'zwei', sec: 3 }]), '1\n00:00:00,000 --> 00:00:02,000\nA: one\n\n2\n00:00:02,000 --> 00:00:05,000\nB: two\n(zwei)\n');
});
test('the zip is valid: unzip lists and tests every file, and the crc matches', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const { bytes, missing } = await buildZip([...sceneEntries(film, scene, { target: 'both' })], async (u) => (u.endsWith('s2.jpg') ? null : new Uint8Array([1, 2, 3, 4])));
  assert.deepEqual(missing, ['scene-01-the-beam/clip-02/start.jpg']);
  const f = join(mkdtempSync(join(tmpdir(), 'pk-')), 'a.zip'); writeFileSync(f, bytes);
  let ok = true, out = ''; try { out = execFileSync('unzip', ['-t', f], { encoding: 'utf8' }); } catch (e) { if (e.code === 'ENOENT') ok = null; else throw e; }
  if (ok) { assert.match(out, /No errors detected/); assert.match(out, /scene-01-the-beam\/clip-01\/prompt\.txt/); assert.match(out, /MISSING\.txt/); }
  const z = zip([{ path: 'a.txt', bytes: new TextEncoder().encode('hi') }]); assert.deepEqual([...z.slice(0, 4)], [0x50, 0x4b, 3, 4]); assert.equal(z.length, 30 + 5 + 2 + 46 + 5 + 22);
});
test('the frame check: the same picture matches, a very different one does not', () => {
  const img = (f) => { const w = 16, h = 16, d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y), i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } return hashOf(d, w, h); };
  const a = img((x, y) => (x < 8 ? 200 : 40)), same = img((x, y) => (x < 8 ? 190 : 50)), other = img((x, y) => (x < 8 ? 40 : 200));
  assert.equal(similarity(a, same), 100); assert.ok(similarity(a, other) < 20);
});

test('clips: each one covers its own seconds, and gets its own lines and sounds', () => {
  const d = { seconds: 15, clips: clipPlan(15), transcript: [{ who: 'A', text: 'one', sec: 3 }, { who: 'B', text: '', sec: 2 }, { who: 'B', text: 'two', sec: 4 }, { who: 'A', text: 'three', sec: 3 }], cues: [{ name: 'wind', at: 1 }, { name: 'bell', at: 9 }] };
  assert.deepEqual(clipSpans(d).map((c) => [c.from, c.to]), [[0, 8], [8, 15]]);
  assert.deepEqual(linesOfClip(d, 1).map((l) => [l.text, l.at, l.index]), [['one', 0, 0], ['two', 5, 2]]);
  assert.deepEqual(linesOfClip(d, 2).map((l) => [l.text, l.at, l.index]), [['three', 1, 3]], 'a line belongs to the clip it starts in, timed from that clip\'s start');
  assert.deepEqual(cuesOfClip(d, 1).map((c) => c.name), ['wind']); assert.deepEqual(cuesOfClip(d, 2).map((c) => c.name), ['bell']);
});
test('the generator is told to fill the clip, land on the end picture on the last frame and never hold it', () => {
  const sc = { data: { seconds: 12, clips: clipPlan(12, 8), notes: { happens: 'She looks up. She steps back.' }, start: { mode: 'stage' }, end: { mode: 'stage' }, transcript: [{ who: 'A', text: 'hello', sec: 2 }, { who: 'B', text: 'bye', sec: 2 }] } };
  for (const n of [1, 2]) { const t = composeClip(sc, {}, n); assert.match(t.prompt, /Timing: use the full 6 seconds/); assert.match(t.prompt, /reach the end picture on the very last frame, not before/); assert.match(t.prompt, /Do not add events that are not listed/); assert.doesNotMatch(t.prompt, /keep the camera moving/i); }
  assert.match(composeClip(sc, {}, 1).prompt, /hello/); assert.match(composeClip(sc, {}, 1).prompt, /bye/, 'both lines start inside the first 6 seconds');
  const skip = composeClip({ data: { ...sc.data, end: { mode: 'skip' } } }, {}, 2); assert.doesNotMatch(skip.prompt, /end picture/); assert.match(skip.prompt, /Timing: move gently for the full 6 seconds. Do not add new events/);
});
test('each clip is asked to do only its own part, and told what the clip before ended on', () => {
  const sc = { data: { seconds: 15, clips: clipPlan(15), notes: { happens: 'Mira hops. Mira trips. Mira knocks the tower over.', cam: 'slow crane back' }, start: { mode: 'stage' }, end: { mode: 'stage' } } };
  assert.deepEqual(clipBeats(sc.data), ['Mira hops. Mira trips.', 'Mira knocks the tower over.'], 'the sentences are shared out in order');
  const a = composeClip(sc, {}, 1), b = composeClip(sc, {}, 2);
  assert.equal(a.prompt.split('\n')[0], 'Mira hops. Mira trips.'); assert.doesNotMatch(a.prompt, /knocks the tower/); assert.equal(b.prompt.split('\n')[0], 'Mira knocks the tower over.'); assert.doesNotMatch(b.prompt.split('\n')[0], /hops/);
  assert.match(b.prompt, /The clip before ended on: Mira hops\. Mira trips\. Do not repeat it\./); assert.match(b.prompt, /It begins from the end picture of the clip before/);
  const own = composeClip({ data: { ...sc.data, beats: ['She hops.', 'She trips and falls.'] } }, {}, 2); assert.equal(own.prompt.split('\n')[0], 'She trips and falls.', 'written lines win');
  assert.deepEqual(clipBeats({ ...sc.data, beats: ['one', ''] }), ['one', 'Mira knocks the tower over.'], 'a line the person wrote stays, and a blank one is filled from the shared split');
  assert.deepEqual(clipBeats({ ...sc.data, clips: clipPlan(7), notes: { happens: 'One. Two.' } }), ['One. Two.'], 'one clip does everything');
});
test('the look stays constant, characters are described the same way each time, and silent clips are asked for as silent', () => {
  const film = { look: { look: 'felt stop-motion', aspect: '16:9', fps: 24 }, cast: { 'canon.cast:mira': { name: 'Mira', desc: 'A small alpaca with a long neck, cream wool and one pink ear.' }, 'canon.cast:x': { name: 'X', desc: '' } } };
  const quiet = { data: { seconds: 6, clips: clipPlan(6), who: ['canon.cast:mira', 'canon.cast:x'], notes: { happens: 'She walks.' }, start: { mode: 'stage' }, end: { mode: 'stage' } } };
  const a = composeClip(quiet, film, 1); assert.match(a.prompt, /Characters \(keep each one exactly as in its reference picture\): Mira: A small alpaca with a long neck/); assert.doesNotMatch(a.prompt, /X:/);
  assert.match(a.prompt, /Look: felt stop-motion\. 16:9, 24 fps, 6 seconds\. The medium, colours, exposure and time of day stay exactly the same for the whole clip\. No scene change, no cuts, no text on screen\./);
  assert.equal(a.audio, 'silent'); assert.match(a.prompt, /Audio: only quiet room tone\. Every character keeps their mouth closed\./);
  assert.equal(composeClip({ data: { ...quiet.data, notes: { happens: 'x', sound: 'rain' } } }, film, 1).audio, 'ambient');
  const talk = composeClip({ data: { ...quiet.data, transcript: [{ who: 'MIRA', text: 'Hi', sec: 2 }] } }, film, 1); assert.equal(talk.audio, 'dialogue'); assert.match(talk.prompt, /Audio: only the spoken lines above/);
});
test('every clip gets a start and an end picture of its own to aim for, and the next clip starts from the end picture before it', () => {
  const d = { n: 2, name: 'Two', seconds: 15, clips: clipPlan(15), who: [], start: { mode: 'stage' }, end: { mode: 'stage' }, notes: emptyNotes(), transcript: [] };
  assert.deepEqual([startOf(d, 1), startOf(d, 2), startOf({ ...d, clips: clipPlan(15, 8, [null, 'cut']) }, 2), startOf({ ...d, end: { mode: 'skip' } }, 2), startOf({ ...d, start: { mode: 'skip' } }, 1)], ['start', 'prev-end', 'own', 'prev-frame', null]);
  const sc = { ref: 'scene:two', data: d, frames: { '1-start': 'media/p/a.png', '1-end': 'media/p/b.png', '2-end': 'media/p/c.png' }, stage: [], anchors: [] }, e = sceneEntries(film, sc, { target: 'both' }), get = (p) => e.find((x) => x.path.endsWith(p));
  assert.equal(get('clip-01/end.png').uri, 'media/p/b.png'); assert.equal(get('clip-02/start.png').uri, 'media/p/b.png', 'the same picture ends clip 1 and starts clip 2'); assert.equal(get('clip-02/end.png').uri, 'media/p/c.png');
  const c2 = JSON.parse(get('clip-02/clip.json').text); assert.deepEqual([c2.start_from, c2.ends_with, c2.audio_policy, JSON.parse(get('clip-01/clip.json').text).transition_in], ['end picture of clip 01 (the same picture)', 'end picture', 'silent', 'cut']);
  const chain = sceneEntries(film, { ...sc, data: { ...d, start: { mode: 'chain' } } }, { target: 'both' }); assert.equal(JSON.parse(chain.find((x) => x.path.endsWith('clip-01/clip.json')).text).transition_in, 'continues from the previous scene');
});
test('a clip that cuts or morphs inside is caught by its own step sizes', () => {
  assert.equal(smoothness([1, 2, 1, 2, 1, 2]).flag, false); assert.equal(smoothness([3, 3, 4, 3, 3]).flag, false, 'steady motion');
  const j = smoothness([2, 2, 3, 2, 60, 2, 2], 0.2); assert.deepEqual([j.flag, j.max, j.median, j.at], [true, 60, 2, 1], 'one big step among small ones, about 1 s in'); assert.equal(smoothness([2, 2, 3, 2, 40, 2, 2], 0.2).flag, false, 'a moderate flash on a quiet shot is not a cut');
  assert.equal(smoothness([9, 10, 11, 12, 18]).flag, false, 'fast but not a jump'); assert.equal(smoothness([1, 2]), null);
});
test('the pack gives each clip its own lines, timed from the clip start, and the timing rule', () => {
  const sc = { ...scene, data: { ...scene.data, seconds: 12, clips: clipPlan(12, 8, [null, 'cont']), transcript: [{ who: 'A', text: 'first', sec: 4 }, { who: 'B', text: 'second', sec: 4 }, { who: 'A', text: 'third', sec: 4 }] } };
  const e = sceneEntries(film, sc, { target: 'both' }), get = (p) => e.find((x) => x.path.endsWith(p));
  assert.deepEqual(JSON.parse(get('clip-01/transcript.json').text).map((l) => l.text), ['first', 'second']); assert.deepEqual(JSON.parse(get('clip-02/transcript.json').text).map((l) => [l.text, l.at]), [['third', 2]]);
  assert.match(get('clip-02/transcript.srt').text, /00:00:02,000 --> 00:00:06,000\nA: third/);
  assert.match(JSON.parse(get('clip-02/clip.json').text).timing, /slow, steady movement/); assert.match(get('clip-01/prompt.txt').text, /Timing:/);
});

test('a clip that reaches its end picture early and stands still is caught, to the tenth of a second', () => {
  const g = (v) => Array(16).fill(v), still = [{ t: 9.95, g: g(100) }, { t: 9.7, g: g(100) }, { t: 9.45, g: g(101) }, { t: 9.2, g: g(100) }, { t: 8.95, g: g(100) }, { t: 8.7, g: g(140) }, { t: 8.45, g: g(100) }];
  assert.equal(tailHold(still, 10), 1.1, 'the picture matches the last frame back to 8.9 s, then it moves; an old match further back does not count');
  assert.equal(tailHold([{ t: 9.95, g: g(100) }, { t: 9.7, g: g(160) }, { t: 9.45, g: g(100) }], 10), 0, 'a clip still moving at the end');
  assert.equal(tailHold([{ t: 9.95, g: g(100) }, { t: 9.7, g: g(100) }], 10), 0, 'a quarter second is not worth a warning');
  assert.equal(tailHold([], 10), 0);
});

test('every spoken line is in exactly one clip, and a pack refuses a scene where that is not true', () => {
  const d = { n: 1, name: 'x', seconds: 12, clips: [{ seconds: 6 }, { seconds: 6 }], transcript: [{ text: 'a', sec: 4 }, { text: 'b', sec: 4 }, { text: 'c', sec: 4 }, { text: '', sec: 4 }, { text: 'late', sec: 9 }], notes: {} };
  assert.deepEqual(clipLineCheck(d), []); assert.match(clipLineCheck(d, { late: true })[0], /line 5 starts at 16 s, after the scene ends at 12 s/);
  assert.deepEqual(clipLineCheck({ ...d, clips: [{ seconds: 6 }, { seconds: 6 }, { seconds: 6 }, { seconds: 6 }] }, { late: true }), []);
  assert.equal(linesOfClip(d, 1).length + linesOfClip(d, 2).length, 4);
  assert.deepEqual(clipLineCheck(d), []);
});

test('a retry gets a new seed every time, the same one for the same attempt, and stops after three bad takes or a picked one', () => {
  assert.equal(seedFor('a', 1, 2), seedFor('a', 1, 2)); assert.notEqual(seedFor('a', 1, 1), seedFor('a', 1, 2)); assert.notEqual(seedFor('a', 1, 1), seedFor('a', 2, 1));
  const fresh = retryAdvice('a', 1, []); assert.equal(fresh.attempt, 1); assert.equal(fresh.try_again, false); assert.equal(fresh.seed, seedFor('a', 1, 1));
  const held = retryAdvice('a', 1, [{ hold: 2.5 }]); assert.equal(held.try_again, true); assert.equal(held.attempt, 2); assert.match(held.add_to_prompt, /very last frame/); assert.match(held.last_take_problems[0], /2\.5 s/);
  assert.match(retryAdvice('a', 1, [{ smooth: { flag: true, at: 3.4 } }]).add_to_prompt, /continuous shot/); assert.match(retryAdvice('a', 1, [{ cuts: 2 }]).last_take_problems[0], /2 cuts/);
  const bad = [{ hold: 1 }, { hold: 1 }, { cuts: 1 }]; assert.equal(retryAdvice('a', 1, bad).try_again, false); assert.match(retryAdvice('a', 1, bad).stop, /Stop and tell the human/);
  assert.equal(retryAdvice('a', 1, [{ hold: 1, picked: true }]).try_again, false);
  assert.equal(retryAdvice('a', 1, [{ hold: 0, smooth: { flag: false } }]).try_again, false, 'a clean take needs no retry');
});

test('what the clip review found goes into the next try, and a clean review stops the retries', () => {
  const bad = { review: { ok: false, issues: [{ kind: 'count', problem: 'One seed becomes three.', frames: '3 to 5' }], advice: 'There is exactly one seed, always.' } };
  const a = retryAdvice('s', 1, [bad]); assert.equal(a.try_again, true); assert.match(a.last_take_problems[0], /One seed becomes three\. \(frames 3 to 5\)/); assert.match(a.add_to_prompt, /exactly one seed/);
  assert.equal(retryAdvice('s', 1, [{ review: { ok: true, issues: [], advice: '' } }]).try_again, false);
});

test('a speaker with lines in more than one clip is routed to a separate voice, and the pack tells the person what to check before publishing', () => {
  const d = { seconds: 12, clips: [{ seconds: 6 }, { seconds: 6 }], transcript: [{ who: 'MIRA', text: 'Hello', sec: 6 }, { who: 'MIRA', text: 'Again', sec: 6 }, { who: 'BO', text: 'Hi', sec: 6 }] };
  const v = voicePlan(d, { voices: { MIRA: 'warm, quick' } }), mira = v.speakers.find((x) => x.who === 'MIRA'); assert.deepEqual([mira.route, mira.clips, mira.voice], ['separate-voice', [1, 2], 'warm, quick']); assert.equal(v.speakers.find((x) => x.who === 'BO').route, 'native'); assert.match(v.note, /one separate voice/);
  assert.equal(voicePlan({ seconds: 6, transcript: [] }).note, '');
  assert.deepEqual(publishChecklist({}, [{ data: d }]).map((i) => i.id), ['disclosure', 'kids', 'provenance', 'authorship', 'likeness', 'voice']); assert.ok(!publishChecklist({}, []).some((i) => i.id === 'voice'));
  const pack = filmEntries(film, [scene], { target: 'both' }), man = JSON.parse(pack.find((x) => x.path.endsWith('manifest.json')).text); assert.equal(man.publishing[0].id, 'disclosure'); assert.match(pack.find((x) => x.path.endsWith('PUBLISHING.md')).text, /- \[ \] Label the film as AI-generated/);
});

test('a character that shrinks, or a pair whose proportion changes, is found in the measured sizes, with the moment it starts', () => {
  const steady = [0.2, 0.2, 0.21, 0.2, 0.19, 0.2, 0.2, 0.2], shrinks = [0.2, 0.2, 0.21, 0.2, 0.19, 0.11, 0.1, 0.1], other = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
  assert.deepEqual(sizeFaults({ snail: steady, beetle: other }, { seconds: 8 }), [], 'noise is not a fault');
  const f = sizeFaults({ snail: shrinks, beetle: other }, { seconds: 8 }); assert.ok(f.some((x) => x.kind === 'size' && x.name === 'snail' && x.i === 5 && x.at === 5.5)); assert.ok(f.some((x) => x.kind === 'ratio' && x.name === 'snail to beetle'));
  const step = sizeFaults({ moss: [0.55, 0.55, 0.55, 0.55, 0.5, 0.46, 0.46, 0.46, 0.45, 0.46, 0.46, 0.46], pip: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1] }, { seconds: 6.6 }); assert.equal(step.find((x) => x.kind === 'size').i, 4, 'the step of a snail from 0.55 to 0.46 is found where it starts (the 0.5 before it is already 9% off)'); assert.equal(sizeFaults({ moss: [0.28, 0.28, 0.28, 0.29, 0.28, 0.27, 0.28, 0.27, 0.27, 0.27, 0.27, 0.27] }, {}).length, 0, 'measuring noise is not a step');
  assert.equal(sizeFaults({ a: [0.2, 0.2, 0.2, 0.2, 0.2, 0.1, 0.2, 0.2], b: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1] }, {}).length, 0, 'one bad box is noise');
  const issues = sizeIssues(f); assert.match(issues[0].problem, /The snail shrinks to 5\d% of its usual size from about 5\.5 s/); assert.equal(issues.length, 2); assert.equal(goodUntil(f), 5.3); assert.equal(goodUntil([]), null); assert.equal(goodUntil([{ at: 0.5 }]), 1.2, 'never less than 1.2 s');
  assert.deepEqual(sizeFaults({ snail: [0.2, 0.2, 0.21, 0.2, 0.19, 0.18, 0.17, 0.17], beetle: other }, { seconds: 8, depth: { snail: true } }).filter((x) => x.kind === 'size'), [], 'a character that really walks away may get a sixth smaller');
  assert.ok(sizeFaults({ snail: shrinks, beetle: other }, { seconds: 8, depth: { snail: true } }).some((x) => x.kind === 'size'), 'but not half the size');
  const settle = [0.59, 0.54, 0.5, 0.48, 0.48, 0.48, 0.48, 0.48, 0.49, 0.5, 0.49, 0.49]; assert.equal(settleOf({ moss: settle }, 6.6), 1.2, 'the first two frames are the generator settling: 0.59 and 0.54 against 0.48 settled');
  assert.deepEqual(sizeFaults({ moss: settle, pip: [0.27, 0.27, 0.26, 0.26, 0.26, 0.23, 0.21, 0.21, 0.21, 0.21, 0.21, 0.21] }, { seconds: 6.6 }).filter((x) => x.kind === 'size' && x.name === 'moss'), [], 'the settling is not a fault of the clip');
  const push = sizeFaults({ snail: [0.2, 0.22, 0.25, 0.28, 0.3, 0.33, 0.36, 0.4], beetle: [0.1, 0.11, 0.125, 0.14, 0.15, 0.165, 0.18, 0.2] }, { seconds: 8, push: true }); assert.deepEqual(push, [], 'a camera push scales everything together');
  assert.ok(sizeFaults({ snail: [0.2, 0.22, 0.25, 0.28, 0.3, 0.33, 0.36, 0.4], beetle: other }, { seconds: 8, push: true }).some((x) => x.kind === 'ratio'), 'but one object growing alone is a fault');
  assert.deepEqual(sizeFaults({ a: [0, 0, 0] }, {}), [], 'a character that was not found is ignored');
});
