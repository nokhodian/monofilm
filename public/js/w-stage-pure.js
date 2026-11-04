// Pure helpers for the wizard's Stage and Pictures pages (no DOM, so node can test them: test/wizard-stage.test.js).
import { R, keyOf, clipPlan } from './wizard-model.js';
import { moveEnd, MOVES } from './stage-math.js';

export const STEP = 0.2; // metres per nudge click (the margin card's planOf says the same)
const r2 = (v) => Math.round(v * 100) / 100;
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'thing';
export const clipsOf = (d) => (d.clips && d.clips.length ? d.clips : clipPlan(d.seconds));

// A sensible first layout for a scene: its people (with their anchor faces), what the place must keep, one camera per clip.
//   d = the scene's data; cast(ref) -> canon.cast data or null; place(ref) -> canon.world data or null.
export function starterStage(id, d, cast, place) {
  const who = (d.who || []).filter((r) => cast(r)).slice(0, 5), clips = clipsOf(d);
  const characters = who.map((ref, i) => ({ id: keyOf(ref), cast: ref, anchor: cast(ref).anchor || '', pos: [r2((i - (who.length - 1) / 2) * (who.length > 3 ? 0.62 : 1.1)), 0, i % 2 ? -0.5 : 0.2], facing: who.length < 2 ? 0 : i < who.length / 2 ? 20 : -20, pose: 'stand', height: 1.7, looking_at: '', note: '' }));
  const keep = ((place(d.place) || {}).must_keep || []).map(String).filter(Boolean).slice(0, 4);
  if (!keep.some((k) => /beam/i.test(k)) && /\bbeam\b/i.test((d.notes || {}).happens || '')) keep.unshift('Main beam');
  const set = keep.map((name, i) => /beam/i.test(name)
    ? { id: slug(name), type: 'prop', name: cap(name), find_as: name.toLowerCase(), shape: 'box', size: [2.4, 0.3, 0.3], pos: [0, 2.3, -1.6], rot: [0, 0, 0], must_keep: true, note: '' }
    : { id: slug(name), type: 'prop', name: cap(name), find_as: name.toLowerCase(), shape: 'box', size: [0.6, 0.9, 0.6], pos: [r2(-1 + i * 0.9), 0, -1.8], rot: [0, 0, 0], must_keep: true, note: '' });
  if (!characters.length && !set.length) set.push({ id: 'mark', type: 'prop', name: 'Centre mark', find_as: 'mark', shape: 'box', size: [0.3, 0.1, 0.3], pos: [0, 0, 0], rot: [0, 0, 0], must_keep: false, note: 'Nobody is in this scene yet. Move this or add people.' });
  const word = String((d.notes || {}).cam || ''), type = /pull[- ]?out/i.test(word) ? 'pull-out' : /orbit/i.test(word) ? 'orbit' : /pan[- ]?left/i.test(word) ? 'pan-left' : /pan[- ]?right/i.test(word) ? 'pan-right' : 'push-in';
  const dist = 4.6 + 0.35 * Math.max(0, characters.length - 1), cameras = {}, shots = {};
  clips.forEach((c, i) => {
    const k = String.fromCharCode(65 + i), prev = cameras[String.fromCharCode(64 + i)];
    let cam;
    if (i && c.join !== 'cut' && prev) { const e = moveEnd(prev); cam = { lens: prev.lens, pos: e.pos.map(r2), target: e.target.map(r2), roll: 0, move: { type: 'static', seconds: c.seconds } }; } // continues where the clip before ended
    else cam = { lens: 35, pos: i ? [1.3, 1.5, dist * 0.95] : [0, 1.4, dist], target: i ? [-0.2, 1.2, 0] : [0, 1.2, 0], roll: 0, move: { type, seconds: c.seconds } };
    cameras[k] = cam; shots[R.shot(id, i + 1)] = { camera: k };
  });
  return { units: 'm', plate: null, set, characters, light: { key: { dir: [-1, -1, -0.5], tone: 'warm' } }, cameras, shots };
}

// The camera for one clip at its start or its end (a copy, ready for renderScene), or null.
export function camFor(stage, id, n, which) {
  const key = ((stage.shots || {})[R.shot(id, n)] || {}).camera || Object.keys(stage.cameras || {})[0], c = (stage.cameras || {})[key];
  if (!c) return null;
  if (which === 'start') return { ...c, key };
  const e = moveEnd(c); return { ...c, pos: e.pos, target: e.target, key };
}

// Move one person, object or camera by what the margin card collected: v = { dx, dz, face } (dx, dz in clicks of STEP metres). Returns false when the part is not on the stage.
export function nudgeStage(stage, part, v = {}) {
  const dx = (v.dx || 0) * STEP, dz = (v.dz || 0) * STEP, turn = v.face !== undefined && v.face !== 40 ? Math.round((v.face - 40) * 1.8) : 0, id = String(part).replace(/^obj:/, '');
  const mv = (p) => { if (p) { p[0] = r2(p[0] + dx); p[2] = r2(p[2] + dz); } };
  if (id.startsWith('cam-')) { const c = (stage.cameras || {})[id.slice(4)]; if (!c) return false; mv(c.pos); mv(c.target); if (c.move && c.move.to) mv(c.move.to); if (c.move && c.move.target_to) mv(c.move.target_to); return true; }
  const o = [...(stage.characters || []), ...(stage.set || [])].find((x) => x.id === id); if (!o) return false;
  mv(o.pos);
  if (turn) { if ((stage.characters || []).includes(o)) o.facing = ((o.facing || 0) + turn + 360) % 360; else o.rot = Array.isArray(o.rot) ? [o.rot[0] || 0, ((o.rot[1] || 0) + turn + 360) % 360, o.rot[2] || 0] : ((o.rot || 0) + turn + 360) % 360; }
  return true;
}

// The pictures a scene needs. The start picture belongs to clip 1, the end picture to the last clip; a later clip that begins with a cut has its own start picture.
export function slotsOf(id, d) {
  const clips = clipsOf(d), out = [];
  clips.forEach((c, i) => {
    const n = i + 1;
    if (n === 1) out.push({ which: 'start', clip: 1, ref: R.frame(id, 1, 'start'), mode: (d.start || {}).mode || 'stage', label: 'Start picture' });
    else if (c.join === 'cut') out.push({ which: 'start', clip: n, ref: R.frame(id, n, 'start'), mode: 'stage', label: `Start of clip ${n} (a cut)` });
    if (n === clips.length) out.push({ which: 'end', clip: n, ref: R.frame(id, n, 'end'), mode: (d.end || {}).mode || 'stage', label: 'End picture' });
  });
  return out;
}

// What a failed picture request means, in plain words, and where to go to fix it. id = the scene id.
export function plainError(msg, id) {
  const m = String(msg || '');
  if (/approve the look/i.test(m)) return { text: 'Approve the look first (step 3). Every picture is made from it.', href: '#/w/look', go: 'Go to the look' };
  if (/approve the scene brief/i.test(m)) return { text: 'Approve the scene brief first, so the pictures are made from something you have checked.', href: `#/w/scenes/${encodeURIComponent(id)}/brief`, go: 'Go to the Brief' };
  if (/over budget|credits|budget/i.test(m)) return { text: 'This production has used up its credit budget. That is the spending limit set inside Monofilm, not your Meta balance. Ask the person who runs this studio to add credits (the \"+ Credits\" button at the top, if you see it), then try again.' };
  if (/MODEL_API_KEY|Muse Image is off|503/i.test(m)) return { text: 'Muse Image is not available right now, so I cannot make pictures. Try again later.' };
  if (/failed to fetch|network/i.test(m)) return { text: 'I could not reach the studio. Check your connection and try again.' };
  return { text: `Something went wrong: ${m}` };
}

// The drift sentences of a SAM check: [['ok'|'warn', text]]
export const driftLines = (r) => (r.rows || []).map((x) => [x.verdict === 'ok' ? 'ok' : 'warn', `${x.id}: ${x.note}`]);

// ---- the floor plan: the stage seen from above (x to the right, z towards the viewer), so people, objects and cameras can be dragged ----
export const snap = (v) => Math.round(v * 20) / 20; // 5 cm
// Everything that can be grabbed: { kind: 'char' | 'obj' | 'cam' | 'aim', id, key, name, x, z }. A camera has two: its body and the point it looks at.
export function planItems(stage, nameOf = (c) => c.name || c.id) {
  const out = [];
  for (const c of stage.characters || []) out.push({ kind: 'char', id: c.id, name: nameOf(c), x: c.pos[0], z: c.pos[2] });
  for (const o of (stage.set || []).filter((x) => x.type !== 'light')) out.push({ kind: 'obj', id: o.id, name: o.name || o.id, x: o.pos[0], z: o.pos[2] });
  for (const [k, c] of Object.entries(stage.cameras || {})) { out.push({ kind: 'cam', id: `cam-${k}`, key: k, name: `Camera ${k}`, x: c.pos[0], z: c.pos[2] }); out.push({ kind: 'aim', id: `aim-${k}`, key: k, name: `Where camera ${k} looks`, x: c.target[0], z: c.target[2] }); }
  return out;
}
// The area the plan shows: everything on the stage, both ends of each camera move, with a margin, never smaller than 6 m across.
export function planBounds(stage, pad = 1.2) {
  const pts = planItems(stage).map((i) => [i.x, i.z]);
  for (const c of Object.values(stage.cameras || {})) { const e = moveEnd(c); pts.push([e.pos[0], e.pos[2]]); }
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]); let x0 = Math.min(...xs, 0) - pad, x1 = Math.max(...xs, 0) + pad, z0 = Math.min(...zs, 0) - pad, z1 = Math.max(...zs, 0) + pad;
  for (const [a, b, set] of [[x0, x1, (u, v) => { x0 = u; x1 = v; }], [z0, z1, (u, v) => { z0 = u; z1 = v; }]]) if (b - a < 6) set((a + b) / 2 - 3, (a + b) / 2 + 3);
  return { x0, x1, z0, z1 };
}
// The nearest grabbable thing within `tol` metres. Small handles win over the body of a person or object they sit on.
export function planHit(items, x, z, tol = 0.4) {
  let best = null, bd = tol; const rank = { aim: 0, cam: 1, char: 2, obj: 3 };
  for (const i of items) { const d = Math.hypot(i.x - x, i.z - z); if (d < bd || (best && d <= bd + 0.001 && rank[i.kind] < rank[best.kind])) { bd = Math.min(bd, d); best = i; } }
  return best;
}
// Move what was grabbed to (x, z) on the floor. A camera's body moves and keeps looking at its point; its explicit move end moves with it. Returns false if it is not on the stage.
export function moveTo(stage, hit, x, z) {
  const nx = snap(x), nz = snap(z);
  if (hit.kind === 'cam' || hit.kind === 'aim') {
    const c = (stage.cameras || {})[hit.key]; if (!c) return false;
    if (hit.kind === 'aim') { c.target[0] = nx; c.target[2] = nz; return true; }
    const dx = nx - c.pos[0], dz = nz - c.pos[2]; c.pos[0] = nx; c.pos[2] = nz;
    if (c.move && c.move.to) { c.move.to[0] = r2(c.move.to[0] + dx); c.move.to[2] = r2(c.move.to[2] + dz); }
    return true;
  }
  const o = [...(stage.characters || []), ...(stage.set || [])].find((q) => q.id === hit.id); if (!o) return false;
  o.pos[0] = nx; o.pos[2] = nz; return true;
}
// Lens and move of one camera. Returns false for a value that is not allowed.
export const LENSES = [24, 35, 50, 85];
export function setCamera(stage, key, { lens, move } = {}) {
  const c = (stage.cameras || {})[key]; if (!c) return false;
  if (lens !== undefined) { if (!LENSES.includes(Number(lens))) return false; c.lens = Number(lens); }
  if (move !== undefined) { if (!MOVES.includes(move)) return false; c.move = { ...(c.move || {}), type: move }; delete c.move.to; delete c.move.target_to; }
  return true;
}
