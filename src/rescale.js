// A local repair for a character drawn at the wrong size (GenScale, res-045: cut the character out, rescale it, put it back with its feet on the same ground point and fill the
// seam took plausible relative sizes from 11.7% to 88.3%; asking the image model to "redraw it 1.3 times bigger" is often ignored). A Worker has no canvas, so this works on raw pixels:
// SAM gives the character's mask (not only its box), src/png.js reads and writes the picture, and the hole the old character leaves is filled by diffusion from its surroundings.
import { samMasks, dataUrl, ownBoxes } from './meta.js';
import { decodePng, encodePng } from './png.js';
import { attachAsset } from './store.js';
import { id8 } from './util.js';

// ---- the mask: SAM's "one_bit" payload is base85 around an adaptive binary range coder (grammar: dev.meta.ai/docs/sam/reading-segmentation) ----
const ALPHA = (() => { let a = ''; for (let c = 0x21; c <= 0x7e; c++) if (!'"\\,;<>|'.includes(String.fromCharCode(c))) a += String.fromCharCode(c); return a; })();
function unpack85(p) {
  const v = (i) => { const k = ALPHA.indexOf(p[i]); if (k < 0) throw new Error('bad mask character'); return k; };
  let len = 0; for (let i = 0; i < 5; i++) len = len * 85 + v(i);
  const out = new Uint8Array(len), rem = len % 4; let s = 5;
  for (let d = 0; d < len; d += 4) { const n = d + 4 <= len ? 4 : rem; let x = 0; for (let i = 0; i < 5; i++) x = x * 85 + (i < n + 1 ? v(s + i) : 84); s += n === 4 ? 5 : n + 1; for (let i = 0; i < n; i++) out[d + i] = (x >>> (24 - 8 * i)) & 255; }
  return out;
}
export function decodeMask({ h, w, payload }) {
  if (!payload.startsWith('!')) throw new Error('only one_bit masks are read'); // "~" is the lossless coder; it is not asked for
  const inp = unpack85(payload.slice(1)); if (inp.length < 4 || w * h > 1 << 26) throw new Error('bad mask');
  let pos = 0, low = 0, range = 0xffffffff, code = 0, scaled = 0; const rd = () => { if (pos >= inp.length) throw new Error('mask ended early'); return inp[pos++]; };
  for (let i = 0; i < 4; i++) code = ((code << 8) | rd()) >>> 0;
  const counts = new Uint16Array(4096 * 2).fill(1), pw = w + 4, pad = new Uint8Array(pw * (h + 2)), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y + 2) * pw + 2 + x, u = p - pw, e = p - 2 * pw;
    const ctx = pad[p - 1] | (pad[p - 2] << 1) | (pad[u - 2] << 2) | (pad[u - 1] << 3) | (pad[u] << 4) | (pad[u + 1] << 5) | (pad[u + 2] << 6) | (pad[e - 2] << 7) | (pad[e - 1] << 8) | (pad[e] << 9) | (pad[e + 1] << 10) | (pad[e + 2] << 11), o = ctx << 1, zero = counts[o], tot = zero + counts[o + 1];
    scaled = Math.floor(range / tot); if (!scaled) throw new Error('bad mask');
    const bit = Math.min(tot - 1, Math.floor(((code - low) >>> 0) / scaled)) < zero ? 0 : 1, cum = bit ? zero : 0, fr = bit ? tot - zero : zero;
    low = (low + scaled * cum) >>> 0; range = scaled * fr;
    while (((low ^ (low + range)) >>> 0) < 1 << 24 || (range < 1 << 16 && ((range = ((-low >>> 0) & 0xffff)), true))) { code = ((code << 8) | rd()) >>> 0; low = (low << 8) >>> 0; range = (range << 8) >>> 0; }
    pad[p] = out[y * w + x] = bit; counts[o + bit] += 14; if (counts[o] + counts[o + 1] >= 4096) { counts[o] = counts[o] >> 1 || 1; counts[o + 1] = counts[o + 1] >> 1 || 1; }
  }
  return out;
}

// ---- raster helpers (alpha is Float32 0..1, a region is {x0,y0,w,h} of the picture) ----
const maxFilter = (a, w, h, r) => { // separable box dilation of a 0/1 raster
  const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && !m; k++) m = a[y * w + k]; t[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && !m; k++) m = t[k * w + x]; o[y * w + x] = m; }
  return o;
};
const blur = (a, w, h, r) => { // box blur of a float raster, enough to soften an edge a pixel or two
  const t = new Float32Array(w * h), o = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -r; k <= r; k++) s += a[y * w + Math.min(w - 1, Math.max(0, x + k))]; t[y * w + x] = s / n; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -r; k <= r; k++) s += t[Math.min(h - 1, Math.max(0, y + k)) * w + x]; o[y * w + x] = s / n; }
  return o;
};
// Fill the unknown pixels (known = 0) from the known ones: average down a pyramid, then push the coarse colours back up where nothing is known. Smooth, never a copy of the character.
function pushPull(rgb, known, w, h) {
  const lv = [{ w, h, c: Float32Array.from(rgb, (v, i) => v * known[Math.floor(i / 3)]), k: Float32Array.from(known) }];
  while (lv[lv.length - 1].w > 1 || lv[lv.length - 1].h > 1) {
    const s = lv[lv.length - 1], nw = Math.ceil(s.w / 2), nh = Math.ceil(s.h / 2), c = new Float32Array(nw * nh * 3), k = new Float32Array(nw * nh);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const i = y * s.w + x, j = (y >> 1) * nw + (x >> 1); k[j] += s.k[i]; for (let q = 0; q < 3; q++) c[j * 3 + q] += s.c[i * 3 + q]; }
    lv.push({ w: nw, h: nh, c, k });
  }
  const norm = (l) => { for (let i = 0; i < l.k.length; i++) if (l.k[i] > 0) for (let q = 0; q < 3; q++) l.c[i * 3 + q] /= l.k[i]; }; // colour is now an average; k is a count
  const fillFrom = (l, up) => { for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) { const i = y * l.w + x; if (l.k[i] > 0) continue; for (let q = 0; q < 3; q++) l.c[i * 3 + q] = up(x, y, q); } };
  lv.forEach(norm);
  for (let d = lv.length - 2; d >= 0; d--) { const l = lv[d], u = lv[d + 1]; fillFrom(l, (x, y, q) => { const fx = Math.max(0, (x + 0.5) / 2 - 0.5), fy = Math.max(0, (y + 0.5) / 2 - 0.5), x0 = Math.min(u.w - 1, Math.floor(fx)), y0 = Math.min(u.h - 1, Math.floor(fy)), x1 = Math.min(u.w - 1, x0 + 1), y1 = Math.min(u.h - 1, y0 + 1), tx = fx - x0, ty = fy - y0, g = (a, b) => u.c[(b * u.w + a) * 3 + q]; return (g(x0, y0) * (1 - tx) + g(x1, y0) * tx) * (1 - ty) + (g(x0, y1) * (1 - tx) + g(x1, y1) * tx) * ty; }); }
  return lv[0].c;
}

// A smooth fill shows as a smudge on a textured ground. In blocks, the fine detail (the picture minus its blur) of a stretch of known ground nearby is added to it:
// the stretch chosen is the one whose blurred colours are closest to the fill (and a little nearer is better). Detail has no edges of its own to show a seam; a block with no known stretch keeps the smooth fill.
function textured(fill, pic, hole, alpha, w, h) {
  const BL = 72, STEP = 24, mix = new Float32Array(fill.length), low = new Float32Array(fill.length), out = Float32Array.from(fill);
  for (let i = 0; i < w * h; i++) for (let q = 0; q < 3; q++) mix[i * 3 + q] = hole[i] ? fill[i * 3 + q] : pic[i * 3 + q];
  for (let q = 0; q < 3; q++) { const ch = blur(Float32Array.from({ length: w * h }, (_, i) => mix[i * 3 + q]), w, h, 5); for (let i = 0; i < w * h; i++) low[i * 3 + q] = ch[i]; }
  const offs = []; for (let j = -10; j <= 10; j++) for (let i = -10; i <= 10; i++) if (i || j) offs.push([i * STEP, j * STEP]); offs.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2);
  for (let by = 0; by < h; by += BL) for (let bx = 0; bx < w; bx += BL) {
    const need = []; for (let y = by; y < Math.min(h, by + BL); y++) for (let x = bx; x < Math.min(w, bx + BL); x++) if (hole[y * w + x] && alpha[y * w + x] < 0.999) need.push(y * w + x);
    if (!need.length) continue;
    let best = null;
    for (const [ox, oy] of offs) {
      let err = Math.hypot(ox, oy) * 0.02, ok = true;
      for (let n = 0; n < need.length && ok; n += 5) { const i = need[n], sx = (i % w) + ox, sy = Math.floor(i / w) + oy; if (sx < 0 || sx >= w || sy < 0 || sy >= h || hole[sy * w + sx]) ok = false; else for (let q = 0; q < 3; q++) err += Math.abs(fill[i * 3 + q] - low[(sy * w + sx) * 3 + q]) * 0.2; }
      if (ok && (!best || err < best.err)) best = { err, ox, oy };
    }
    if (!best) continue;
    const src = (i) => (Math.floor(i / w) + best.oy) * w + (i % w) + best.ox, mean = [0, 0, 0]; // the detail has no average of its own (a patch of rock would tint the block) and no extreme highlights
    for (const i of need) for (let q = 0; q < 3; q++) mean[q] += (pic[src(i) * 3 + q] - low[src(i) * 3 + q]) / need.length;
    for (const i of need) for (let q = 0; q < 3; q++) out[i * 3 + q] = fill[i * 3 + q] + Math.max(-22, Math.min(22, pic[src(i) * 3 + q] - low[src(i) * 3 + q] - mean[q]));
  }
  return out;
}

// ---- the repair ----
// Scale the character `factor` times about the point where it touches the ground (the middle of its lowest rows), so it grows up and sideways, never down into the floor.
export function rescaleOnPixels(img, hit, factor) {
  const { w: W, h: H, data } = img, { px: [bx1, by1, bx2, by2], mask } = hit, mw = mask.w, mh = mask.h, m = mask.raster || decodeMask(mask);
  const feet = []; for (let y = mh - 1; y >= Math.max(0, mh - 1 - Math.ceil(mh * 0.04)); y--) for (let x = 0; x < mw; x++) if (m[y * mw + x]) feet.push(x);
  if (!feet.length) throw new Error('the mask is empty');
  const ax = bx1 + feet.reduce((s, v) => s + v, 0) / feet.length, ay = by1 + mh - 1; // the ground point, in picture pixels
  let nx1 = Math.round(ax + (bx1 - ax) * factor), nx2 = Math.round(ax + (bx2 + 1 - ax) * factor); const ny1 = Math.round(ay + (by1 - ay) * factor), ny2 = Math.round(ay + 1);
  let dx = 0; if (nx1 < 0) dx = -nx1; else if (nx2 > W) dx = W - nx2; // a character that grows past the side of the frame is moved in, along the ground, not refused
  if (nx2 - nx1 > W || Math.abs(dx) > W * 0.3 || ny1 < -H * 0.03) throw new Error('the rescaled character would leave the frame'); // a repair that cuts a head off is worse than the fault
  nx1 += dx; nx2 += dx; const axd = ax + dx; // where the ground point lands
  // the margin M leaves room for a stretch of ground as big as the character, to borrow fine detail from
  const M = Math.max(mw, mh) + 16, R = { x0: Math.max(0, Math.min(bx1, nx1) - M), y0: Math.max(0, Math.min(by1, ny1) - M), x1: Math.min(W, Math.max(bx1 + mw, nx2) + M), y1: Math.min(H, Math.max(by1 + mh, ny2) + M) }, rw = R.x1 - R.x0, rh = R.y1 - R.y0;
  const old = new Uint8Array(rw * rh); for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (m[y * mw + x]) { const X = bx1 + x - R.x0, Y = by1 + y - R.y0; if (X >= 0 && X < rw && Y >= 0 && Y < rh) old[Y * rw + X] = 1; }
  const core = maxFilter(old.map((v) => 1 - v), rw, rh, 2).map((v) => 1 - v), hole = maxFilter(old, rw, rh, 6); // core: the mask pulled in two pixels (the hole is six wider, for the soft rim a mask leaves) so no old background rides along on the edge
  for (let X = 0; X < rw; X++) for (let Y = ay - R.y0 - 1; Y < rh; Y++) { if (Y < 0) continue; if (old[Y * rw + X]) core[Y * rw + X] = 1; if (Y > ay - R.y0) hole[Y * rw + X] = 0; } // the feet are not pulled in and nothing below them is painted over: the ground there is real
  // the cut-out, drawn at the new size: colour weighted by alpha so the edge carries no background colour
  const aSrc = Float32Array.from(core), rgb = new Float32Array(rw * rh * 3);
  for (let i = 0; i < rw * rh; i++) { const s = ((R.y0 + Math.floor(i / rw)) * W + R.x0 + (i % rw)) * 4; for (let q = 0; q < 3; q++) rgb[i * 3 + q] = data[s + q] * aSrc[i]; }
  const sample = (arr, ch, X, Y) => { const fx = Math.min(rw - 1, Math.max(0, X)), fy = Math.min(rh - 1, Math.max(0, Y)), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(rw - 1, x0 + 1), y1 = Math.min(rh - 1, y0 + 1), tx = fx - x0, ty = fy - y0, out = []; for (let q = 0; q < ch; q++) { const g = (a, b) => arr[(b * rw + a) * ch + q]; out.push((g(x0, y0) * (1 - tx) + g(x1, y0) * tx) * (1 - ty) + (g(x0, y1) * (1 - tx) + g(x1, y1) * tx) * ty); } return out; };
  const nA = new Float32Array(rw * rh), nC = new Float32Array(rw * rh * 3), ss = factor < 1 ? Math.ceil(1 / factor) : 1;
  for (let Y = Math.max(R.y0, ny1); Y < Math.min(R.y1, ny2); Y++) for (let X = Math.max(R.x0, nx1); X < Math.min(R.x1, nx2); X++) {
    let a = 0, c0 = 0, c1 = 0, c2 = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) { const sx = ax + (X + (i + 0.5) / ss - axd) / factor - 0.5 - R.x0, sy = ay + (Y + (j + 0.5) / ss - ay) / factor - 0.5 - R.y0, [al] = sample(aSrc, 1, sx, sy), [r, g, b] = sample(rgb, 3, sx, sy); a += al; c0 += r; c1 += g; c2 += b; }
    const o = (Y - R.y0) * rw + X - R.x0; nA[o] = a / (ss * ss); if (a > 0) { nC[o * 3] = c0 / a; nC[o * 3 + 1] = c1 / a; nC[o * 3 + 2] = c2 / a; }
  }
  const alpha = blur(nA, rw, rh, 1);
  // what the picture shows where the old character was: its surroundings, filled in (the new character covers most of it when it grows)
  const known = new Uint8Array(rw * rh).map((_, i) => 1 - hole[i]), pic = new Float32Array(rw * rh * 3);
  for (let i = 0; i < rw * rh; i++) { const s = ((R.y0 + Math.floor(i / rw)) * W + R.x0 + (i % rw)) * 4; for (let q = 0; q < 3; q++) pic[i * 3 + q] = data[s + q]; }
  const fill = textured(pushPull(pic, known, rw, rh), pic, hole, alpha, rw, rh), out = new Uint8ClampedArray(data);
  for (let i = 0; i < rw * rh; i++) { const s = ((R.y0 + Math.floor(i / rw)) * W + R.x0 + (i % rw)) * 4; for (let q = 0; q < 3; q++) { const base = hole[i] ? fill[i * 3 + q] : pic[i * 3 + q]; out[s + q] = base * (1 - alpha[i]) + nC[i * 3 + q] * alpha[i]; } }
  return { w: W, h: H, data: out, anchor: [Math.round(axd), Math.round(ay)] };
}

// Repair one size fault of a stored picture: `fix` = { concept, factor } (the character, and how many times bigger it must become). Returns PNG bytes, or null when it cannot be done (never throws).
export async function rescaleCharacter(env, uri, fix, f) {
  try {
    const o = await env.MEDIA.get(String(uri).replace(/^media\//, '')); if (!o || !(fix.factor > 0)) return null;
    const bytes = new Uint8Array(await o.arrayBuffer()), img = await decodePng(bytes);
    const image = dataUrl(bytes, 'image/png'), found = await Promise.all([fix.concept, ...(fix.others || [])].map((concept) => samMasks(env, { image, concept }, f).catch(() => [])));
    const hits = ownBoxes(found.map((l) => l.map((h) => ({ box: h.box, conf: h.conf, hit: h }))))[0].map((x) => x.hit).sort((a, b) => (b.conf || 0) - (a.conf || 0)); // not the box another character found with more confidence
    if (!hits.length) return null;
    const out = rescaleOnPixels(img, hits[0], Math.min(2, Math.max(0.5, fix.factor)));
    return await encodePng(out);
  } catch (e) { return null; }
}

// Repair a picture that failed the size check and keep the repair only if it is better. `check` is the failed result (it carries sizeFix), `recheck(uri)` looks at a picture again.
// Better = it passes, or the size fault is at most 80% as large as before and nothing else is wrong. Anything that goes wrong returns null: the unrepaired picture stays, nothing is blocked.
export async function repairSized(env, db, actor, pid, ref, uri, check, recheck, f) {
  const fix = check && check.sizeFix, key = `${pid}/fix-${id8()}.png`; let stored = false;
  try {
    if (!fix || !env.MEDIA || !(Math.abs(Math.log(fix.factor)) > 0.04)) return null;
    const png = await rescaleCharacter(env, uri, fix, f); if (!png) return null;
    await env.MEDIA.put(key, png, { httpMetadata: { contentType: 'image/png' } }); stored = true;
    const again = await recheck(`media/${key}`), worse = (c) => (c.sizeFix ? Math.abs(Math.log(c.sizeFix.factor)) : 0);
    if (!(again.ok || (again.kind === 'size' && worse(again) <= worse(check) * 0.8))) { await env.MEDIA.delete(key).catch(() => {}); return null; }
    const asset = await attachAsset(db, actor, pid, { ref, uri: `media/${key}`, mime: 'image/png', bytes: png.length, provenance: { tool: 'rescale-character', kind: 'image', meta: { concept: fix.concept, factor: Math.round(fix.factor * 100) / 100, from: uri } } }, { charged: true });
    return { asset, check: again };
  } catch (e) { if (stored) await env.MEDIA.delete(key).catch(() => {}); return null; }
}
