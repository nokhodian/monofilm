// Joins finished clips into one film the way the knowledge base says to (docs/knowledge/playbook/principles.md, sections 3 and 6):
// every clip is brought to one size, frame rate, colour format and audio rate (scn-p-024); a frozen tail is trimmed (res-p-018); the first frames of a continued clip are cut away (scn-p-014);
// each clip's sound fades in and out for a short moment so a join does not click (aud-p-020); the loudness is set once at the end (aud-p-019); and every join is made to match: a clip ends
// at the frame (in its last 2 seconds) that looks most like the next clip's first frame, and a join that still differs is dissolved over 0.4 s instead of jumping.
//   node scripts/assemble-film.mjs plan.json film.mp4
//   (the sound is mixed apart from the pictures: audioGraph; plan.music = a music bed file, plan.musicDb -18, plan.clipDb, plan.roomTone, plan.lead 0.5 s of L-cut at a new scene)
//   plan.json: { "size": "1280x720", "fps": 24, "fade": 0.08, "loudness": true,
//                "clips": [ { "file": "a.mp4", "hold": 1.4, "continues": false, "push": 0.04 }, { "file": "b.mp4", "continues": true, "trim_start_frames": 2, "push_from": 0.04, "push": 0.08, "push_at": [0.4, 0.5] } ] }
// hold = seconds the clip stands still at its end (npm run measure -- clip.mp4 prints it); keep = seconds to keep, instead of hold.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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
  const gA = grey(fileA, Math.max(0, endA - 0.12)), gB = grey(fileB, startB), mean = (g) => g.reduce((x, y) => x + y, 0) / (g.length || 1), dY = Math.abs(mean(gA) - mean(gB)), diff = frameDiff(gA, gB), big = gA.length > 0 && gB.length > 0 && (dY > 30 || diff > (plan.sceneDipAbove ?? 15)); // pictures that differ at all: through black (a dissolve of a character at one size into the same character at another looks like it shrinks)
  return { soft: !big, dip: big, scene: true, transition: big ? 'fadeblack' : 'dissolve', d: big ? plan.sceneDip ?? 1.0 : plan.sceneDissolve ?? 0.9, diff: Math.round(diff * 10) / 10, dY: Math.round(dY * 10) / 10, end: endA };
}

// The sound of the film is mixed on its own timeline, apart from the pictures (cin-p-037 to 041, wf-p-029 to 031): every clip's sound is placed where its picture starts, fades in and out with an equal-power
// curve over the same time as the picture dissolve, and at a new scene the sound of the scene before lingers `lead` seconds under the new picture (an L-cut: the sound after the cut point of a clip exists, only
// the frozen end of the picture is trimmed). Under all of it lies a room tone (a join is never silent) and, when the plan has one, a music bed that ducks under the clips' own sound.
export function audioGraph({ clips, total, fade = 0.08, tone = true, toneDb = -46, music = null, musicDb = -18, clipDb = 0 }) {
  const inputs = [], parts = [], used = [];
  clips.forEach((c, i) => {
    if (!c.audio) return; const k = used.length; inputs.push('-ss', String(c.start), '-t', String(c.dur.toFixed(3)), '-i', c.file);
    const fi = Math.min(c.fadeIn ?? fade, c.dur / 2), fo = Math.min(c.fadeOut ?? fade, c.dur / 2), ms = Math.round(c.at * 1000);
    parts.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${clipDb}dB,afade=t=in:st=0:d=${fi.toFixed(3)}:curve=qsin,afade=t=out:st=${(c.dur - fo).toFixed(3)}:d=${fo.toFixed(3)}:curve=qsin,adelay=${ms}|${ms}[c${i}]`); used.push(`[c${i}]`);
  });
  const n = used.length, body = used.length ? `${used.join('')}amix=inputs=${used.length}:normalize=0:duration=longest,apad=whole_dur=${total.toFixed(3)}[clips]` : `anullsrc=r=48000:cl=stereo,atrim=0:${total.toFixed(3)}[clips]`, mix = ['[clips]'], extra = [];
  if (tone) { extra.push(`anoisesrc=c=brown:r=48000:a=0.5:d=${total.toFixed(3)},lowpass=f=500,volume=${toneDb}dB,aformat=channel_layouts=stereo[tone]`); mix.push('[tone]'); }
  if (music) { const k = n; inputs.push('-stream_loop', '-1', '-i', music); extra.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(3)},volume=${musicDb}dB,afade=t=in:st=0:d=1.5,afade=t=out:st=${Math.max(0, total - 2).toFixed(3)}:d=2[bed]`, '[clips]asplit[clips1][clips2]', '[bed][clips2]sidechaincompress=threshold=0.04:ratio=5:attack=20:release=300[ducked]'); mix[0] = '[clips1]'; mix.push('[ducked]'); }
  const graph = [...parts, body, ...extra, `${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=longest,atrim=0:${total.toFixed(3)}[mix]`].join(';');
  return { inputs, graph };
}

// How a join inside one scene is made, by how much the last frame of one clip differs from the first of the next (0 to 255, on a 32 x 32 grey copy): the same picture is a cut, a hair of a difference
// (a frame missing, a small step) is smoothed by a 0.17 s dissolve, a clear difference is dissolved over 0.4 s, and a large one (the clip was cut early, the characters are elsewhere) goes through black,
// because a dissolve across two different arrangements shows both at once, a ghost.
export function joinKind(diff, plan = {}) {
  if (diff > (plan.dipAbove ?? 20)) return { soft: false, dip: true, transition: 'fadeblack', d: plan.dipJoin ?? 0.6 };
  if (diff > (plan.dissolveAbove ?? 12)) return { soft: true, transition: 'dissolve', d: plan.dissolve ?? 0.4 };
  if (diff > (plan.microAbove ?? 1.5)) return { soft: true, transition: 'dissolve', d: plan.micro ?? 0.17 };
  return { soft: false };
}

// The generator's clips are 24 frames per second but move at 12: every second frame is a near copy of the one before (diffs 0.1, 1.4, 0.1, 1.4 ... on a 96 x 54 grey copy), so the motion judders and, where the pairing
// shifts (a trimmed start, a join), looks like a dropped frame. `cadence` says whether a clip is made of such pairs (and which frames are the real ones); `smoothClip` keeps the real frames and makes the missing
// ones by motion-compensated interpolation, so the clip moves at a true 24.
export function cadence(file, { from = 0, to = null, frames = 200 } = {}) { // of the part of the clip that is kept: the pairing differs from one part of a clip to another
  let raw; try { raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(from), ...(to ? ['-t', String(Math.max(0.5, to - from))] : []), '-i', file, '-frames:v', String(frames), '-vf', 'scale=96:54,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 }); } catch (e) { return null; }
  const W = 96 * 54, n = Math.floor(raw.length / W), d = []; for (let i = 0; i + 1 < n; i++) { let t = 0; for (let k = 0; k < W; k++) t += Math.abs(raw[i * W + k] - raw[(i + 1) * W + k]); d.push(t / W); }
  const avg = (par) => { const v = d.filter((_, i) => i % 2 === par); return v.reduce((a, b) => a + b, 0) / (v.length || 1); }, a = avg(0), b = avg(1), lo = Math.min(a, b), hi = Math.max(a, b);
  const mean = d.reduce((x, y) => x + y, 0) / (d.length || 1), jolt = d.length > 2 ? d.slice(1).reduce((x, y, i) => x + Math.abs(y - d[i]), 0) / (d.length - 1) / (mean || 1) : 0; // how much each step differs from the one before: a smooth clip 0.1 to 0.25, a stuttering one 0.45 and more
  return hi > 0.3 && (lo / hi < 0.85 || jolt > 0.33) ? { paired: true, keep: a < b ? 1 : 0, ratio: Math.round((lo / hi) * 100) / 100, jolt: Math.round(jolt * 100) / 100 } : { paired: false, ratio: Math.round((lo / (hi || 1)) * 100) / 100, jolt: Math.round(jolt * 100) / 100 }; // keep = the parity of the frames to keep: the second frame of a pair is the copy
}
export function smoothClip(file, out, keep = 0) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `select='eq(mod(n\\,2)\\,${keep})',setpts=N/12/TB,minterpolate=fps=24:mi_mode=mci:mc_mode=aobmc:vsbmc=1`, '-map', '0:v', '-map', '0:a?', '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', out]); return out;
}

// The working files (every clip brought to one format, the pieces, the smoothed clips) are hundreds of megabytes: they are removed when the film is made, or when it fails.
export function assemble(plan, outFile) {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-'));
  try { return assembleIn(plan, outFile, dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function assembleIn(plan, outFile, dir) {
  const fps = plan.fps || 24, fade = plan.fade ?? 0.08, dissolve = plan.dissolve ?? 0.4, norm = [];
  if (plan.smooth !== false) plan.clips = plan.clips.map((clip, i) => { const c = cadence(clip.file, { from: (clip.trim_start_frames ?? (clip.continues ? 2 : 0)) / (plan.fps || 24), to: clip.keep }); return c && c.paired ? { ...clip, file: smoothClip(clip.file, join(dir, `smooth-${i}.mp4`), c.keep), smoothed: true } : clip; }); // clips that move at 12 fps are brought to a true 24
  const cuts = plan.clips.map((clip) => { const p = probe(clip.file); return { ...cutOf(clip, p.seconds, fps), p, clip }; }), joins = [];
  let carry; // the zoom the clip before ended on, for a clip that continues it
  for (let i = 0; i < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1], endA = a.start + a.length; a.zoom = zoomOf(a.clip, a.length, carry); carry = undefined;
    if (!b) break;
    if (b.clip.continues === false && plan.sceneTransitions !== false) { joins.push(sceneJoin(a.clip.file, endA, b.clip.file, b.start, plan)); continue; } // a new scene: never a bare cut (a cut with the sound of the next scene starting is what looked odd)
    if (plan.joins === false || b.clip.continues === false) { if (b.clip.continues !== false) carry = zoomAt(a.zoom, a.length); joins.push({ soft: false }); continue; }
    const j = bestJoin(a.clip.file, a.start, endA, b.clip.file, b.start, { zoomA: (s) => zoomAt(a.zoom, s), atA: a.zoom.at, atB: b.clip.push_at || a.zoom.at }); carry = zoomAt(a.zoom, j.end - a.start); a.length = Math.max(0.2, j.end - a.start); Object.assign(j, joinKind(j.diff, plan)); if (!j.soft && j.diff < 0.6) { b.start = Math.round((b.start + 1 / fps) * 1000) / 1000; b.length = Math.max(0.2, b.length - 1 / fps); } /* the first frame of the next clip is the frame the clip before ended on: shown twice, it is a stall before the step */ joins.push(j); // the clip ends where it matches the next one best
  }
  const onFrames = (x) => Math.round(x * fps) / fps, length = (i) => Math.max(0.2, onFrames(cuts[i].length)); // every length is a whole number of frames, so a join never repeats or loses a frame to rounding
  cuts.forEach((c, i) => {
    const f = filterOf(plan, fade, length(i), c.zoom), out = join(dir, `part-${String(i).padStart(3, '0')}.mp4`);
    const input = ['-ss', String(c.start), '-t', String(length(i)), '-i', c.clip.file, ...(c.p.audio ? [] : ['-f', 'lavfi', '-t', String(length(i)), '-i', 'anullsrc=r=48000:cl=stereo']), '-map', '0:v', '-map', c.p.audio ? '0:a' : '1:a'];
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...input, '-vf', f.v, '-af', f.a, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', out]); norm.push(out);
  });
  const dj = joins.map((j, i) => (j.soft ? onFrames(Math.min(j.d ?? dissolve, length(i) / 3, length(i + 1) / 3)) : 0)); // each dissolve takes as much from the end of one clip as from the start of the next
  const halves = joins.map((j, i) => (j.dip ? { prev: Math.min(j.d / 2, length(i) / 2.5), next: Math.min(j.d / 2, length(i + 1) / 2.5) } : null)); // how long each side of a dip takes
  const enc = ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2'], parts = []; let soft = 0;
  norm.forEach((file, i) => {
    const softIn = i > 0 && joins[i - 1].soft, softOut = i + 1 < norm.length && joins[i].soft, ss = softIn ? dj[i - 1] : 0, t = length(i) - ss - (softOut ? dj[i] : 0), body = join(dir, `body-${i}.mp4`);
    const hIn = i > 0 && joins[i - 1].dip ? halves[i - 1].next : 0, hOut = i + 1 < norm.length && joins[i].dip ? halves[i].prev : 0, fades = [hIn > 0 && `fade=t=in:st=0:d=${hIn.toFixed(3)}`, hOut > 0 && `fade=t=out:st=${Math.max(0, t - hOut).toFixed(3)}:d=${hOut.toFixed(3)}`].filter(Boolean).join(','); // a dip: the clip before fades to black and the clip after fades up from black, one after the other, so no picture is lost to an overlap
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(ss), '-t', String(t), '-i', file, ...(fades ? ['-vf', fades] : []), ...enc, body]); parts.push(body);
    if (softOut) { // a dissolve over the tail of this clip and the head of the next, where the two pictures differ
      const dis = join(dir, `dissolve-${i}.mp4`), dd = dj[i];
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(length(i) - dd), '-t', String(dd), '-i', file, '-ss', '0', '-t', String(dd), '-i', norm[i + 1], '-filter_complex', `[0:v][1:v]xfade=transition=${joins[i].transition || 'fade'}:duration=${dd}:offset=0,format=yuv420p[v];[0:a][1:a]acrossfade=d=${dd}:c1=qsin:c2=qsin[a]`, '-map', '[v]', '-map', '[a]', ...enc, dis]); parts.push(dis); soft++;
    }
  });
  const list = join(dir, 'list.txt'); writeFileSync(list, parts.map((x) => `file '${x}'`).join('\n'));
  const joined = join(dir, 'joined.mp4'); execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
  const lead = plan.lead ?? 0.5; let at = 0; const timeline = cuts.map((c, i) => { const j = joins[i], k = joins[i - 1], t = at, avail = Math.max(0.2, c.p.seconds - c.start), extra = j && j.scene ? Math.min(lead, Math.max(0, avail - length(i))) : 0; at += length(i) - (dj[i] || 0); return { file: c.clip.file, start: c.start, dur: length(i) + extra, audio: c.p.audio, at: t, fadeIn: k && k.soft ? dj[i - 1] : k && k.dip ? halves[i - 1].next : undefined, fadeOut: j && j.soft ? dj[i] + extra : j && j.dip ? halves[i].prev + extra : undefined }; });
  const mixed = join(dir, 'mix.wav'), ag = audioGraph({ clips: timeline, total: probe(joined).seconds, fade, tone: plan.roomTone !== false, music: plan.music || null, musicDb: plan.musicDb ?? -18, clipDb: plan.clipDb ?? (plan.music ? -6 : 0) });
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...ag.inputs, '-filter_complex', ag.graph, '-map', '[mix]', '-ar', '48000', '-ac', '2', mixed]);
  const total = probe(joined).seconds, fin = plan.fadeIn ?? 0.6, fout = plan.fadeOut ?? 1.2, af = [fin > 0 && `afade=t=in:st=0:d=${fin}`, fout > 0 && `afade=t=out:st=${Math.max(0, total - fout - 0.3).toFixed(3)}:d=${fout + 0.3}`, plan.loudness !== false && 'loudnorm=I=-16:TP=-1.5:LRA=11'].filter(Boolean).join(','), vf = [fin > 0 && `fade=t=in:st=0:d=${fin}`, fout > 0 && `fade=t=out:st=${Math.max(0, total - fout).toFixed(3)}:d=${fout}`].filter(Boolean).join(','); // the film fades in from black and out to black; the sound fades out a little longer than the picture
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', joined, '-i', mixed, '-map', '0:v', '-map', '1:a', ...(vf ? ['-vf', vf, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p'] : ['-c:v', 'copy']), ...(af ? ['-af', af, '-c:a', 'aac', '-ar', '48000'] : ['-c:a', 'aac', '-ar', '48000']), '-shortest', outFile]);
  return { parts: norm.length, dissolved: soft, joins: joins.map((j) => (j.diff == null ? null : { end: j.end, diff: j.diff, soft: j.soft, ...(j.scene ? { scene: true, dY: j.dY } : {}), ...(j.transition ? { transition: j.transition, d: j.d } : {}) })), out: outFile };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [planFile, out] = process.argv.slice(2);
  if (!planFile || !out) { console.error('Usage: node scripts/assemble-film.mjs plan.json film.mp4'); process.exit(2); }
  const plan = JSON.parse(readFileSync(planFile, 'utf8')); plan.clips = plan.clips.map((c) => ({ ...c, file: resolve(planFile, '..', c.file) })); if (plan.music) plan.music = resolve(planFile, '..', plan.music);
  console.log(JSON.stringify(assemble(plan, resolve(out))));
}
