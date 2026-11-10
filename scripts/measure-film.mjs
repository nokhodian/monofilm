// Final check of a finished film: the size of every character every half second, measured by SAM on frames of the film itself, with the places where a size changes by more than 8% in a second (outside a dip).
//   node scripts/measure-film.mjs film.mp4 "grey-green snail:snail" "orange beetle:beetle"      (each argument: search words, then a fallback after a colon)
// MODEL_API_KEY is read from .dev.vars when not set. Needs ffmpeg.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dataUrl, ownBoxes, findBoxes } from '../src/meta.js';

const [film, ...who] = process.argv.slice(2); if (!film || !who.length) { console.error('Usage: node scripts/measure-film.mjs film.mp4 "grey-green snail:snail" ...'); process.exit(2); }
const key = process.env.MODEL_API_KEY || (fs.readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/MODEL_API_KEY=(.*)/) || [])[1], env = { MODEL_API_KEY: String(key).trim() };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-')), step = 0.5, seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', film], { encoding: 'utf8' }));
const people = who.map((w) => { const [concept, fallback] = w.split(':'); return { concept, fallback }; }), rows = [];
const times = []; for (let t = 0.25; t < seconds - 0.1; t += step) times.push(t);
const frame = (t) => { const f = path.join(dir, `f${Math.round(t * 100)}.jpg`); execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', film, '-frames:v', '1', '-vf', 'scale=640:-1', '-q:v', '3', f]); return dataUrl(fs.readFileSync(f), 'image/jpeg'); };
const retry = async (fn) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 3) return []; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); } } }; // the API refuses now and then when asked a lot
const size = (b) => (b ? Math.sqrt((b.box[2] - b.box[0]) * (b.box[3] - b.box[1])) : 0), top = (l) => l.slice().sort((x, y) => (y.conf || 0) - (x.conf || 0))[0];
for (let k = 0; k < times.length; k += 3) await Promise.all(times.slice(k, k + 3).map(async (t) => { const img = frame(t), own = ownBoxes(await Promise.all(people.map((p) => retry(() => findBoxes(env, img, p))))), mean = Number(execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', film, '-frames:v', '1', '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 16 })[0]); rows.push({ t, mean, sizes: own.map((l) => size(top(l))) }); }));
rows.sort((a, b) => a.t - b.t);
for (const r of rows) console.log(r.t.toFixed(2).padStart(6), r.mean < 25 ? '(dark)' : '      ', r.sizes.map((s) => (s ? s.toFixed(2) : ' -- ')).join('  '));
console.log('\nsize changes of more than 8% within a second, in pictures that are not dark:');
for (let p = 0; p < people.length; p++) for (let i = 0; i < rows.length; i++) { const a = rows[i]; if (a.mean < 25 || !a.sizes[p]) continue; const b = rows[i + 2]; if (b && b.mean >= 25 && b.sizes[p] && Math.abs(b.sizes[p] / a.sizes[p] - 1) > 0.08) console.log(`  ${people[p].concept}: ${a.t.toFixed(1)} s ${a.sizes[p].toFixed(2)} -> ${b.t.toFixed(1)} s ${b.sizes[p].toFixed(2)} (${Math.round((b.sizes[p] / a.sizes[p]) * 100)}%)`); }
fs.rmSync(dir, { recursive: true, force: true });
