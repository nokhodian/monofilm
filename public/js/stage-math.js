// Scene staging maths, shared by the page (3D view, exports) and the MCP server (check_stage, stage_input).
// A stage is { units:'m', plate, set:[{id,type,name,shape,size:[w,h,d],pos:[x,y,z],rot:[x,y,z]|number,must_keep,note}],
//   characters:[{id,cast,anchor,pos,facing,pose,height,looking_at,note}], light, cameras:{A:{lens,pos,target,roll,move}}, shots:{'shot:H1':{camera:'A'}} }
// y is up, metres. Frame aspect comes from the style canon ("9:16"); sensor height is 36 mm for portrait and 24 mm for landscape.
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => { const l = Math.sqrt(dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const dist = (a, b) => Math.sqrt(dot(sub(a, b), sub(a, b)));

export const parseAspect = (s) => { const m = /^(\d+):(\d+)$/.exec(String(s || '')); return m ? [Number(m[1]), Number(m[2])] : [9, 16]; };
export const frame = (aspect, long = 960) => { const [w, h] = parseAspect(aspect); return w >= h ? [long, Math.round(long * h / w)] : [Math.round(long * w / h), long]; };

export function basis(cam) { const pos = cam.pos, f = norm(sub(cam.target, pos)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f); return { pos, f, r, u }; }
// Pixel position of a world point, or null if it is behind the camera.
export function project(p, cam, W, H) {
  const b = basis(cam), q = sub(p, b.pos), z = dot(q, b.f); if (z < 0.1) return null;
  const sensor = W < H ? 36 : 24, fpx = (H / 2) / ((sensor / 2) / cam.lens);
  return [W / 2 + fpx * dot(q, b.r) / z, H / 2 - fpx * dot(q, b.u) / z, z, fpx];
}
export function corners(o) { // eight corners of an object's box, rotated about y then placed
  const [w, h, d] = o.size || [0.5, 0.5, 0.5], ry = (Array.isArray(o.rot) ? o.rot[1] : o.rot || 0) * Math.PI / 180, c = Math.cos(ry), s = Math.sin(ry), out = [];
  for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) { const x = sx * w / 2, z = sz * d / 2; out.push([o.pos[0] + x * c + z * s, o.pos[1] + sy * h, o.pos[2] - x * s + z * c]); }
  return out;
}
export const charBox = (c) => corners({ pos: c.pos, size: [0.6, c.height || 1.7, 0.4], rot: c.facing || 0 });
const inFrame = (pts, cam, W, H) => pts.some((p) => { const q = project(p, cam, W, H); return q && q[0] >= 0 && q[0] <= W && q[1] >= 0 && q[1] <= H; });

// ---- words for the generators that cannot take control images ----
const side = (cam, p) => { const b = basis(cam), q = sub(p, b.pos), x = dot(q, b.r), z = Math.max(0.1, dot(q, b.f)), a = Math.atan2(x, z) * 180 / Math.PI; return a < -12 ? 'left' : a > 12 ? 'right' : 'centre'; };
const depthWord = (cam, p) => { const d = dist(p, cam.pos); return d < 3 ? 'foreground' : d < 7 ? 'midground' : 'background'; };
const facingWord = (cam, c) => { const f = [Math.sin((c.facing || 0) * Math.PI / 180), 0, Math.cos((c.facing || 0) * Math.PI / 180)], to = norm(sub(cam.pos, c.pos)), d = dot(f, to), r = dot(cross(to, [0, 1, 0]), f); return d > 0.85 ? 'facing the camera' : d < -0.85 ? 'facing away from the camera' : r > 0 ? 'facing left' : 'facing right'; };
export function composePrompt(stage, shotRef, style = {}) {
  const cam = (stage.cameras || {})[((stage.shots || {})[shotRef] || {}).camera]; if (!cam) return '';
  const h = cam.pos[1], low = h < 0.8 ? 'low angle' : h > 2.2 ? 'high angle' : 'eye-level', mv = cam.move && cam.move.type && cam.move.type !== 'static' ? `, ${cam.move.type}${cam.move.seconds ? ` over ${cam.move.seconds} s` : ''}` : ', static camera';
  const people = (stage.characters || []).map((c) => `${c.id[0].toUpperCase()}${c.id.slice(1)} ${depthWord(cam, c.pos)} ${side(cam, c.pos)}, ${facingWord(cam, c)}, ${c.pose || 'standing'}${c.looking_at ? `, looking at ${c.looking_at}` : ''}`);
  const things = (stage.set || []).filter((o) => o.type !== 'light').map((o) => `${o.name || o.id} ${depthWord(cam, o.pos)} ${side(cam, o.pos)}`);
  return [`${cam.lens} mm lens, ${low}, camera ${h.toFixed(1)} m high${mv}.`, people.length ? `${people.join('. ')}.` : '', things.length ? `In the scene: ${things.join('; ')}.` : '', stage.light && stage.light.key ? `Key light ${stage.light.key.tone || ''} from the ${(stage.light.key.dir || [0])[0] < 0 ? 'left' : 'right'}.` : '', style.rules ? `Rules: ${style.rules}` : ''].filter(Boolean).join(' ');
}

// ---- checks, same shape as the cut checks: [{lvl, txt}] ----
export function checkStage(stage, { aspect = '9:16', cast = null } = {}) {
  const out = [], add = (lvl, txt) => out.push({ lvl, txt }), [W, H] = frame(aspect);
  const all = [...(stage.set || []), ...(stage.characters || [])], ids = all.map((x) => x.id), cams = stage.cameras || {};
  if (!all.length) add('bad', 'The stage is empty.');
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i); if (dup.length) add('bad', `Duplicate ids: ${[...new Set(dup)].join(', ')}.`);
  if (!Object.keys(cams).length) add('bad', 'No camera defined.');
  if (cast) for (const c of stage.characters || []) if (c.cast && !cast.includes(c.cast)) add('bad', `${c.id} points at ${c.cast}, which is not in the cast.`);
  for (const c of stage.characters || []) if (!c.anchor) add('warn', `${c.id} has no anchor image, so generators will invent the face.`);
  for (const [ref, s] of Object.entries(stage.shots || {})) {
    const cam = cams[s.camera]; if (!cam) { add('bad', `${ref} uses camera ${s.camera}, which does not exist.`); continue; }
    for (const c of stage.characters || []) if (!inFrame(charBox(c), cam, W, H)) add('warn', `${c.id} is out of frame in ${ref} (camera ${s.camera}).`);
    for (const o of (stage.set || []).filter((x) => x.must_keep)) if (!inFrame(corners(o), cam, W, H)) add('warn', `${o.name || o.id} must stay in every shot but is not visible in ${ref} (camera ${s.camera}).`);
    for (const o of stage.set || []) { const cs = corners(o), lo = [0, 1, 2].map((i) => Math.min(...cs.map((p) => p[i]))), hi = [0, 1, 2].map((i) => Math.max(...cs.map((p) => p[i]))); if ([0, 1, 2].every((i) => cam.pos[i] > lo[i] && cam.pos[i] < hi[i])) add('bad', `Camera ${s.camera} is inside ${o.name || o.id}.`); }
  }
  const chars = stage.characters || [];
  for (let i = 0; i < chars.length; i++) for (let j = i + 1; j < chars.length; j++) if (dist(chars[i].pos, chars[j].pos) < 0.4) add('warn', `${chars[i].id} and ${chars[j].id} stand in the same place.`);
  const unused = Object.keys(cams).filter((k) => !Object.values(stage.shots || {}).some((s) => s.camera === k)); if (unused.length) add('warn', `Camera ${unused.join(', ')} is not used by any shot.`);
  if (!out.some((x) => x.lvl !== 'ok')) add('ok', 'Layout checks pass: everyone is in frame, must-keep objects are visible, no camera is inside an object.');
  return out;
}

// ---- mannequins ----
const P0 = { p: [0, .95, 0], n: [0, 1.45, 0], h: [0, 1.66, 0], sl: [-.2, 1.42, 0], sr: [.2, 1.42, 0], el: [-.26, 1.15, 0], er: [.26, 1.15, 0], hl: [-.28, .9, 0], hr: [.28, .9, 0], kl: [-.1, .5, 0], kr: [.1, .5, 0], fl: [-.1, 0, 0], fr: [.1, 0, 0] };
const mk = (o) => ({ ...P0, ...o });
export const POSES = {
  stand: mk({}),
  walk: mk({ kl: [-.1, .52, .2], fl: [-.1, .05, .42], kr: [.1, .5, -.1], fr: [.1, 0, -.3], el: [-.26, 1.15, .2], er: [.26, 1.15, -.2], hl: [-.28, .95, .32], hr: [.28, .95, -.28] }),
  point: mk({ er: [.3, 1.45, .25], hr: [.36, 1.45, .72] }),
  kneel: mk({ p: [0, .55, 0], n: [0, 1.05, .05], h: [0, 1.27, .08], sl: [-.2, 1.02, .05], sr: [.2, 1.02, .05], el: [-.25, .8, .1], er: [.25, .8, .1], hl: [-.2, .62, .3], hr: [.2, .62, .3], kl: [-.1, .5, .38], fl: [-.1, 0, .38], kr: [.1, .05, -.05], fr: [.1, .05, -.45] }),
  recoil: mk({ p: [0, .95, -.1], n: [0, 1.45, -.18], h: [0, 1.62, -.34], el: [-.3, 1.3, .1], er: [.3, 1.3, .1], hl: [-.24, 1.5, .3], hr: [.24, 1.5, .3] }),
  sit: mk({ p: [0, .5, 0], n: [0, 1.0, 0], h: [0, 1.21, 0], sl: [-.2, .97, 0], sr: [.2, .97, 0], el: [-.25, .75, .15], er: [.25, .75, .15], hl: [-.2, .62, .35], hr: [.2, .62, .35], kl: [-.1, .5, .45], fl: [-.1, 0, .45], kr: [.1, .5, .45], fr: [.1, 0, .45] }),
};
export const BONES = [['p', 'n'], ['n', 'sl'], ['n', 'sr'], ['sl', 'el'], ['el', 'hl'], ['sr', 'er'], ['er', 'hr'], ['p', 'kl'], ['kl', 'fl'], ['p', 'kr'], ['kr', 'fr'], ['sl', 'sr'], ['n', 'h']];
// World positions of a character's joints: pose, scaled to its height, turned to face `facing` degrees (0 faces +z).
export function joints(c) {
  const t = (c.facing || 0) * Math.PI / 180, k = (c.height || 1.7) / 1.7, P = POSES[c.pose] || POSES.stand, out = {};
  for (const j in P) { const l = P[j]; out[j] = [c.pos[0] + k * (l[0] * Math.cos(t) + l[2] * Math.sin(t)), c.pos[1] + k * l[1], c.pos[2] + k * (-l[0] * Math.sin(t) + l[2] * Math.cos(t))]; }
  return out;
}

// ---- camera moves ----
export const MOVES = ['static', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'orbit'];
// Where the camera ends up for a named move; the stage stores it as move.to so a human can drag it.
export function moveEnd(cam) {
  const m = cam.move || {}, f = norm(sub(cam.target, cam.pos)), r = norm(cross(f, [0, 1, 0])), d = dist(cam.pos, cam.target), at = (v, k) => [cam.pos[0] + v[0] * k, cam.pos[1] + v[1] * k, cam.pos[2] + v[2] * k];
  if (m.to) return { pos: m.to, target: m.target_to || cam.target };
  if (m.type === 'push-in') return { pos: at(f, d * 0.35), target: cam.target };
  if (m.type === 'pull-out') return { pos: at(f, -d * 0.35), target: cam.target };
  if (m.type === 'pan-left') return { pos: cam.pos, target: at(r, -d * 0.4).map((v, i) => v + (cam.target[i] - cam.pos[i])) };
  if (m.type === 'pan-right') return { pos: cam.pos, target: at(r, d * 0.4).map((v, i) => v + (cam.target[i] - cam.pos[i])) };
  if (m.type === 'orbit') { const a = 0.5, q = sub(cam.pos, cam.target); return { pos: [cam.target[0] + q[0] * Math.cos(a) + q[2] * Math.sin(a), cam.pos[1], cam.target[2] - q[0] * Math.sin(a) + q[2] * Math.cos(a)], target: cam.target }; }
  return { pos: cam.pos, target: cam.target };
}
export function cameraPath(cam, fps = 12) {
  const m = cam.move || {}, secs = Number(m.seconds) || 0, e = moveEnd(cam), n = !m.type || m.type === 'static' || !secs ? 1 : Math.max(2, Math.round(secs * fps) + 1), lerp = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  return Array.from({ length: n }, (_, i) => { const k = n === 1 ? 0 : i / (n - 1); return { t: Math.round(k * secs * 100) / 100, pos: lerp(cam.pos, e.pos, k).map((v) => Math.round(v * 1000) / 1000), target: lerp(cam.target, e.target, k).map((v) => Math.round(v * 1000) / 1000) }; });
}

// ---- adherence: where a generated picture put things, against where the stage said ----
const bbox = (pts, cam, W, H) => { const q = pts.map((p) => project(p, cam, W, H)).filter(Boolean); if (q.length < pts.length / 2) return null; const x = q.map((p) => p[0]), y = q.map((p) => p[1]); const b = [Math.max(0, Math.min(...x)) / W, Math.max(0, Math.min(...y)) / H, Math.min(W, Math.max(...x)) / W, Math.min(H, Math.max(...y)) / H]; return b[2] - b[0] > 0.01 && b[3] - b[1] > 0.01 ? b : null; };
// What should be visible, as boxes in 0..1 of the frame, and the one noun phrase SAM is asked to find each by.
export function expectedBoxes(stage, shotRef, aspect = '9:16') {
  const cam = (stage.cameras || {})[((stage.shots || {})[shotRef] || {}).camera]; if (!cam) return [];
  const [W, H] = frame(aspect), out = [];
  for (const c of stage.characters || []) { const b = bbox(charBox(c), cam, W, H); if (b) out.push({ id: c.id, type: 'character', concept: 'person', box: b }); }
  for (const o of stage.set || []) if (o.type !== 'light') { const b = bbox(corners(o), cam, W, H); if (b) out.push({ id: o.id, type: o.type, concept: String(o.find_as || o.name || o.id).toLowerCase(), box: b }); }
  return out;
}
export const iou = (a, b) => { const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])), i = w * h, u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i; return u > 0 ? i / u : 0; };
// found: { concept: [{box, conf}] }. People are matched to characters greedily by overlap so two people never claim one detection.
export function compareAdherence(expected, found) {
  const used = new Set(), rows = [];
  for (const e of [...expected].sort((a, b) => (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]))) {
    const mid = (x) => [(x[0] + x[2]) / 2, (x[1] + x[3]) / 2], cands = (found[e.concept] || []).map((d, i) => ({ d, i, k: `${e.concept}#${i}`, s: iou(e.box, d.box), far: Math.hypot(mid(d.box)[0] - mid(e.box)[0], mid(d.box)[1] - mid(e.box)[1]) })).filter((c) => !used.has(c.k)).sort((a, b) => b.s - a.s || a.far - b.far), best = cands[0]; // nearest wins when nothing overlaps, so a person far off their mark is reported as drift, not as missing
    if (!best) { rows.push({ id: e.id, type: e.type, expected: e.box, found: null, iou: 0, verdict: 'missing', note: `${e.id} was not found in the picture.` }); continue; }
    used.add(best.k); const f = best.d.box, cx = (x) => (x[0] + x[2]) / 2, cy = (x) => (x[1] + x[3]) / 2, dx = cx(f) - cx(e.box), dy = cy(f) - cy(e.box), sc = (f[2] - f[0]) / Math.max(0.01, e.box[2] - e.box[0]);
    const pct = (v) => `${Math.round(Math.abs(v) * 100)}%`, bits = [Math.abs(dx) > 0.06 && `${pct(dx)} too far ${dx < 0 ? 'left' : 'right'}`, Math.abs(dy) > 0.06 && `${pct(dy)} too ${dy < 0 ? 'high' : 'low'}`, Math.abs(sc - 1) > 0.25 && `${sc > 1 ? 'too big' : 'too small'} (${Math.round(sc * 100)}% of planned width)`].filter(Boolean);
    const verdict = best.s >= 0.5 ? 'ok' : best.s >= 0.25 ? 'drift' : 'off';
    rows.push({ id: e.id, type: e.type, expected: e.box, found: f, iou: Math.round(best.s * 100) / 100, dx: Math.round(dx * 100) / 100, dy: Math.round(dy * 100) / 100, scale: Math.round(sc * 100) / 100, verdict, note: verdict === 'ok' ? `${e.id} is where the stage put it.` : `${e.id} is ${bits.join(', ') || 'off its mark'} (overlap ${Math.round(best.s * 100)}%).` });
  }
  const score = rows.length ? Math.round(100 * rows.reduce((a, r) => a + r.iou, 0) / rows.length) / 100 : 0;
  return { score, rows, summary: rows.filter((r) => r.verdict !== 'ok').map((r) => r.note) };
}
