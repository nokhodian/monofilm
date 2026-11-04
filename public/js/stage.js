// Scene staging: place characters, objects and cameras in 3D, then export what a generator needs to follow the layout.
import { $, esc, st, api, P, toast, chip, tag, isHuman, mediaSrc } from './core.js';
import { get, ofKind, createArtifact, editArtifact } from './data.js';
import { threadsHtml } from './feedback.js';
import { project, basis, sub, dot, cross, norm, dist, corners, joints, BONES, POSES, MOVES, moveEnd, cameraPath, frame, parseAspect, composePrompt, checkStage } from './stage-math.js';

const SHAPES = ['box', 'cylinder'], TYPES = ['prop', 'set', 'light'], PALETTE = (i) => `hsl(${(i * 67 + 20) % 360} 55% 58%)`, IDCOL = (i) => `hsl(${(i * 47) % 360} 100% 50%)`;
const keyOf = (ref) => ref.slice(ref.indexOf(':') + 1);
let S = null; // the open editor: { sceneRef, ref, stage, sel, view, dirty, plate, op }

// ---------- geometry ----------
function solids(stage) {
  return (stage.set || []).filter((o) => o.type !== 'light').map((o, i) => {
    const cs = corners(o), [w, h, d] = o.size || [.5, .5, .5];
    let faces;
    if (o.shape === 'cylinder') { const n = 12, ry = (Array.isArray(o.rot) ? o.rot[1] : o.rot || 0) * Math.PI / 180, ring = (y) => Array.from({ length: n }, (_, k) => { const a = k / n * Math.PI * 2, x = Math.cos(a) * w / 2, z = Math.sin(a) * d / 2; return [o.pos[0] + x * Math.cos(ry) + z * Math.sin(ry), o.pos[1] + y, o.pos[2] - x * Math.sin(ry) + z * Math.cos(ry)]; }), lo = ring(0), hi = ring(h); faces = [...lo.map((_, k) => [lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k]]), hi]; }
    else faces = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]].map((q) => q.map((j) => cs[j]));
    return { id: o.id, color: PALETTE(i), idColor: IDCOL(i), faces, obj: o };
  });
}
const faceNormal = (f) => norm(cross(sub(f[1], f[0]), sub(f[2], f[0])));

// ---------- rendering ----------
// mode: wire (editor), layout (shaded), depth (grey), ids (flat colour per object), pose (skeletons on black)
export function renderScene(g, stage, cam, W, H, mode, opts = {}) {
  const pr = (p) => project(p, cam, W, H), light = norm((stage.light && stage.light.key && stage.light.key.dir) || [-1, -1, -.5]), prims = [];
  g.imageSmoothingEnabled = mode !== 'ids';
  g.fillStyle = mode === 'wire' ? '#14171b' : mode === 'layout' ? '#cfd3d8' : '#000'; g.fillRect(0, 0, W, H);
  if (mode === 'wire' && opts.plate && opts.op > 0) { g.globalAlpha = opts.op; try { g.drawImage(opts.plate, 0, 0, W, H); } catch { /* plate not ready */ } g.globalAlpha = 1; }
  if (mode === 'wire') { g.strokeStyle = '#2a3038'; g.lineWidth = 1; for (let i = -8; i <= 8; i++) for (const s of [[[i, 0, -8], [i, 0, 8]], [[-8, 0, i], [8, 0, i]]]) { const a = pr(s[0]), b = pr(s[1]); if (a && b) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); } } }
  const all = [...solids(stage)];
  let near = 1e9, far = 0; const track = (p) => { const d = dist(p, cam.pos); near = Math.min(near, d); far = Math.max(far, d); };
  all.forEach((s) => s.faces.forEach((f) => f.forEach(track))); (stage.characters || []).forEach((c) => track(c.pos));
  const gray = (d) => { const k = Math.max(0, Math.min(1, 1 - (d - near) / Math.max(0.5, far - near))); const v = Math.round(40 + 215 * k); return `rgb(${v},${v},${v})`; };
  if (mode !== 'pose') for (const s of all) for (const f of s.faces) {
    const q = f.map(pr); if (q.some((x) => !x)) continue; const z = f.reduce((a, p) => a + dist(p, cam.pos), 0) / f.length, n = faceNormal(f), lit = Math.max(0.25, Math.abs(dot(n, light)));
    prims.push({ z, draw: () => { g.beginPath(); q.forEach((x, i) => (i ? g.lineTo(x[0], x[1]) : g.moveTo(x[0], x[1]))); g.closePath();
      if (mode === 'wire') { g.fillStyle = s.color; g.globalAlpha = (opts.sel === s.id ? .75 : .38); g.fill(); g.globalAlpha = 1; g.strokeStyle = opts.sel === s.id ? '#fff' : s.color; g.lineWidth = opts.sel === s.id ? 2.5 : 1.2; g.stroke(); }
      else { g.fillStyle = mode === 'ids' ? s.idColor : mode === 'depth' ? gray(z) : `hsl(${s.color.match(/\d+/)[0]} 45% ${Math.round(28 + 40 * lit)}%)`; g.fill(); if (mode !== 'ids') { g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.stroke(); } } } });
  }
  (stage.characters || []).forEach((c, ci) => {
    const J = joints(c), Q = {}; for (const k in J) Q[k] = pr(J[k]); const col = mode === 'ids' ? IDCOL(100 + ci) : mode === 'pose' ? `hsl(${ci * 90 + 10} 100% 55%)` : mode === 'depth' ? gray(dist(c.pos, cam.pos)) : mode === 'wire' ? ['#d9a441', '#6aa0e0', '#5fb37c', '#d9625a'][ci % 4] : `hsl(${ci * 70 + 200} 30% 40%)`;
    const k = (c.height || 1.7) / 1.7, sel = opts.sel === c.id;
    for (const [a, b] of BONES) { const A = Q[a], B = Q[b]; if (!A || !B) continue; const z = (A[2] + B[2]) / 2, w = mode === 'pose' ? 4 : Math.max(2, (a === 'p' && b === 'n' ? .26 : .1) * k * A[3] / z); prims.push({ z: dist(J[a], cam.pos), draw: () => { g.lineCap = 'round'; g.strokeStyle = col; g.lineWidth = sel && mode === 'wire' ? w + 2 : w; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); } }); }
    if (Q.h) prims.push({ z: dist(J.h, cam.pos), draw: () => { const r = Math.max(3, .12 * k * Q.h[3] / Q.h[2]); g.fillStyle = col; g.beginPath(); g.arc(Q.h[0], Q.h[1], mode === 'pose' ? 6 : r, 0, 7); g.fill(); if (mode === 'wire') { g.fillStyle = '#e8e6e1'; g.font = '12px monospace'; g.textAlign = 'center'; g.fillText(c.id, Q.h[0], Q.h[1] - r - 6); } } });
    if (mode === 'pose') prims.push({ z: 0, draw: () => { g.fillStyle = col; for (const j in Q) if (Q[j]) { g.beginPath(); g.arc(Q[j][0], Q[j][1], 4, 0, 7); g.fill(); } } });
  });
  prims.sort((a, b) => b.z - a.z).forEach((p) => p.draw());
  if (mode === 'wire') {
    for (const s of all) if (opts.sel === s.id) { const c = pr([s.obj.pos[0], s.obj.pos[1] + (s.obj.size || [0, 0, 0])[1] + .25, s.obj.pos[2]]); if (c) { g.fillStyle = '#fff'; g.font = '12px monospace'; g.textAlign = 'center'; g.fillText(s.obj.name || s.id, c[0], c[1]); } }
    for (const [k, c2] of Object.entries(stage.cameras || {})) if (!opts.through || opts.through !== k) { const a = pr(c2.pos), b = pr(c2.target); if (a) { g.strokeStyle = opts.selCam === k ? '#fff' : '#6aa0e0'; g.fillStyle = '#6aa0e0'; g.lineWidth = opts.selCam === k ? 2.5 : 1.5; g.beginPath(); g.arc(a[0], a[1], 8, 0, 7); g.fill(); if (b) { g.setLineDash([5, 4]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]); } g.fillStyle = '#e8e6e1'; g.font = '12px monospace'; g.textAlign = 'center'; g.fillText(`${k} ${c2.lens}mm`, a[0], a[1] - 14); } }
    if (opts.through) { g.strokeStyle = '#e8e6e1'; g.globalAlpha = .25; g.setLineDash([4, 4]); for (const t of [1, 2]) { g.beginPath(); g.moveTo(W * t / 3, 0); g.lineTo(W * t / 3, H); g.moveTo(0, H * t / 3); g.lineTo(W, H * t / 3); g.stroke(); } g.setLineDash([]); g.globalAlpha = 1; }
  }
}

// ---------- state ----------
const aspect = () => (get('canon.style:look') || { data: {} }).data.aspect || '9:16';
const castRefs = () => ofKind('canon.cast');
function starter(sceneRef) {
  const shots = ofKind('shot').filter((s) => s.parent === sceneRef), all = castRefs(), speakers = new Set(ofKind('dialogue').filter((l) => shots.some((x) => l.parent === x.ref)).map((l) => String(l.data.speaker || l.data.role || '').toLowerCase()));
  const spoken = all.filter((c) => [...speakers].some((sp) => sp && (c.data.name || '').toLowerCase().includes(sp.split(' ')[0]))); // the people who actually talk in this scene come first
  const cast = [...spoken, ...all.filter((c) => !spoken.includes(c))].slice(0, 2);
  return { units: 'm', plate: null, set: [], characters: cast.map((c, i) => ({ id: keyOf(c.ref), cast: c.ref, anchor: c.data.anchor || '', pos: i ? [.9, 0, 1.2] : [-.6, 0, 0], facing: i ? 200 : 20, pose: i ? 'walk' : 'stand', height: 1.7, looking_at: '', note: '' })),
    light: { key: { dir: [-1, -1, -.5], tone: 'warm' } }, cameras: { A: { lens: 35, pos: [0, 1.2, 5], target: [0, 1.3, 0], roll: 0, move: { type: 'static', seconds: 0 } } }, shots: Object.fromEntries(shots.map((s) => [s.ref, { camera: 'A' }])) };
}
const viewCam = () => { const v = S.view; if (v.mode === 'shot') return S.stage.cameras[v.cam] || Object.values(S.stage.cameras)[0]; const a = v.az * Math.PI / 180, e = v.el * Math.PI / 180, t = [0, 1, 0]; return { lens: 22, pos: [t[0] + v.dist * Math.cos(e) * Math.sin(a), t[1] + v.dist * Math.sin(e), t[2] + v.dist * Math.cos(e) * Math.cos(a)], target: t }; };
const selObj = () => { const s = S.sel; if (!s) return null; if (s.type === 'cam') return S.stage.cameras[s.id]; return [...S.stage.set, ...S.stage.characters].find((x) => x.id === s.id); };
const dirty = () => { S.dirty = true; $('#stgsave') && ($('#stgsave').disabled = false); };

// ---------- screens ----------
export function vStaging() {
  const scenes = ofKind('scene').filter((s) => s.data.heading), stages = Object.fromEntries(ofKind('stage').map((s) => [s.parent, s]));
  return `<h1>Staging</h1><p class="mute">Place each scene in 3D before anything is generated: where the characters stand, what is in the set, where each camera is. The studio turns it into files that a generator can follow.</p>
  <div class="sgrid">${scenes.map((sc) => { const stg = stages[sc.ref], shots = ofKind('shot').filter((x) => x.parent === sc.ref).length;
    return `<a class="scard" href="#/stage/${esc(keyOf(sc.ref))}"><div class="sb"><div class="row"><b>${esc(sc.data.heading)}</b>${stg ? chip(stg) : tag('no stage yet', 'warn')}</div><div class="mute">${shots} shot${shots === 1 ? '' : 's'}${stg ? ` · ${(stg.data.characters || []).length} characters · ${(stg.data.set || []).length} objects · ${Object.keys(stg.data.cameras || {}).length} cameras` : ''}</div><p class="mute small">${stg ? `Version ${stg.version} by ${esc(stg.author)}${(stg.assets || []).length ? ` · ${(stg.assets || []).length} exported files` : ''}` : 'Open it to start a stage from the cast and the shots.'}</p></div></a>`; }).join('') || '<div class="empty">No scenes yet.</div>'}</div>`;
}

export function vStage(key) {
  const sceneRef = `scene:${key}`, scene = get(sceneRef);
  if (!scene) return '<div class="empty">No such scene. <a href="#/staging">Back to staging</a></div>';
  const ref = `stage:${key}`, existing = get(ref), ed = isHuman();
  if (S && S.ref === ref && !S.dirty && existing) S.stage = JSON.parse(JSON.stringify(existing.data)); // pick up what the AI changed while you were away
  if (!S || S.ref !== ref) { S = { sceneRef, ref, stage: JSON.parse(JSON.stringify(existing ? existing.data : starter(sceneRef))), sel: null, view: { mode: 'editor', az: 30, el: 18, dist: 6.5, cam: 'A' }, dirty: !existing, op: 0, plate: null, shot: null }; S.shot = Object.keys(S.stage.shots)[0] || null; if (S.stage.plate && S.stage.plate.asset) loadPlate(S.stage.plate); }
  const [W, H] = frame(aspect(), 960);
  return `<p><a href="#/staging">← Staging</a> · <a href="#/w/scenes/${esc(key)}/stage">Back to the wizard</a></p><div class="row"><h1>${esc(scene.data.heading)}</h1>${existing ? chip(existing) : tag('not saved yet', 'warn')}${existing ? `<span class="mute">v${existing.version} · ${esc(existing.author)}</span>` : ''}<span class="sp"></span>${ed ? `<button class="btn pri" id="stgsave" data-act="stgsave" ${S.dirty ? '' : 'disabled'}>Save my version</button><button class="btn" data-act="stgexport">Export package</button>` : ''}</div>
  <div class="stg"><aside class="stl" id="stl"></aside><div class="stc"><div class="row"><button class="vd" data-act="stgview" data-v="editor" id="vw-editor" aria-pressed="${S.view.mode === 'editor'}">Editor view</button><button class="vd" data-act="stgview" data-v="shot" id="vw-shot" aria-pressed="${S.view.mode === 'shot'}">Through the shot camera</button><span id="stgcams"></span><label class="chk">Plate <input type="range" id="stgop" min="0" max="100" value="${Math.round(S.op * 100)}" style="width:110px"></label></div>
    <canvas id="stgc" width="${W}" height="${H}" aria-label="3D stage. Drag an object to move it, drag empty space to orbit, scroll to zoom."></canvas><p class="mute small">Drag an object to move it on the floor. Drag empty space to orbit (editor view). Scroll to zoom.</p></div><aside class="str" id="str"></aside></div>
  <h2>Checks</h2><div class="card"><ul class="chks" id="stgchecks"></ul></div><h2>What the generators get</h2><div class="card" id="stgprompt"></div>
  ${existing ? `<h2>Exported files</h2><div class="card">${(existing.assets || []).length ? `<div class="row">${existing.assets.map((a) => `<a class="tag" href="${esc(mediaSrc(a.uri))}" target="_blank" rel="noopener">${esc((a.provenance.role || 'file') + (a.provenance.shot ? ' · ' + a.provenance.shot.slice(5) : ''))}</a>`).join('')}</div>` : '<span class="mute">Nothing exported yet. Save, then Export package.</span>'}</div>` : ''}
  <h2>Feedback</h2>${ed ? `<div class="card"><div class="row"><input id="stgnote" placeholder="What should the AI take from this view?" style="max-width:480px"><button class="vd v-change" data-act="vtoggle" data-v="change" aria-pressed="true">Change</button><button class="vd v-question" data-act="vtoggle" data-v="question" aria-pressed="false">Question</button><button class="btn pri sm" data-act="stgsend">Send this view to the AI</button></div></div>` : ''}${existing ? threadsHtml(ref) : '<p class="mute">Save the stage to start a feedback thread.</p>'}`;
}
export function bindStage() {
  if (!S) return; const cv = $('#stgc'); if (!cv) return; panels(); redraw();
  let drag = null; const rect = () => cv.getBoundingClientRect(), px = (e) => { const r = rect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  const hit = (x, y) => { const cam = viewCam(); let best = null, bd = 46; const test = (id, type, p) => { const q = project(p, cam, cv.width, cv.height); if (q && Math.hypot(q[0] - x, q[1] - y) < bd) { bd = Math.hypot(q[0] - x, q[1] - y); best = { type, id }; } }; (S.stage.set || []).forEach((o) => test(o.id, 'obj', [o.pos[0], o.pos[1] + (o.size || [0, .5])[1] / 2, o.pos[2]])); (S.stage.characters || []).forEach((c) => test(c.id, 'obj', [c.pos[0], c.pos[1] + (c.height || 1.7) / 2, c.pos[2]])); if (S.view.mode === 'editor') for (const [k, c] of Object.entries(S.stage.cameras)) test(k, 'cam', c.pos); return best; };
  cv.onpointerdown = (e) => { if (!isHuman()) return; cv.setPointerCapture(e.pointerId); const [x, y] = px(e), h = hit(x, y); if (h) { S.sel = h; drag = { kind: 'move' }; panels(); } else { S.sel = null; drag = { kind: 'orbit', x: e.clientX, y: e.clientY }; panels(); } redraw(); };
  cv.onpointermove = (e) => {
    if (!drag) return;
    if (drag.kind === 'orbit') { if (S.view.mode !== 'editor') return; S.view.az = (S.view.az - (e.clientX - drag.x) * .5 + 360) % 360; S.view.el = Math.max(-5, Math.min(80, S.view.el + (e.clientY - drag.y) * .3)); drag.x = e.clientX; drag.y = e.clientY; redraw(); return; }
    const o = selObj(); if (!o) return; const [x, y] = px(e), cam = viewCam(), b = basis(cam), q = project([0, 0, 0], cam, cv.width, cv.height) || [0, 0, 1, 900], fpx = q[3] || (cv.height / 2) / ((cv.width < cv.height ? 36 : 24) / 2 / cam.lens), d = norm([b.f[0] + (x - cv.width / 2) / fpx * b.r[0] - (y - cv.height / 2) / fpx * b.u[0], b.f[1] + (x - cv.width / 2) / fpx * b.r[1] - (y - cv.height / 2) / fpx * b.u[1], b.f[2] + (x - cv.width / 2) / fpx * b.r[2] - (y - cv.height / 2) / fpx * b.u[2]]);
    const y0 = S.sel.type === 'cam' ? o.pos[1] : o.pos[1]; if (Math.abs(d[1]) < 1e-3) return; const t = (y0 - b.pos[1]) / d[1]; if (t <= 0) return; const hitp = [b.pos[0] + d[0] * t, y0, b.pos[2] + d[2] * t];
    o.pos[0] = Math.round(hitp[0] * 20) / 20; o.pos[2] = Math.round(hitp[2] * 20) / 20; dirty(); redraw(); fillProps();
  };
  cv.onpointerup = cv.onpointercancel = () => { drag = null; };
  cv.onwheel = (e) => { if (S.view.mode !== 'editor') return; e.preventDefault(); S.view.dist = Math.max(3, Math.min(24, S.view.dist + e.deltaY * .01)); redraw(); };
}
function redraw() { const cv = $('#stgc'); if (!cv || !S) return; const cam = viewCam(); renderScene(cv.getContext('2d'), S.stage, cam, cv.width, cv.height, 'wire', { sel: S.sel && S.sel.type === 'obj' ? S.sel.id : null, selCam: S.sel && S.sel.type === 'cam' ? S.sel.id : null, through: S.view.mode === 'shot' ? S.view.cam : null, plate: S.view.mode === 'shot' ? S.plate : null, op: S.op }); checks(); }
function checks() {
  const r = checkStage(S.stage, { aspect: aspect(), cast: castRefs().map((c) => c.ref) }), ul = $('#stgchecks'); if (ul) ul.innerHTML = r.map((x) => `<li class="${x.lvl}">${esc(x.txt)}</li>`).join('');
  const pb = $('#stgprompt'); if (pb) pb.innerHTML = Object.keys(S.stage.shots || {}).map((s) => `<div class="kv"><b>${esc(s.slice(5))}</b> <span class="mute">camera ${esc(S.stage.shots[s].camera)}</span><br>${esc(composePrompt(S.stage, s, (get('canon.style:look') || { data: {} }).data) || 'No camera for this shot.')}</div>`).join('') || '<span class="mute">No shots in this scene yet.</span>';
}

// ---------- side panels ----------
const num = (v) => Math.round(v * 100) / 100;
function panels() {
  const L = $('#stl'), R = $('#str'); if (!L || !R) return; const ed = isHuman(), s = S.stage, sel = S.sel;
  const item = (id, type, label, sub2) => `<button class="stitem${sel && sel.id === id && sel.type === type ? ' on' : ''}" data-act="stgsel" data-type="${type}" data-id="${esc(id)}">${esc(label)}<span class="mute small"> ${esc(sub2 || '')}</span></button>`;
  L.innerHTML = `<h2>Plate</h2><p class="mute small">${s.plate && s.plate.asset ? `${esc(s.plate.kind)}: ${esc(s.plate.note || 'location reference')}` : 'A photo or video of the place. Lay it under the camera view to match positions.'}</p>${ed ? '<input type="file" id="stgplate" accept="image/*,video/*" style="max-width:100%">' : ''}
  <h2>Characters</h2>${s.characters.map((c) => item(c.id, 'obj', c.id, c.pose)).join('') || '<span class="mute small">none</span>'}${ed ? `<div class="row"><select id="stgaddcast">${castRefs().filter((c) => !s.characters.some((x) => x.cast === c.ref)).map((c) => `<option value="${esc(c.ref)}">${esc(c.data.name)}</option>`).join('')}</select><button class="btn sm" data-act="stgaddchar">Add</button></div>` : ''}
  <h2>Objects</h2>${s.set.map((o) => item(o.id, 'obj', o.name || o.id, `${o.type}${o.must_keep ? ' · must keep' : ''}`)).join('') || '<span class="mute small">none</span>'}${ed ? '<div class="row"><button class="btn sm" data-act="stgaddobj" data-t="prop">+ Prop</button><button class="btn sm" data-act="stgaddobj" data-t="set">+ Set piece</button><button class="btn sm" data-act="stgaddobj" data-t="light">+ Light</button></div>' : ''}
  <h2>Cameras</h2>${Object.entries(s.cameras).map(([k, c]) => item(k, 'cam', `Camera ${k}`, `${c.lens} mm`)).join('')}${ed ? '<button class="btn sm" data-act="stgaddcam">+ Camera</button>' : ''}
  <h2>Shots</h2>${Object.keys(s.shots).map((sh) => `<div class="row"><span class="small">${esc(sh.slice(5))}</span><select data-shotcam="${esc(sh)}" ${ed ? '' : 'disabled'}>${Object.keys(s.cameras).map((k) => `<option ${s.shots[sh].camera === k ? 'selected' : ''}>${k}</option>`).join('')}</select><button class="btn sm" data-act="stgpick" data-shot="${esc(sh)}">View</button></div>`).join('') || '<span class="mute small">No shots in this scene yet.</span>'}`;
  const cs = $('#stgcams'); if (cs) cs.innerHTML = S.view.mode === 'shot' ? Object.keys(s.cameras).map((k) => `<button class="vd" data-act="stgcam" data-v="${k}" aria-pressed="${S.view.cam === k}">${k}</button>`).join('') : '';
  R.innerHTML = '<div id="stprops"></div>'; fillProps();
}
const F = (path, label, v, o = {}) => `<label class="k">${label}</label><input data-sp="${path}" value="${esc(v ?? '')}" ${o.type ? `type="${o.type}" step="${o.step || 'any'}"` : ''}>`;
const N3 = (path, label, a) => `<label class="k">${label}</label><div class="row3">${[0, 1, 2].map((i) => `<input type="number" step="0.05" data-sp="${path}.${i}" value="${num(a[i])}" aria-label="${label} ${'xyz'[i]}">`).join('')}</div>`;
function fillProps() {
  const box = $('#stprops'); if (!box || !S) return; const o = selObj(), ed = isHuman(); if (!o) { box.innerHTML = '<h2>Properties</h2><p class="mute">Select a character, an object or a camera.</p>'; return; }
  const dis = ed ? '' : 'disabled';
  if (S.sel.type === 'cam') { const m = o.move || { type: 'static', seconds: 0 }, e = moveEnd(o); box.innerHTML = `<h2>Camera ${esc(S.sel.id)}</h2><label class="k">Lens (mm)</label><div class="row">${[24, 35, 50, 85].map((l) => `<button class="vd" data-act="stglens" data-v="${l}" aria-pressed="${o.lens === l}">${l}</button>`).join('')}</div>${N3('pos', 'Position (m)', o.pos)}${N3('target', 'Looking at', o.target)}<label class="k">Move</label><select data-sp="move.type" ${dis}>${MOVES.map((t) => `<option ${m.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>${F('move.seconds', 'Move length (s)', m.seconds || 0, { type: 'number', step: 0.5 })}<p class="mute small">Ends at ${e.pos.map(num).join(', ')}</p>${ed && Object.keys(S.stage.cameras).length > 1 ? '<button class="btn sm no" data-act="stgdel">Delete camera</button>' : ''}`; return; }
  const isChar = S.stage.characters.includes(o), cast = isChar ? get(o.cast) : null, imgs = cast ? (cast.assets || []).filter((a) => (a.mime || '').startsWith('image/')).map((a) => a.uri.split('/').pop().replace(/^img-/, '').replace(/\.jpg$/, '')) : [];
  box.innerHTML = `<h2>${esc(o.name || o.id)}</h2>${isChar ? '' : F('name', 'Name', o.name) + F('find_as', 'Find it in pictures as (a noun phrase, e.g. wooden beam)', o.find_as) + `<label class="k">Type</label><select data-sp="type" ${dis}>${TYPES.map((t) => `<option ${o.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select><label class="k">Shape</label><select data-sp="shape" ${dis}>${SHAPES.map((t) => `<option ${o.shape === t ? 'selected' : ''}>${t}</option>`).join('')}</select>${N3('size', 'Size w / h / d (m)', o.size || [.5, .5, .5])}`}${N3('pos', 'Position (m)', o.pos)}
  ${isChar ? `${F('facing', 'Facing (degrees, 0 looks toward +z)', o.facing, { type: 'number', step: 5 })}${F('height', 'Height (m)', o.height || 1.7, { type: 'number', step: 0.05 })}<label class="k">Pose</label><select data-sp="pose" ${dis}>${Object.keys(POSES).map((t) => `<option ${o.pose === t ? 'selected' : ''}>${t}</option>`).join('')}</select><label class="k">Anchor image</label><select data-sp="anchor" ${dis}><option value="">none</option>${imgs.map((i) => `<option ${o.anchor === i ? 'selected' : ''}>${esc(i)}</option>`).join('')}</select><label class="k">Looking at</label><select data-sp="looking_at" ${dis}><option value="">nothing in particular</option>${[...S.stage.set, ...S.stage.characters].filter((x) => x.id !== o.id).map((x) => `<option value="${esc(x.id)}" ${o.looking_at === x.id ? 'selected' : ''}>${esc(x.name || x.id)}</option>`).join('')}</select>`
  : `${F('rot', 'Rotation y (degrees)', Array.isArray(o.rot) ? o.rot[1] : o.rot || 0, { type: 'number', step: 5 })}<label class="chk"><input type="checkbox" data-sp="must_keep" ${o.must_keep ? 'checked' : ''} ${dis}> Must stay in every shot of the scene</label>`}
  <label class="k">Note for the AI</label><textarea data-sp="note" ${dis}>${esc(o.note || '')}</textarea>${ed ? '<button class="btn sm no" data-act="stgdel">Delete</button>' : ''}`;
}
function setPath(o, path, v) { const k = path.split('.'); let t = o; for (let i = 0; i < k.length - 1; i++) { t = t[k[i]] ??= {}; } t[k[k.length - 1]] = v; }
document.addEventListener('input', (e) => {
  if (!S) return; const sp = e.target.dataset && e.target.dataset.sp, o = selObj();
  if (e.target.id === 'stgop') { S.op = Number(e.target.value) / 100; redraw(); return; }
  if (sp && o) { let v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value; if (sp === 'rot') v = [0, Number(v), 0]; setPath(o, sp, v); dirty(); redraw(); }
});
document.addEventListener('change', async (e) => {
  if (!S) return; const sc = e.target.dataset && e.target.dataset.shotcam; if (sc) { S.stage.shots[sc].camera = e.target.value; dirty(); redraw(); }
  if (e.target.id === 'stgplate' && e.target.files[0]) { const f = e.target.files[0], name = `plate-${keyOf(S.ref)}-${Date.now().toString(36)}.${f.type.startsWith('video') ? 'mp4' : 'jpg'}`; try { await put(name, f, f.type); S.stage.plate = { kind: f.type.startsWith('video') ? 'video' : 'photo', asset: `media/${st.pid}/${name}`, note: f.name }; loadPlate(S.stage.plate); dirty(); panels(); toast('Plate added. Slide Plate up in the shot-camera view to match it.'); } catch (x) { toast(x.message); } }
});

// ---------- plate, upload, export ----------
function loadPlate(p) { const src = mediaSrc(p.asset); if (p.kind === 'video') { const v = document.createElement('video'); v.muted = true; v.crossOrigin = 'use-credentials'; v.src = src; v.onloadeddata = () => { S.plate = v; v.currentTime = 0.05; }; v.onseeked = () => redraw(); } else { const im = new Image(); im.crossOrigin = 'use-credentials'; im.onload = () => { S.plate = im; redraw(); }; im.src = src; } }
async function put(name, blob, mime) { const r = await fetch(`/api/p/${st.pid}/media/${name}`, { method: 'PUT', headers: { authorization: 'Bearer ' + st.key, 'content-type': mime || 'application/octet-stream' }, body: blob }); if (!r.ok) throw new Error('could not store the file'); return `media/${st.pid}/${name}`; }
const toBlob = (cv) => new Promise((r) => cv.toBlob(r, 'image/png'));
async function save() {
  const data = S.stage; const ex = get(S.ref);
  if (ex) await editArtifact(S.ref, () => data, 'Edited the stage'); else await createArtifact(S.ref, data, { parent: S.sceneRef, why: 'Staged the scene' });
  S.dirty = false;
}
async function exportPackage() {
  if (S.dirty) await save();
  const ref = S.ref, ver = (get(ref) || {}).version, [W, H] = frame(aspect(), 960), shots = Object.keys(S.stage.shots), cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'), key = keyOf(ref);
  const attach = async (uri, mime, role, extra) => api(P('/assets'), { method: 'POST', body: { ref, uri, mime, provenance: { role, stage_version: ver, uploaded_by: st.me.name, ...extra } } });
  const legend = Object.fromEntries([...solids(S.stage).map((s) => [s.id, s.idColor]), ...S.stage.characters.map((c, i) => [c.id, IDCOL(100 + i)])]);
  let n = 0;
  for (const sh of shots) {
    const cam = S.stage.cameras[S.stage.shots[sh].camera], sk = sh.slice(5); if (!cam) continue;
    for (const mode of ['layout', 'depth', 'ids', 'pose']) { renderScene(g, S.stage, cam, W, H, mode, {}); const name = `stage-${key}-${sk}-${mode}.png`; await attach(await put(name, await toBlob(cv), 'image/png'), 'image/png', mode, { shot: sh, camera: S.stage.shots[sh].camera, ...(mode === 'ids' ? { legend } : {}) }); n++; }
    const cj = { shot: sh, camera: S.stage.shots[sh].camera, lens: cam.lens, sensor_height_mm: W < H ? 36 : 24, aspect: parseAspect(aspect()).join(':'), frame: [W, H], pos: cam.pos, target: cam.target, roll: cam.roll || 0, move: cam.move || { type: 'static' }, path: cameraPath(cam) };
    await attach(await put(`stage-${key}-${sk}-camera.json`, JSON.stringify(cj, null, 1), 'application/json'), 'application/json', 'camera', { shot: sh }); n++;
    await attach(await put(`stage-${key}-${sk}-prompt.txt`, composePrompt(S.stage, sh, (get('canon.style:look') || { data: {} }).data), 'text/plain'), 'text/plain', 'prompt', { shot: sh }); n++;
  }
  await attach(await put(`stage-${key}-staging.json`, JSON.stringify(S.stage, null, 1), 'application/json'), 'application/json', 'scene', {}); n++;
  toast(`Exported ${n} files. The AI gets them with the stage.`);
}
async function sendView() {
  const cv = $('#stgc'), note = ($('#stgnote') || {}).value || '', vd = document.querySelector('.vd[data-act=vtoggle][aria-pressed=true]');
  if (S.dirty) await save();
  const name = `stage-view-${Date.now().toString(36)}.png`, uri = await put(name, await toBlob(cv), 'image/png'), o = S.sel && selObj(), cam = viewCam();
  const facts = `\n[Stage view: ${S.view.mode === 'shot' ? `through camera ${S.view.cam}` : 'editor view'}, ${cam.lens} mm${S.sel ? `; selected ${S.sel.id}` : ''}]`;
  await api(P('/comments'), { method: 'POST', body: { ref: S.ref, body: (note + facts).trim(), verdict: vd ? vd.dataset.v : 'change', anchor: S.sel ? `${S.sel.type === 'cam' ? 'cam' : 'obj'}:${S.sel.id}` : S.view.mode === 'shot' ? `cam:${S.view.cam}` : undefined, attachment: uri } });
  toast('Sent. The AI will see the picture and your note.');
}

let uid = 1; const nextId = (base) => { let id; do { id = `${base}${uid++}`; } while ([...S.stage.set, ...S.stage.characters].some((x) => x.id === id)); return id; };
export const acts = {
  stgsel: (el) => { S.sel = { type: el.dataset.type, id: el.dataset.id }; panels(); redraw(); },
  stgview: (el) => { S.view.mode = el.dataset.v; if (S.view.mode === 'shot' && !S.stage.cameras[S.view.cam]) S.view.cam = Object.keys(S.stage.cameras)[0]; $$s('#vw-editor').setAttribute('aria-pressed', String(S.view.mode === 'editor')); $$s('#vw-shot').setAttribute('aria-pressed', String(S.view.mode === 'shot')); panels(); redraw(); },
  stgcam: (el) => { S.view.cam = el.dataset.v; panels(); redraw(); },
  stgpick: (el) => { S.shot = el.dataset.shot; S.view.mode = 'shot'; S.view.cam = S.stage.shots[S.shot].camera; $$s('#vw-editor').setAttribute('aria-pressed', 'false'); $$s('#vw-shot').setAttribute('aria-pressed', 'true'); panels(); redraw(); },
  stglens: (el) => { const o = selObj(); o.lens = Number(el.dataset.v); dirty(); fillProps(); redraw(); },
  stgaddchar: () => { const sel = $('#stgaddcast'); if (!sel || !sel.value) return toast('Every cast member is already on the stage'); const c = get(sel.value); S.stage.characters.push({ id: keyOf(c.ref), cast: c.ref, anchor: c.data.anchor || '', pos: [0, 0, -1], facing: 0, pose: 'stand', height: 1.7, looking_at: '', note: '' }); S.sel = { type: 'obj', id: keyOf(c.ref) }; dirty(); panels(); redraw(); },
  stgaddobj: (el) => { const t = el.dataset.t, id = nextId(t); S.stage.set.push({ id, type: t, name: t === 'light' ? 'Light' : t === 'set' ? 'Set piece' : 'Prop', shape: 'box', size: t === 'set' ? [4, 3, .3] : [.5, .5, .5], pos: [0, 0, 0], rot: [0, 0, 0], must_keep: false, note: '' }); S.sel = { type: 'obj', id }; dirty(); panels(); redraw(); },
  stgaddcam: () => { const k = String.fromCharCode(65 + Object.keys(S.stage.cameras).length); S.stage.cameras[k] = { lens: 35, pos: [2, 1.4, 5], target: [0, 1.3, 0], roll: 0, move: { type: 'static', seconds: 0 } }; S.sel = { type: 'cam', id: k }; dirty(); panels(); redraw(); },
  stgdel: () => { const s = S.sel; if (!s) return; if (s.type === 'cam') { delete S.stage.cameras[s.id]; for (const sh of Object.values(S.stage.shots)) if (sh.camera === s.id) sh.camera = Object.keys(S.stage.cameras)[0]; } else { S.stage.set = S.stage.set.filter((x) => x.id !== s.id); S.stage.characters = S.stage.characters.filter((x) => x.id !== s.id); } S.sel = null; dirty(); panels(); redraw(); },
  stgsave: async () => { await save(); toast('Saved as your version. Shots built on this layout are now stale.'); return 'refresh'; },
  stgexport: async () => { await exportPackage(); return 'refresh'; },
  stgsend: async () => { await sendView(); return 'refresh'; },
};
const $$s = (s) => document.querySelector(s);
export const stageDirty = () => !!(S && S.dirty);
export const stageLeave = () => { if (S && !location.hash.startsWith('#/stage/')) { S = null; } };
