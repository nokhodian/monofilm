// The film assembler: pure cutting rules, and a real run on small synthetic clips when ffmpeg is there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audioGraph, cutOf, filterOf, zoomOf, zoomAt, assemble, frameDiff, bestJoin } from '../scripts/assemble-film.mjs';

const has = (b) => { try { execFileSync(b, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };

test('a frozen tail is trimmed, a continued clip loses its first two frames, and a clip that is fine is left alone', () => {
  assert.deepEqual(cutOf({ hold: 2 }, 8), { start: 0, length: 6.3 });
  assert.deepEqual(cutOf({ hold: 0.6 }, 8), { start: 0, length: 8 }, 'a short hold is not worth a cut');
  assert.deepEqual(cutOf({ continues: true }, 8, 24), { start: 0.083, length: 7.917 });
  assert.deepEqual(cutOf({ continues: true, trim_start_frames: 0, keep: 5 }, 8), { start: 0, length: 5 });
  assert.deepEqual(cutOf({ keep: 100 }, 8), { start: 0, length: 8 });
  assert.ok(cutOf({ hold: 7.9 }, 8).length >= 0.5, 'never cut a clip to nothing');
});
test('every clip is brought to one size, rate and audio format, with a short fade at both ends', () => {
  const f = filterOf({ size: '640x360', fps: 24 }, 0.08, 4);
  assert.match(f.v, /scale=640:360/); assert.match(f.v, /fps=24/); assert.match(f.v, /format=yuv420p/); assert.match(f.a, /aresample=48000/); assert.match(f.a, /afade=t=in:st=0:d=0\.08/); assert.match(f.a, /afade=t=out:st=3\.920:d=0\.08/);
  assert.match(filterOf({}, 1, 0.4).a, /d=0\.1\b/, 'the fade is never longer than a quarter of a short clip');
  assert.doesNotMatch(filterOf({ size: '640x360' }, 0.08, 4).v, /crop/, 'no push, no crop');
  const pushed = filterOf({ size: '640x360', fps: 24 }, 0.08, 4, zoomOf({ push: 0.08, push_at: [0.4, 0.5] }, 4)).v;
  assert.ok(pushed.includes("scale=1280:720:flags=lanczos,scale=w='trunc(640*2*(1+(0.00000+0.020000*t))/2)*2'") && pushed.includes("eval=frame") && pushed.includes("crop=1280:720:'1280*(0.00000+0.020000*t)*0.4':'720*(0.00000+0.020000*t)*0.5',scale=640:360:flags=lanczos,format=yuv420p"), 'a push-in is a crop of a 2x copy that grows over the clip (crop position from the zoom, not iw), so everything scales together');
});
test('a chain of clips pushes in once: each clip starts at the zoom the one before ended on, along one straight line', () => {
  const a = zoomOf({ push_from: 0, push: 0.04 }, 4), b = zoomOf({ push_from: 0.04, push: 0.08 }, 4, zoomAt(a, 3.5));
  assert.equal(zoomAt(a, 0), 0); assert.ok(Math.abs(zoomAt(a, 4) - 0.04) < 1e-9); assert.ok(Math.abs(b.from - 0.035) < 1e-9, 'the next clip carries the zoom where the join was cut, not 0 and not 0.04');
  assert.equal(zoomOf({}, 4).slope, 0); assert.deepEqual(zoomOf({}, 4).at, [0.5, 0.5]); assert.equal(zoomAt({ from: 0, slope: -1 }, 2), 0, 'never below no zoom');
});
test('two clips of different size and rate, one without sound, come out as one film of the right length', { skip: !has('ffmpeg') || !has('ffprobe') }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'asm-')), mk = (name, src, extra) => { execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, ...extra, join(dir, name)]); return join(dir, name); };
  const a = mk('a.mp4', 'testsrc2=s=320x240:r=25:d=3', ['-f', 'lavfi', '-i', 'sine=f=440:d=3', '-shortest']), b = mk('b.mp4', 'color=c=white:s=640x480:r=30:d=4', []);
  const out = join(dir, 'film.mp4'), r = assemble({ size: '640x360', fps: 24, clips: [{ file: a, hold: 1.5 }, { file: b, continues: true }] }, out);
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', out], { encoding: 'utf8' }));
  assert.equal(r.parts, 2); assert.equal(r.joins[0].transition, 'fadeblack', 'two clips that look nothing alike go through black, not a jump and not a ghost'); assert.ok(Math.abs(Number(info.format.duration) - (1.8 + 3.917)) < 0.45, `a dip loses no picture: duration ${info.format.duration}`);
  assert.ok(info.streams.some((s) => s.codec_type === 'audio'), 'the silent clip got a silent track so the film has sound all through'); assert.ok(info.streams.some((s) => s.width === 640 && s.height === 360));
});

test('a join is made where the two clips match: the same picture is cut, a different one is dissolved, and the best frame near the end is chosen', { skip: !has('ffmpeg') || !has('ffprobe') }, () => {
  assert.equal(frameDiff(Buffer.from([10, 10]), Buffer.from([10, 10])), 0); assert.equal(frameDiff(Buffer.from([0, 0]), Buffer.from([100, 200])), 150);
  const dir = mkdtempSync(join(tmpdir(), 'asmj-')), mk = (name, src) => { execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-f', 'lavfi', '-i', 'sine=f=300:d=4', '-shortest', join(dir, name)]); return join(dir, name); };
  const red1 = mk('r1.mp4', 'color=c=red:s=320x180:r=24:d=4'), red2 = mk('r2.mp4', 'color=c=red:s=320x180:r=24:d=4'), blue = mk('b.mp4', 'color=c=blue:s=320x180:r=24:d=4');
  const same = bestJoin(red1, 0, 4, red2, 0); assert.deepEqual([same.soft, same.diff], [false, 0]); assert.ok(same.end >= 3.8, 'with nothing to gain, the clip keeps (nearly) its full length');
  const apart = bestJoin(red1, 0, 4, blue, 0); assert.equal(apart.soft, true); assert.ok(apart.diff > 12);
  const ramp = mk('ramp.mp4', "color=c=black:s=320x180:r=24:d=4,geq=r='255*lt(T,2.5)':g=0:b=0"), toRed = bestJoin(ramp, 0, 4, red2, 0);
  assert.equal(toRed.soft, false); assert.ok(toRed.end <= 2.5 + 0.11 || toRed.end >= 2.0, `the clip is cut at a frame that matches red: ${toRed.end}`);
  const out = join(dir, 'same.mp4'), r = assemble({ size: '320x180', fps: 24, clips: [{ file: red1 }, { file: red2, continues: true }] }, out), info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', out], { encoding: 'utf8' }));
  assert.equal(r.dissolved, 0); assert.ok(Math.abs(Number(info.format.duration) - (4 + 3.917)) < 0.3, `duration ${info.format.duration}`);
});

test('a pushed two-clip chain joins without a jump and the scale of a landmark rises smoothly', { skip: !has('ffmpeg') || !has('ffprobe') }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'asmp-')), src = 'color=c=black:s=640x360:r=24:d=4,drawbox=x=300:y=160:w=40:h=40:c=white:t=fill', mk = (n) => { execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-f', 'lavfi', '-i', 'sine=f=300:d=4', '-shortest', join(dir, n)]); return join(dir, n); };
  const out = join(dir, 'f.mp4'), r = assemble({ size: '640x360', fps: 24, loudness: false, fadeIn: 0, fadeOut: 0, clips: [{ file: mk('a.mp4'), push: 0.1, push_from: 0 }, { file: mk('b.mp4'), continues: true, push_from: 0.1, push: 0.2 }] }, out);
  assert.equal(r.dissolved, 0, 'the join is cut, not dissolved: both sides are zoomed the same');
  const width = (t) => { const g = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'crop=160:100:240:130,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 }); let n = 0; for (const v of g) if (v > 128) n++; return Math.sqrt(n); };
  const w = [0.2, 1, 2, 3, 3.5, 4.5, 5.5, 6.5, 7.5].map(width), steps = w.slice(1).map((x, i) => x - w[i]);
  assert.ok(w[w.length - 1] > w[0] * 1.15, `the landmark grew ${w.map((x) => x.toFixed(1))}`); assert.ok(steps.every((x) => x > -0.6), `never shrinks ${steps}`); assert.ok(Math.max(...steps) < 3, `no step ${steps}`);
});

test('a new scene is joined by a dissolve, or a dip through black when the light changes a lot, and the film fades in and out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scene-')), mk = (name, color) => { const f = join(dir, name); execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=24:d=3`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-pix_fmt', 'yuv420p', f]); return f; };
  const grey1 = mk('g1.mp4', '0x808080'), grey2 = mk('g2.mp4', '0x838383'), black = mk('k.mp4', '0x101010'), out = join(dir, 'f.mp4');
  const like = assemble({ size: '320x180', fps: 24, loudness: false, clips: [{ file: grey1 }, { file: grey2, continues: false }] }, out), dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }));
  assert.deepEqual([like.joins[0].scene, like.joins[0].transition, like.joins[0].d], [true, 'dissolve', 0.9]); assert.ok(Math.abs(dur(out) - (6 - 0.9)) < 0.2, `the two scenes overlap by 0.9 s (${dur(out)})`);
  const dip = assemble({ size: '320x180', fps: 24, loudness: false, clips: [{ file: grey1 }, { file: black, continues: false }] }, join(dir, 'd.mp4')); assert.deepEqual([dip.joins[0].transition, dip.joins[0].d], ['fadeblack', 1]);
  const hard = assemble({ size: '320x180', fps: 24, loudness: false, sceneTransitions: false, clips: [{ file: grey1 }, { file: grey2, continues: false }] }, join(dir, 'h.mp4')); assert.equal(hard.joins[0], null, 'it can be switched off: a hard cut');
  const first = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-frames:v', '1', '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 })[0]; assert.ok(first < 20, `the first frame is black (${first})`);
});

test('the sound is mixed on its own timeline: placed where each picture starts, crossfaded, with a room tone and an optional music bed that ducks', () => {
  const g = audioGraph({ clips: [{ file: 'a.mp4', start: 0, dur: 3.5, audio: true, at: 0, fadeOut: 1.4 }, { file: 'b.mp4', start: 0.08, dur: 3, audio: true, at: 2.1, fadeIn: 0.9 }, { file: 'c.mp4', start: 0, dur: 2, audio: false, at: 5 }], total: 6 });
  assert.deepEqual(g.inputs.filter((x) => x === '-i').length, 2, 'a clip with no sound adds no input'); assert.match(g.graph, /adelay=2100\|2100/); assert.match(g.graph, /afade=t=out:st=2\.100:d=1\.400:curve=qsin/); assert.match(g.graph, /anoisesrc=c=brown/); assert.doesNotMatch(g.graph, /sidechaincompress/);
  const m = audioGraph({ clips: [{ file: 'a.mp4', start: 0, dur: 3, audio: true, at: 0 }], total: 4, music: 'bed.mp3', musicDb: -18, clipDb: -6 }); assert.deepEqual(m.inputs.slice(-4), ['-stream_loop', '-1', '-i', 'bed.mp3']); assert.match(m.graph, /sidechaincompress/); assert.match(m.graph, /volume=-18dB/);
});

test('a film with a music bed and a scene change plays sound all the way through, with no silent gap at the join', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mix-')), mk = (name, color, hz) => { const f = join(dir, name); execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=24:d=4`, '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=4`, '-shortest', '-pix_fmt', 'yuv420p', f]); return f; };
  const bed = join(dir, 'bed.wav'); execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=110:duration=2', bed]);
  const out = join(dir, 'f.mp4'); assemble({ size: '320x180', fps: 24, music: bed, clips: [{ file: mk('a.mp4', '0x808080', 300), keep: 3 }, { file: mk('b.mp4', '0x909090', 500), continues: false, keep: 3 }] }, out);
  const probeA = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out], { encoding: 'utf8' }); assert.match(probeA, /audio/);
  const sil = execFileSync('ffmpeg', ['-hide_banner', '-i', out, '-af', 'silencedetect=n=-60dB:d=0.3', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString(); assert.equal((sil.match(/silence_start/g) || []).length, 0, 'no silence of 0.3 s anywhere');
});

test('a join inside a scene is a cut, a very short dissolve, a dissolve, or a dip, by how far apart the two frames are', async () => {
  const { joinKind } = await import('../scripts/assemble-film.mjs');
  assert.deepEqual(joinKind(0.2), { soft: false }); assert.deepEqual(joinKind(0.5), { soft: true, transition: 'dissolve', d: 0.17 }, 'a small step: smoothed by a four frame dissolve'); assert.deepEqual(joinKind(1.3), { soft: false, cutIn: true, transition: 'cutin', d: 0 }, 'the boil of two takes differs: a cut to a closer framing, a new camera angle'); assert.deepEqual(joinKind(1.3, { cutIn: 0 }), { soft: true, transition: 'dissolve', d: 0.17 }, 'switched off');
  assert.deepEqual(joinKind(15, { cutIn: 0 }), { soft: true, transition: 'dissolve', d: 0.4 }); assert.deepEqual(joinKind(30), { soft: false, dip: true, transition: 'fadeblack', d: 0.6 }, 'characters elsewhere: through black, not a ghost');
});
