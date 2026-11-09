// The local size repair: SAM's mask, the PNG reader, the rescale about the feet, and the rule that a repair which cannot run or does not help never blocks or replaces the picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDb, human } from './d1.js';
import * as S from '../src/store.js';
import { REFS } from '../public/js/wizard-model.js';
import { decodePng, encodePng } from '../src/png.js';
import { decodeMask, rescaleOnPixels, repairSized, shrink } from '../src/rescale.js';
import { samMasks } from '../src/meta.js';
import { checkPicture } from '../src/picturecheck.js';

const SNAIL = fs.readFileSync(new URL('./fixtures/sam-snail.txt', import.meta.url), 'utf8'); // a real SAM answer (one_bit mask) for the snail in a 2240x1120 picture
const reply = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const samSays = (text) => async () => reply({ output_text: text });
const solid = (w, h, rgb) => { const data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4); return { w, h, data }; };

test('a PNG written by the studio is read back exactly, and a PNG that is not 8-bit is refused rather than misread', async () => {
  const img = solid(37, 23, [10, 20, 30]); img.data.set([200, 100, 50, 255], (5 * 37 + 7) * 4);
  const back = await decodePng(await encodePng(img)); assert.deepEqual([back.w, back.h], [37, 23]); assert.deepEqual([...back.data], [...img.data]);
  const bad = await encodePng(img); bad[24] = 16; await assert.rejects(decodePng(bad), /not supported/);
});

test("SAM's one_bit mask is decoded to the character's pixels, with the box it belongs to", async () => {
  const [hit] = await samMasks({ MODEL_API_KEY: 'k' }, { image: 'data:image/png;base64,', concept: 'snail' }, async (url, init) => { assert.equal(JSON.parse(init.body).metadata.mask_encoding, 'one_bit'); return reply({ output_text: SNAIL }); });
  assert.deepEqual(hit.px, [304, 480, 1032, 1030]); assert.equal(hit.conf > 0.9, true);
  const m = decodeMask(hit.mask); assert.equal(m.length, 551 * 729); assert.equal(m.reduce((s, v) => s + v, 0), 244109); // counted on the real answer; the mask covers about 60% of its box
  assert.equal(m[0], 0, 'the box corner is background'); assert.equal(m[Math.floor(275 * 729 + 250)], 1, 'the shell is inside');
  assert.throws(() => decodeMask({ ...hit.mask, payload: '~abc' }), /one_bit/); assert.throws(() => decodeMask({ ...hit.mask, payload: hit.mask.payload.slice(0, 40) }), Error);
});

test('the character is scaled about the point where it touches the ground, and what it leaves behind is the ground', () => {
  const W = 300, H = 200, ground = [120, 100, 60], img = solid(W, H, ground), mw = 40, mh = 50, raster = new Uint8Array(mw * mh).fill(1);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) img.data.set([220, 30, 30, 255], ((100 + y) * W + 100 + x) * 4); // a red block, feet at the bottom middle (120, 149)
  const hit = { px: [100, 100, 140, 150], mask: { w: mw, h: mh, raster } }, red = (o, x, y) => o.data[(y * W + x) * 4] > 170 && o.data[(y * W + x) * 4 + 1] < 70; // the edge is soft by a pixel
  const big = rescaleOnPixels(img, hit, 1.5); assert.deepEqual(big.anchor, [120, 149]);
  assert.ok(red(big, 120, 149) && red(big, 120, 90), 'feet where they were, and 1.5 times taller (75 rows: 75..149)'); assert.ok(red(big, 95, 130) && red(big, 144, 130), '60 wide around the middle'); assert.ok(!red(big, 120, 70) && !red(big, 150, 130) && !red(big, 120, 155));
  const small = rescaleOnPixels(img, hit, 0.6); assert.ok(red(small, 120, 147) && red(small, 120, 125), '30 rows: 120..149'); assert.ok(!red(small, 120, 110), 'the old head is gone');
  for (const [x, y] of [[105, 105], [135, 105], [100, 148], [139, 130]]) assert.deepEqual([...small.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)], ground, `${x},${y} shows ground, not a ghost`);
  assert.throws(() => rescaleOnPixels(img, { ...hit, px: [100, 0, 140, 50] }, 3.5), /leave the frame/);
  const edge = solid(W, H, ground); for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) edge.data.set([220, 30, 30, 255], ((100 + y) * W + 5 + x) * 4); // a block at the left edge, feet at (25, 149)
  const moved = rescaleOnPixels(edge, { px: [5, 100, 45, 150], mask: { w: mw, h: mh, raster } }, 2); assert.deepEqual(moved.anchor, [39, 149], 'it grows past the side of the frame and is moved in along the ground by the 14 pixels it needed');
  assert.ok(red(moved, 6, 140) && red(moved, 72, 140) && red(moved, 39, 60), 'whole, 80 wide, from the edge');
});

// the repair against a stand-in for Meta, on a plain 2240x1120 picture with the real snail mask
async function stage() {
  const db = makeDb(), { id } = await S.createProduction(db, human, { name: 'R', format: 'movie', budget: 20 }), objs = new Map(), png = await encodePng(solid(2240, 1120, [110, 120, 100]));
  await S.propose(db, human, id, { ref: REFS.story, data: { text: 'x' }, auto_approve: true }); objs.set('p/a.png', png);
  const MEDIA = { objs, put: async (k, b) => { objs.set(k, b); }, delete: async (k) => { objs.delete(k); }, get: async (k) => (objs.has(k) ? { arrayBuffer: async () => objs.get(k).buffer.slice(objs.get(k).byteOffset, objs.get(k).byteOffset + objs.get(k).byteLength) } : null) };
  return { db, id, MEDIA, env: { MODEL_API_KEY: 'k', MEDIA, REPAIR_MAX: 4000 } };
}
const failed = { ok: false, kind: 'size', sizeFix: { concept: 'snail', factor: 1.25 } };

test('a repaired picture is kept when it passes the check again, and stored as a new picture of the same item', async () => {
  const t = await stage(), r = await repairSized(t.env, t.db, human, t.id, REFS.story, 'media/p/a.png', failed, async (uri) => { assert.match(uri, /^media\/.+\/fix-/); assert.ok(t.MEDIA.objs.has(uri.replace(/^media\//, '')), 'the picture exists before it is looked at'); return { ok: true }; }, samSays(SNAIL));
  assert.ok(r && r.check.ok && /fix-/.test(r.asset.uri));
  const img = await decodePng(t.MEDIA.objs.get(r.asset.uri.replace(/^media\//, ''))); assert.deepEqual([img.w, img.h], [2240, 1120]);
  const art = await S.getArtifact(t.db, t.id, REFS.story), last = art.assets[art.assets.length - 1]; assert.equal(last.uri, r.asset.uri); assert.equal(last.provenance.tool, 'rescale-character'); assert.equal(last.provenance.meta.factor, 1.25);
});

test('a repair that does not help, cannot run or is not needed returns nothing and leaves nothing behind', async () => {
  const t = await stage(), before = t.MEDIA.objs.size, run = (check, recheck, f) => repairSized(t.env, t.db, human, t.id, REFS.story, 'media/p/a.png', check, recheck, f);
  assert.equal(await run(failed, async () => ({ ok: false, kind: 'size', sizeFix: { factor: 1.3 } }), samSays(SNAIL)), null, 'a worse size is not kept');
  assert.equal(await run(failed, async () => ({ ok: false, kind: 'being' }), samSays(SNAIL)), null, 'a new fault is not kept');
  assert.equal(await run(failed, async () => ({ ok: false, kind: 'size', sizeFix: { factor: 1.1 } }), samSays(SNAIL)) !== null, true, 'a smaller size fault is a step forward');
  const n = t.MEDIA.objs.size; assert.equal(n, before + 1, 'only the kept picture is stored');
  assert.equal(await run(failed, async () => ({ ok: true }), samSays('no match')), null, 'SAM finds nothing');
  assert.equal(await run(failed, async () => ({ ok: true }), async () => reply({}, 400)), null, 'SAM fails');
  assert.equal(await run({ ...failed, sizeFix: { concept: 'snail', factor: 1.01 } }, async () => ({ ok: true }), samSays(SNAIL)), null, 'a one percent fault is not worth touching');
  assert.equal(await run({ ok: false, kind: 'size' }, async () => ({ ok: true }), samSays(SNAIL)), null, 'no fix named');
  assert.equal(await run(failed, async () => { throw new Error('boom'); }, samSays(SNAIL)), null, 'the second look fails'); assert.equal(t.MEDIA.objs.size, n, 'and the unchecked picture is removed');
  assert.equal(await repairSized({ ...t.env, MEDIA: undefined }, t.db, human, t.id, REFS.story, 'media/p/a.png', failed, async () => ({ ok: true }), samSays(SNAIL)), null);
});

test('a size fault from the check names the character and the factor to put it right', async () => {
  const t = await stage(); t.MEDIA.objs.set('p/b.png', t.MEDIA.objs.get('p/a.png'));
  const box = (side) => `<|box;x1=100;y1=100;x2=${100 + side};y2=${100 + side};w=1000;h=1000;c=0.9|>`; let n = 0;
  const r = await checkPicture(t.env, 'media/p/b.png', 'x', async () => reply({ output_text: n++ % 2 === 0 ? box(400) : box(300) }), [], [], { baseUri: 'media/p/a.png', looks: [{ name: 'Moss', look: 'snail' }] });
  assert.equal(r.kind, 'size'); assert.equal(r.sizeFix.concept, 'snail'); assert.equal(Math.round(r.sizeFix.factor * 100) / 100, 1.33);
});

test('a large picture is averaged down before the repair so it fits a Worker, a small one is left alone', () => {
  const big = solid(2000, 1000, [100, 150, 200]), small = shrink(big, 1000); assert.deepEqual([small.w, small.h], [1000, 500]); assert.deepEqual([...small.data.subarray(0, 4)], [100, 150, 200, 255]);
  const mid = solid(800, 400, [1, 2, 3]); assert.equal(shrink(mid, 1000), mid);
});
