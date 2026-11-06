// The export pack: file layout, trimming to what a generator accepts, subtitles, a valid .zip, and the frame check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sceneEntries, filmEntries, srt, zip, crc32, buildZip, hashOf, similarity, sceneDir, tailHold } from '../public/js/pack.js';
import { clipPlan, emptyNotes, clipSpans, linesOfClip, cuesOfClip, composeClip } from '../public/js/wizard-model.js';

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
test('the generator is told to land on the end picture on the last frame and never hold it', () => {
  const sc = { data: { seconds: 12, clips: clipPlan(12, 8), notes: { happens: 'She looks up.' }, start: { mode: 'stage' }, end: { mode: 'stage' }, transcript: [{ who: 'A', text: 'hello', sec: 2 }, { who: 'B', text: 'bye', sec: 2 }] } };
  const a = composeClip(sc, {}, 1), b = composeClip(sc, {}, 2);
  assert.match(a.prompt, /Timing: spread the action over the full 6 seconds/); assert.doesNotMatch(a.prompt, /end picture is the very last frame/, 'only the last clip ends on the end picture');
  assert.match(b.prompt, /end picture is the very last frame only: arrive at it on the final frame, not before, and never hold it still/); assert.match(b.prompt, /do not freeze or hold a pose/);
  assert.match(a.prompt, /hello/); assert.match(a.prompt, /bye/, 'both lines start inside the first 6 seconds'); 
  const skip = composeClip({ data: { ...sc.data, end: { mode: 'skip' } } }, {}, 2); assert.doesNotMatch(skip.prompt, /end picture is the very last frame/, 'no end picture, nothing to land on');
});
test('the pack gives each clip its own lines, timed from the clip start, and the timing rule', () => {
  const sc = { ...scene, data: { ...scene.data, seconds: 12, clips: clipPlan(12, 8, [null, 'cont']), transcript: [{ who: 'A', text: 'first', sec: 4 }, { who: 'B', text: 'second', sec: 4 }, { who: 'A', text: 'third', sec: 4 }] } };
  const e = sceneEntries(film, sc, { target: 'both' }), get = (p) => e.find((x) => x.path.endsWith(p));
  assert.deepEqual(JSON.parse(get('clip-01/transcript.json').text).map((l) => l.text), ['first', 'second']); assert.deepEqual(JSON.parse(get('clip-02/transcript.json').text).map((l) => [l.text, l.at]), [['third', 2]]);
  assert.match(get('clip-02/transcript.srt').text, /00:00:02,000 --> 00:00:06,000\nA: third/);
  assert.match(JSON.parse(get('clip-02/clip.json').text).timing, /never hold it still/); assert.match(get('clip-01/prompt.txt').text, /Timing:/);
});

test('a clip that reaches its end picture early and stands still is caught, to the tenth of a second', () => {
  const g = (v) => Array(16).fill(v), still = [{ t: 9.95, g: g(100) }, { t: 9.7, g: g(100) }, { t: 9.45, g: g(101) }, { t: 9.2, g: g(100) }, { t: 8.95, g: g(100) }, { t: 8.7, g: g(140) }, { t: 8.45, g: g(100) }];
  assert.equal(tailHold(still, 10), 1.1, 'the picture matches the last frame back to 8.9 s, then it moves; an old match further back does not count');
  assert.equal(tailHold([{ t: 9.95, g: g(100) }, { t: 9.7, g: g(160) }, { t: 9.45, g: g(100) }], 10), 0, 'a clip still moving at the end');
  assert.equal(tailHold([{ t: 9.95, g: g(100) }, { t: 9.7, g: g(100) }], 10), 0, 'a quarter second is not worth a warning');
  assert.equal(tailHold([], 10), 0);
});
