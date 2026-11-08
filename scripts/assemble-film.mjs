// Joins finished clips into one film the way the knowledge base says to (docs/knowledge/playbook/principles.md, sections 3 and 6):
// every clip is brought to one size, frame rate, colour format and audio rate (scn-p-024); a frozen tail is trimmed (res-p-018); the first frames of a continued clip are cut away (scn-p-014);
// each clip's sound fades in and out for a short moment so a join does not click (aud-p-020); and the loudness is set once at the end (aud-p-019).
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

export function assemble(plan, outFile) {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-')), parts = [], fps = plan.fps || 24, fade = plan.fade ?? 0.08;
  plan.clips.forEach((clip, i) => {
    const p = probe(clip.file), { start, length } = cutOf(clip, p.seconds, fps), f = filterOf(plan, fade, length), out = join(dir, `part-${String(i).padStart(3, '0')}.mp4`);
    const input = ['-ss', String(start), '-t', String(length), '-i', clip.file, ...(p.audio ? [] : ['-f', 'lavfi', '-t', String(length), '-i', 'anullsrc=r=48000:cl=stereo']), '-map', '0:v', '-map', p.audio ? '0:a' : '1:a'];
    const args = ['-v', 'error', '-y', ...input, '-vf', f.v, '-af', f.a, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', out];
    execFileSync('ffmpeg', args); parts.push(out);
  });
  const list = join(dir, 'list.txt'); writeFileSync(list, parts.map((x) => `file '${x}'`).join('\n'));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'copy', ...(plan.loudness === false ? ['-c:a', 'copy'] : ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-ar', '48000']), outFile]);
  return { parts: parts.length, out: outFile };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [planFile, out] = process.argv.slice(2);
  if (!planFile || !out) { console.error('Usage: node scripts/assemble-film.mjs plan.json film.mp4'); process.exit(2); }
  const plan = JSON.parse(readFileSync(planFile, 'utf8')); plan.clips = plan.clips.map((c) => ({ ...c, file: resolve(planFile, '..', c.file) }));
  console.log(JSON.stringify(assemble(plan, resolve(out))));
}
