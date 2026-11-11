// The size of every character in a set of pictures (the folder that scripts/film-sheet.py writes), measured by SAM: the fraction of the frame (square root of the box area) and the ratio of the first two.
//   node scripts/measure-pictures.mjs <folder> "grey-green snail:snail" "orange beetle:beetle"      MODEL_API_KEY is read from .dev.vars when not set.
import fs from 'node:fs';
import path from 'node:path';
import { dataUrl, ownBoxes, findBoxes } from '../src/meta.js';

const [dir, ...who] = process.argv.slice(2); if (!dir || !who.length) { console.error('Usage: node scripts/measure-pictures.mjs <folder> "kind words:fallback" ...'); process.exit(2); }
const key = process.env.MODEL_API_KEY || (fs.readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/MODEL_API_KEY=(.*)/) || [])[1], env = { MODEL_API_KEY: String(key).trim() };
const people = who.map((w) => { const [concept, fallback] = w.split(':'); return { concept, fallback }; }), files = fs.readdirSync(dir).filter((f) => /_c\d+-(start|end)\.png$/.test(f)).sort();
const size = (l) => { const b = l.slice().sort((x, y) => (y.conf || 0) - (x.conf || 0))[0]; return b ? Math.sqrt((b.box[2] - b.box[0]) * (b.box[3] - b.box[1])) : 0; };
for (const f of files) { const img = dataUrl(fs.readFileSync(path.join(dir, f)), 'image/png'), own = ownBoxes(await Promise.all(people.map((p) => findBoxes(env, img, p).catch(() => [])))).map(size); console.log(f.replace('.png', '').padEnd(30), own.map((v) => (v ? v.toFixed(2) : ' -- ')).join('  '), own.length > 1 && own[0] && own[1] ? `  ratio ${(own[0] / own[1]).toFixed(2)}` : ''); }
