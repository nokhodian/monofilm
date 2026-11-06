// Measure a finished clip the same way the Pack page does, for a video model that works through MCP:
//   npm run measure -- clip.mp4      prints { seconds, hold, smooth, cuts } to pass to submit_take
// Needs ffmpeg. hold = seconds it stands still at the end, smooth = the biggest jump between pictures 0.2 s apart, cuts = hard cuts.
import { execFileSync, spawnSync } from 'node:child_process';
import { tailHold, smoothness } from '../public/js/pack.js';

const file = process.argv[2];
if (!file) { console.error('Usage: npm run measure -- <video file>'); process.exit(2); }
const W = 32, H = 32, FPS = 5, run = (args, opt = {}) => execFileSync('ffmpeg', ['-v', 'error', ...args], { maxBuffer: 1 << 28, ...opt });
let raw;
try { raw = run(['-i', file, '-vf', `fps=${FPS},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-']); } catch (e) { console.error('I could not read that video with ffmpeg.'); process.exit(1); }
const size = W * H, frames = Math.floor(raw.length / size), all = [];
for (let i = 0; i < frames; i++) all.push({ t: i / FPS, g: Array.from(raw.subarray(i * size, (i + 1) * size)) });
const seconds = Math.round((frames / FPS) * 10) / 10, step = (a, b) => a.g.reduce((s, x, i) => s + Math.abs(x - b.g[i]), 0) / a.g.length;
const smooth = smoothness(all.slice(1).map((s, i) => step(all[i], s)), 1 / FPS), hold = tailHold(all.filter((s) => s.t >= seconds - 4).reverse(), seconds);
const sc = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-vf', "select='gt(scene,0.4)',showinfo", '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }), cuts = ((sc.stderr || '').match(/pts_time/g) || []).length;
console.log(JSON.stringify({ seconds, hold, smooth, cuts }));
