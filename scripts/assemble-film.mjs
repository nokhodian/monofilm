// Joins finished clips into one film the way the knowledge base says to (docs/knowledge/playbook/principles.md, sections 3 and 6):
// every clip is brought to one size, frame rate, colour format and audio rate (scn-p-024); a frozen tail is trimmed (res-p-018); the first frames of a continued clip are cut away (scn-p-014);
// each clip's sound fades in and out for a short moment so a join does not click (aud-p-020); the loudness is set once at the end (aud-p-019); and every join is made to match: a clip ends
// at the frame (in its last 2 seconds) that looks most like the next clip's first frame, and a join that still differs is dissolved over 0.4 s instead of jumping.
//   node scripts/assemble-film.mjs plan.json film.mp4
//   plan.json: { "size": "1280x720", "fps": 24, "fade": 0.08, "loudness": true,
//                "clips": [ { "file": "a.mp4", "hold": 1.4, "continues": false, "push": 0.04 }, { "file": "b.mp4", "continues": true, "trim_start_frames": 2, "push_from": 0.04, "push": 0.08, "push_at": [0.4, 0.5] } ] }
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

// push = a slow push-in made here as a crop, so everything in the frame scales together and no one object resizes, which a generator that cannot take camera moves cannot give (cin-p-031).
// A clip has push (zoom fraction at its end, 0.08 = 8% closer), push_from (at its start, default 0) and push_at ([x,y] 0..1, the point the crop moves toward, default the centre).
// A clip that continues the one before starts at the zoom the one before ended on (never at 1.0), so a scene chain pushes in once, smoothly: film-plan.py gives each clip its share of the chain total.
// The zoom is a line in time. zoomOf fixes it for a clip (its slope uses the length before the join trimmed it), zoomAt reads it at s seconds into the clip.
export const zoomOf = (clip, length, from) => { const f0 = clip.push_from ?? 0; return { from: from ?? f0, slope: clip.push > 0 ? (clip.push - f0) / length : 0, at: clip.push_at || [0.5, 0.5] }; };
export const zoomAt = (z, s) => Math.max(0, z.from + z.slope * s);
// (crop's iw is the size of the first frame only, so its x and y are written out from the zoom, not from iw-ow.) The zoom is drawn from a 2x lanczos copy and scaled down again, so the 2-pixel steps of the scaler are half pixels in the picture and a 720p source is not softened by a second resampling.
export function filterOf({ size = '1280x720', fps = 24 }, fade, length, zoom = null) {
  const [w, h] = size.split('x'), f = Math.min(fade, length / 4), moves = zoom && (zoom.from > 0 || zoom.slope > 0), [fx, fy] = zoom?.at || [0.5, 0.5];
  const z = moves ? `(${zoom.from.toFixed(5)}+${zoom.slope.toFixed(6)}*t)` : '', k = `(1+${z})`, big = (n) => `trunc(${n}*2*${k}/2)*2`;
  const push = moves ? `,scale=${w * 2}:${h * 2}:flags=lanczos,scale=w='${big(w)}':h='${big(h)}':eval=frame:flags=bicubic,crop=${w * 2}:${h * 2}:'${w * 2}*${z}*${fx}':'${h * 2}*${z}*${fy}',scale=${w}:${h}:flags=lanczos` : '';
  return { v: `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}${push},format=yuv420p`, a: `aresample=48000,aformat=channel_layouts=stereo,afade=t=in:st=0:d=${f},afade=t=out:st=${Math.max(0, length - f).toFixed(3)}:d=${f}` };
}

const probe = (file) => { const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], { encoding: 'utf8' })); return { seconds: Number(out.format.duration), audio: (out.streams || []).some((s) => s.codec_type === 'audio') }; };

// How different two pictures are, 0 (the same) to 255, on a 32 x 32 grey copy of each.
const grey = (file, t, zoom = 0, [fx, fy] = [0.5, 0.5]) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', `${zoom > 0 ? `crop=iw/${1 + zoom}:ih/${1 + zoom}:(iw-ow)*${fx}:(ih-oh)*${fy},` : ''}scale=32:32,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
export const frameDiff = (a, b) => { let sum = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]); return n ? sum / n : 255; };
// Where clip A should end so that it joins clip B's first frame best, both compared as they will be shown (zoomA(s) = A's zoom s seconds in; B starts at the zoom A has where it ends, so B's first frame is zoomed the same): the last 2 seconds of A are searched, a little later is preferred, and a join that is still different is dissolved.
export function bestJoin(fileA, startA, endA, fileB, startB, { window = 2, step = 0.1, ok = 12, perSecond = 2, zoomA = () => 0, atA, atB } = {}) {
  const gA = (t) => grey(fileA, t, zoomA(t - startA), atA), gB = (t) => grey(fileB, startB, zoomA(t - startA), atB); let best = { t: endA, diff: frameDiff(gA(Math.max(startA, endA - 0.04)), gB(endA)), score: 0 }; best.score = best.diff;
  for (let t = endA - step; t >= Math.max(startA + 1, endA - window); t -= step) { const diff = frameDiff(gA(t), gB(t)), score = diff + perSecond * (endA - t); if (score < best.score) best = { t: Math.round(t * 100) / 100, diff, score }; }
  return { end: best.t, diff: Math.round(best.diff * 10) / 10, soft: best.diff > ok };
}

// A new scene is joined with a transition (cin-p-033 to 042): a dissolve of about 0.9 s when the two pictures are alike, a dip through black of about 1.2 s when the light or the place changes a lot
// (the mean brightness of the two frames differs by more than 30 of 255, or the pictures differ by more than 70). The sound crosses over for as long as the picture does.
export function sceneJoin(fileA, endA, fileB, startB, plan = {}) {
  const gA = grey(fileA, Math.max(0, endA - 0.12)), gB = grey(fileB, startB), mean = (g) => g.reduce((x, y) => x + y, 0) / (g.length || 1), dY = Math.abs(mean(gA) - mean(gB)), diff = frameDiff(gA, gB), big = gA.length > 0 && gB.length > 0 && (dY > 30 || diff > 70);
  return { soft: true, scene: true, transition: big ? 'fadeblack' : 'dissolve', d: big ? plan.sceneDip ?? 1.2 : plan.sceneDissolve ?? 0.9, diff: Math.round(diff * 10) / 10, dY: Math.round(dY * 10) / 10, end: endA };
}

export function assemble(plan, outFile) {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-')), fps = plan.fps || 24, fade = plan.fade ?? 0.08, dissolve = plan.dissolve ?? 0.4, norm = [];
  const cuts = plan.clips.map((clip) => { const p = probe(clip.file); return { ...cutOf(clip, p.seconds, fps), p, clip }; }), joins = [];
  let carry; // the zoom the clip before ended on, for a clip that continues it
  for (let i = 0; i < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1], endA = a.start + a.length; a.zoom = zoomOf(a.clip, a.length, carry); carry = undefined;
    if (!b) break;
    if (b.clip.continues === false && plan.sceneTransitions !== false) { joins.push(sceneJoin(a.clip.file, endA, b.clip.file, b.start, plan)); continue; } // a new scene: never a bare cut (a cut with the sound of the next scene starting is what looked odd)
    if (plan.joins === false || b.clip.continues === false) { if (b.clip.continues !== false) carry = zoomAt(a.zoom, a.length); joins.push({ soft: false }); continue; }
    const j = bestJoin(a.clip.file, a.start, endA, b.clip.file, b.start, { zoomA: (s) => zoomAt(a.zoom, s), atA: a.zoom.at, atB: b.clip.push_at || a.zoom.at }); carry = zoomAt(a.zoom, j.end - a.start); a.length = Math.max(0.2, j.end - a.start); joins.push(j); // the clip ends where it matches the next one best
  }
  const length = (i) => Math.max(0.2, cuts[i].length);
  cuts.forEach((c, i) => {
    const f = filterOf(plan, fade, length(i), c.zoom), out = join(dir, `part-${String(i).padStart(3, '0')}.mp4`);
    const input = ['-ss', String(c.start), '-t', String(length(i)), '-i', c.clip.file, ...(c.p.audio ? [] : ['-f', 'lavfi', '-t', String(length(i)), '-i', 'anullsrc=r=48000:cl=stereo']), '-map', '0:v', '-map', c.p.audio ? '0:a' : '1:a'];
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...input, '-vf', f.v, '-af', f.a, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', out]); norm.push(out);
  });
  const dj = joins.map((j, i) => (j.soft ? Math.min(j.d ?? dissolve, length(i) / 3, length(i + 1) / 3) : 0)); // each dissolve takes as much from the end of one clip as from the start of the next
  const enc = ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2'], parts = []; let soft = 0;
  norm.forEach((file, i) => {
    const softIn = i > 0 && joins[i - 1].soft, softOut = i + 1 < norm.length && joins[i].soft, ss = softIn ? dj[i - 1] : 0, t = length(i) - ss - (softOut ? dj[i] : 0), body = join(dir, `body-${i}.mp4`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(ss), '-t', String(t), '-i', file, ...enc, body]); parts.push(body);
    if (softOut) { // a dissolve over the tail of this clip and the head of the next, where the two pictures differ
      const dis = join(dir, `dissolve-${i}.mp4`), dd = dj[i];
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(length(i) - dd), '-t', String(dd), '-i', file, '-ss', '0', '-t', String(dd), '-i', norm[i + 1], '-filter_complex', `[0:v][1:v]xfade=transition=${joins[i].transition || 'fade'}:duration=${dd}:offset=0,format=yuv420p[v];[0:a][1:a]acrossfade=d=${dd}:c1=qsin:c2=qsin[a]`, '-map', '[v]', '-map', '[a]', ...enc, dis]); parts.push(dis); soft++;
    }
  });
  const list = join(dir, 'list.txt'); writeFileSync(list, parts.map((x) => `file '${x}'`).join('\n'));
  const joined = join(dir, 'joined.mp4'); execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
  const total = probe(joined).seconds, fin = plan.fadeIn ?? 0.6, fout = plan.fadeOut ?? 1.2, af = [fin > 0 && `afade=t=in:st=0:d=${fin}`, fout > 0 && `afade=t=out:st=${Math.max(0, total - fout - 0.3).toFixed(3)}:d=${fout + 0.3}`, plan.loudness !== false && 'loudnorm=I=-16:TP=-1.5:LRA=11'].filter(Boolean).join(','), vf = [fin > 0 && `fade=t=in:st=0:d=${fin}`, fout > 0 && `fade=t=out:st=${Math.max(0, total - fout).toFixed(3)}:d=${fout}`].filter(Boolean).join(','); // the film fades in from black and out to black; the sound fades out a little longer than the picture
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', joined, ...(vf ? ['-vf', vf, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p'] : ['-c:v', 'copy']), ...(af ? ['-af', af, '-c:a', 'aac', '-ar', '48000'] : ['-c:a', 'copy']), outFile]);
  return { parts: norm.length, dissolved: soft, joins: joins.map((j) => (j.diff == null ? null : { end: j.end, diff: j.diff, soft: j.soft, ...(j.scene ? { scene: true, transition: j.transition, d: j.d, dY: j.dY } : {}) })), out: outFile };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [planFile, out] = process.argv.slice(2);
  if (!planFile || !out) { console.error('Usage: node scripts/assemble-film.mjs plan.json film.mp4'); process.exit(2); }
  const plan = JSON.parse(readFileSync(planFile, 'utf8')); plan.clips = plan.clips.map((c) => ({ ...c, file: resolve(planFile, '..', c.file) }));
  console.log(JSON.stringify(assemble(plan, resolve(out))));
}
