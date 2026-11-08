// The film assembler: pure cutting rules, and a real run on small synthetic clips when ffmpeg is there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cutOf, filterOf, assemble } from '../scripts/assemble-film.mjs';

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
});
test('two clips of different size and rate, one without sound, come out as one film of the right length', { skip: !has('ffmpeg') || !has('ffprobe') }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'asm-')), mk = (name, src, extra) => { execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, ...extra, join(dir, name)]); return join(dir, name); };
  const a = mk('a.mp4', 'testsrc2=s=320x240:r=25:d=3', ['-f', 'lavfi', '-i', 'sine=f=440:d=3', '-shortest']), b = mk('b.mp4', 'testsrc2=s=640x480:r=30:d=4', []);
  const out = join(dir, 'film.mp4'), r = assemble({ size: '640x360', fps: 24, clips: [{ file: a, hold: 1.5 }, { file: b, continues: true }] }, out);
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', out], { encoding: 'utf8' }));
  assert.equal(r.parts, 2); assert.ok(Math.abs(Number(info.format.duration) - (1.8 + 3.917)) < 0.3, `duration ${info.format.duration}`);
  assert.ok(info.streams.some((s) => s.codec_type === 'audio'), 'the silent clip got a silent track so the film has sound all through'); assert.ok(info.streams.some((s) => s.width === 640 && s.height === 360));
});
