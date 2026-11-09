// Real check of the local size repair (src/rescale.js) on two pictures from disk, with the real SAM: measures the character in both, repairs the second to the size of the first, measures again.
// usage: MODEL_API_KEY=... node scripts/verify-rescale.mjs <reference.png> <picture.png> "<what SAM finds, e.g. snail>" <out.png>   (MODEL_API_KEY is read from .dev.vars when not set)
import fs from 'node:fs';
import { sam, dataUrl, ownBoxes } from '../src/meta.js';
import { rescaleCharacter } from '../src/rescale.js';

const [ref, pic, concept, outFile, others] = process.argv.slice(2);
const key = process.env.MODEL_API_KEY || (fs.readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/MODEL_API_KEY=(.*)/) || [])[1];
const env = { MODEL_API_KEY: String(key).trim(), MEDIA: { get: async (k) => ({ arrayBuffer: async () => fs.readFileSync(k) }) } };
const size = async (file) => { const img = dataUrl(fs.readFileSync(file), 'image/png'), lists = await Promise.all([concept, ...(others ? others.split(',') : [])].map((c) => sam(env, { image: img, concept: c }))), b = ownBoxes(lists)[0].sort((x, y) => (y.conf || 0) - (x.conf || 0))[0]; return b ? Math.sqrt((b.box[2] - b.box[0]) * (b.box[3] - b.box[1])) : 0; };
const [a, b] = [await size(ref), await size(pic)], factor = a / b;
console.log(`${concept}: reference ${a.toFixed(3)}, picture ${b.toFixed(3)} (${Math.round((b / a) * 100)}%), repair factor ${factor.toFixed(2)}`);
const t0 = Date.now(), png = await rescaleCharacter(env, pic, { concept, factor, others: others ? others.split(',') : [] });
if (!png) { console.log('the repair could not run'); process.exit(1); }
fs.writeFileSync(outFile, png);
const c = await size(outFile); console.log(`repaired: ${c.toFixed(3)} (${Math.round((c / a) * 100)}% of the reference) in ${Date.now() - t0} ms -> ${outFile}`);
