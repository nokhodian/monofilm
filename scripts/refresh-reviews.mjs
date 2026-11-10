// Applies the current size rules (public/js/pack.js) to the sizes already measured in a folder's reviews.json, without asking the studio again: size_faults, settle and good_until are recomputed
// (a jump the judge saw, jump_until, is kept). Run it after the rules change.   node scripts/refresh-reviews.mjs <folder with state.json and reviews.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sizeFaults, settleOf, goodUntil } from '../public/js/pack.js';

const dir = process.argv[2]; if (!dir) { console.error('Usage: node scripts/refresh-reviews.mjs <folder>'); process.exit(2); }
const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')), reviews = JSON.parse(readFileSync(join(dir, 'reviews.json'), 'utf8'));
for (const [key, takes] of Object.entries(reviews)) for (const [attempt, r] of Object.entries(takes)) {
  if (!r.sizes) continue; const t = (state[key] || { takes: [] }).takes.find((x) => String(x.attempt) === attempt), seconds = t ? t.measure.seconds : 6.6;
  r.size_faults = sizeFaults(r.sizes, { seconds }); r.settle = settleOf(r.sizes, seconds); const until = [goodUntil(r.size_faults), r.jump_until].filter((x) => x != null); r.good_until = until.length ? Math.min(...until) : null;
  console.log(`${key} a${attempt}: settle ${r.settle} s, good until ${r.good_until ?? 'the end'}`);
}
writeFileSync(join(dir, 'reviews.json'), JSON.stringify(reviews, null, 1));
