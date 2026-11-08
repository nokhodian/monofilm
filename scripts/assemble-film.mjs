// Joins finished clips into one film the way the knowledge base says to (docs/knowledge/playbook/principles.md, sections 3 and 6):
// every clip is brought to one size, frame rate, colour format and audio rate (scn-p-024); a frozen tail is trimmed (res-p-018); the first frames of a continued clip are cut away (scn-p-014);
// each clip's sound fades in and out for a short moment so a join does not click (aud-p-020); the loudness is set once at the end (aud-p-019); and every join is made to match: a clip ends
// at the frame (in its last 2 seconds) that looks most like the next clip's first frame, and a join that still differs is dissolved over 0.4 s instead of jumping.
//   node scripts/assemble-film.mjs plan.json film.mp4
//   plan.json: { "size": "1280x720", "fps": 24, "fade": 0.08, "loudness": true,
//                "clips": [ { "file": "a.mp4", "hold": 1.4, "continues": false }, { "file": "b.mp4", "continues": true, "trim_start_frames": 2 } ] }
// hold = seconds the clip stands still at its end (npm run measure -- clip.mp4 prints it); keep = seconds to keep, instead of hold.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Where a clip starts and how long it is kept. Pure, so it can be tested without ffmpeg.
export function cutOf(clip, seconds, fps = 24) {
  const start = Math.max(0, (clip.trim_start_frames ?? (clip.continues ? 2 : 0)) / fps);
  const end = clip.keep != null ? Math.min(seconds, clip.keep) : clip.hold >= 1 ? Math.max(0.5, seconds - clip.hold + 0.3) : seconds;
  return { start: Math.round(start * 1000) / 1000, length: Math.max(0.2, Math.round((end - start) * 1000) / 1000) };
}

export function filterOf({ size = '1280x720', fps = 24 }, fade, length) {
  const [w, h] = size.split('x'), f = Math.min(fade, length / 4);
  return { v: `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`, a: `aresample=48000,aformat=channel_layouts=stereo,afade=t=in:st=0:d=${f},afade=t=out:st=${Math.max(0, length - f).toFixed(3)}:d=${f}` };
}

const probe = (file) => { const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], { encoding: 'utf8' })); return { seconds: Number(out.format.duration), audio: (out.streams || []).some((s) => s.codec_type === 'audio') }; };

// How different two pictures are, 0 (the same) to 255, on a 32 x 32 grey copy of each.
const grey = (file, t) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', 'scale=32:32,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
export const frameDiff = (a, b) => { let sum = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]); return n ? sum / n : 255; };
// Where clip A should end so that it joins clip B's first frame best: the last 2 seconds of A are searched, a little later is preferred, and a join that is still different is dissolved.
export function bestJoin(fileA, startA, endA, fileB, startB, { window = 2, step = 0.1, ok = 12, perSecond = 2 } = {}) {
  const first = grey(fileB, startB); let best = { t: endA, diff: frameDiff(grey(fileA, Math.max(startA, endA - 0.04)), first), score: 0 }; best.score = best.diff;
  for (let t = endA - step; t >= Math.max(startA + 1, endA - window); t -= step) { const diff = frameDiff(grey(fileA, t), first), score = diff + perSecond * (endA - t); if (score < best.score) best = { t: Math.round(t * 100) / 100, diff, score }; }
  return { end: best.t, diff: Math.round(best.diff * 10) / 10, soft: best.diff > ok };
}

export function assemble(plan, outFile) {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-')), fps = plan.fps || 24, fade = plan.fade ?? 0.08, dissolve = plan.dissolve ?? 0.4, norm = [];
  const cuts = plan.clips.map((clip) => { const p = probe(clip.file); return { ...cutOf(clip, p.seconds, fps), p, clip }; }), joins = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1], endA = a.start + a.length;
    if (plan.joins === false || b.clip.continues === false) { joins.push({ soft: false }); continue; }
    const j = bestJoin(a.clip.file, a.start, endA, b.clip.file, b.start); a.length = Math.max(0.2, j.end - a.start); joins.push(j); // the clip ends where it matches the next one best
  }
  const length = (i) => Math.max(0.2, cuts[i].length);
  cuts.forEach((c, i) => {
    const f = filterOf(plan, fade, length(i)), out = join(dir, `part-${String(i).padStart(3, '0')}.mp4`);
    const input = ['-ss', String(c.start), '-t', String(length(i)), '-i', c.clip.file, ...(c.p.audio ? [] : ['-f', 'lavfi', '-t', String(length(i)), '-i', 'anullsrc=r=48000:cl=stereo']), '-map', '0:v', '-map', c.p.audio ? '0:a' : '1:a'];
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...input, '-vf', f.v, '-af', f.a, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', out]); norm.push(out);
  });
  const enc = ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2'], parts = []; let soft = 0;
  norm.forEach((file, i) => {
    const softIn = i > 0 && joins[i - 1].soft, softOut = i + 1 < norm.length && joins[i].soft, d = Math.min(dissolve, length(i) / 3), ss = softIn ? d : 0, t = length(i) - ss - (softOut ? d : 0), body = join(dir, `body-${i}.mp4`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(ss), '-t', String(t), '-i', file, ...enc, body]); parts.push(body);
    if (softOut) { // a dissolve over the tail of this clip and the head of the next, where the two pictures differ
      const dis = join(dir, `dissolve-${i}.mp4`), dd = Math.min(dissolve, length(i + 1) / 3, length(i) / 3);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(length(i) - dd), '-t', String(dd), '-i', file, '-ss', '0', '-t', String(dd), '-i', norm[i + 1], '-filter_complex', `[0:v][1:v]xfade=transition=fade:duration=${dd}:offset=0,format=yuv420p[v];[0:a][1:a]acrossfade=d=${dd}[a]`, '-map', '[v]', '-map', '[a]', ...enc, dis]); parts.push(dis); soft++;
    }
  });
  const list = join(dir, 'list.txt'); writeFileSync(list, parts.map((x) => `file '${x}'`).join('\n'));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'copy', ...(plan.loudness === false ? ['-c:a', 'copy'] : ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-ar', '48000']), outFile]);
  return { parts: norm.length, dissolved: soft, joins: joins.map((j) => (j.diff == null ? null : { end: j.end, diff: j.diff, soft: j.soft })), out: outFile };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [planFile, out] = process.argv.slice(2);
  if (!planFile || !out) { console.error('Usage: node scripts/assemble-film.mjs plan.json film.mp4'); process.exit(2); }
  const plan = JSON.parse(readFileSync(planFile, 'utf8')); plan.clips = plan.clips.map((c) => ({ ...c, file: resolve(planFile, '..', c.file) }));
  console.log(JSON.stringify(assemble(plan, resolve(out))));
}
