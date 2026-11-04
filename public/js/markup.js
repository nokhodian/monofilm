// "Show the AI what you mean": draw on an image, sketch a storyboard frame, or pose a 3D mannequin stage.
// The result is a PNG stored in the studio and sent as feedback, with the camera numbers in the note so the AI can read them too.
import { $, esc, st, api, P, toast } from './core.js';
import { ofKind } from './data.js';

const POSE0 = { p: [0, .95, 0], n: [0, 1.45, 0], h: [0, 1.66, 0], sl: [-.2, 1.42, 0], sr: [.2, 1.42, 0], el: [-.26, 1.15, 0], er: [.26, 1.15, 0], hl: [-.28, .9, 0], hr: [.28, .9, 0], kl: [-.1, .5, 0], kr: [.1, .5, 0], fl: [-.1, 0, 0], fr: [.1, 0, 0] };
const mk = (o) => ({ ...POSE0, ...o });
const POSES = {
  stand: mk({}),
  walk: mk({ kl: [-.1, .52, .2], fl: [-.1, .05, .42], kr: [.1, .5, -.1], fr: [.1, 0, -.3], el: [-.26, 1.15, .2], er: [.26, 1.15, -.2], hl: [-.28, .95, .32], hr: [.28, .95, -.28] }),
  point: mk({ er: [.3, 1.45, .25], hr: [.36, 1.45, .72] }),
  kneel: mk({ p: [0, .55, 0], n: [0, 1.05, .05], h: [0, 1.27, .08], sl: [-.2, 1.02, .05], sr: [.2, 1.02, .05], el: [-.25, .8, .1], er: [.25, .8, .1], hl: [-.2, .62, .3], hr: [.2, .62, .3], kl: [-.1, .5, .38], fl: [-.1, 0, .38], kr: [.1, .05, -.05], fr: [.1, .05, -.45] }),
  recoil: mk({ p: [0, .95, -.1], n: [0, 1.45, -.18], h: [0, 1.62, -.34], el: [-.3, 1.3, .1], er: [.3, 1.3, .1], hl: [-.24, 1.5, .3], hr: [.24, 1.5, .3] }),
};
const BONES = [['p', 'n'], ['n', 'sl'], ['n', 'sr'], ['sl', 'el'], ['el', 'hl'], ['sr', 'er'], ['er', 'hr'], ['p', 'kl'], ['kl', 'fl'], ['p', 'kr'], ['kr', 'fr'], ['sl', 'sr']];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.sqrt(dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const COLORS = { ink: '#e8e6e1', red: '#d9625a', blue: '#6aa0e0', paper: '#14171b' };
const SIZES = ['EWS', 'WS', 'MS', 'MCU', 'CU', 'ECU', 'INS'];

let m = null; // the open tool's state

function figures() { const names = ofKind('canon.cast').map((c) => c.data.name).filter(Boolean); return [{ n: names[0] || 'Figure 1', pose: 'stand', x: -.6, z: 0, rot: 20 }, { n: names[1] || 'Figure 2', pose: 'walk', x: .7, z: .5, rot: 200 }]; }
export function open(o) {
  m = { mode: o.mode || 'sketch', ref: o.ref, ctx: o.context || '', base: null, strokes: [], tool: 'pen', ink: 'red', w: 3, size: 'MS', pv: { az: 35, el: 12, dist: 5, focal: 35, fig: 0, figs: figures() }, baseSrc: o.base || '' };
  const go = () => { build(); redraw(); };
  if (m.baseSrc) { const im = new Image(); im.onload = () => { m.base = im; go(); }; im.onerror = () => { toast('Could not load that image'); }; im.src = m.baseSrc; } else go();
}
const dims = () => (m.base ? (() => { const s = Math.min(1, 900 / m.base.naturalWidth); return [Math.round(m.base.naturalWidth * s), Math.round(m.base.naturalHeight * s)]; })() : [540, 960]);

function build() {
  const [W, H] = dims(), pv = m.pv, f = pv.figs[pv.fig], chips = (arr, cur, k) => arr.map((v) => `<button class="vd" data-act="mkset" data-k="${k}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${v}</button>`).join('');
  const el = $('#mkmodal') || Object.assign(document.createElement('div'), { id: 'mkmodal', className: 'mkm' }); document.body.appendChild(el);
  el.innerHTML = `<div class="mkw"><div class="mkc"><canvas id="mkc" width="${W}" height="${H}" aria-label="Drawing area"></canvas></div><div class="mkp">
    <div class="row"><b>${m.mode === 'stage' ? 'Frame it in 3D' : m.base ? 'Draw on the image' : 'Sketch a frame'}</b><span class="sp"></span><button class="btn sm" data-act="mkclose">Cancel</button></div>
    <p class="mute small">Your drawing and note become a comment on <b>${esc(m.ref)}</b>. The AI sees it the next time it works, and you will see it on this page straight away.</p>
    <div class="row"><button class="vd" data-act="mkmode" data-v="sketch" aria-pressed="${m.mode === 'sketch'}">Sketch</button><button class="vd" data-act="mkmode" data-v="stage" aria-pressed="${m.mode === 'stage'}">3D stage</button></div>
    ${m.mode === 'stage' ? `<label class="k">Lens</label><div class="row">${chips([24, 35, 50, 85], pv.focal, 'focal')}</div><label class="k">Distance <span id="o-dist">${pv.dist.toFixed(1)} m</span></label><input type="range" data-s="dist" min="2" max="10" step=".1" value="${pv.dist}">
      <label class="k">Orbit <span id="o-az">${Math.round(pv.az)}°</span></label><input type="range" data-s="az" min="0" max="359" value="${Math.round(pv.az)}"><label class="k">Height <span id="o-el">${Math.round(pv.el)}°</span></label><input type="range" data-s="el" min="-10" max="55" value="${Math.round(pv.el)}">
      <label class="k">Figure</label><div class="row">${pv.figs.map((g, i) => `<button class="vd" data-act="mkfig" data-v="${i}" aria-pressed="${pv.fig === i}">${esc(g.n)}</button>`).join('')}</div>
      <div class="row">${Object.keys(POSES).map((k) => `<button class="vd" data-act="mkpose" data-v="${k}" aria-pressed="${f.pose === k}">${k}</button>`).join('')}</div>
      <label class="k">Left / right</label><input type="range" data-s="fx" min="-2" max="2" step=".1" value="${f.x}"><label class="k">Near / far</label><input type="range" data-s="fz" min="-2" max="2" step=".1" value="${f.z}"><label class="k">Facing</label><input type="range" data-s="fr" min="0" max="359" value="${f.rot}">`
    : `<div class="row"><button class="vd" data-act="mkset" data-k="tool" data-v="pen" aria-pressed="${m.tool === 'pen'}">Pen</button><button class="vd" data-act="mkset" data-k="tool" data-v="eraser" aria-pressed="${m.tool === 'eraser'}">Eraser</button>${['ink', 'red', 'blue'].map((c) => `<button class="vd" data-act="mkset" data-k="ink" data-v="${c}" aria-pressed="${m.ink === c}">${c}</button>`).join('')}</div>
      <div class="row">${chips([2, 3, 6], m.w, 'w')}<button class="btn sm" data-act="mkundo">Undo</button><button class="btn sm" data-act="mkclear">Clear</button></div>
      ${m.base ? '' : `<label class="k">Shot size</label><div class="row">${chips(SIZES, m.size, 'size')}</div>`}`}
    <label class="k">What should the AI take from this?</label><textarea id="mknote" placeholder="Say what you mean"></textarea>
    <div class="row">${[['change', 'Change'], ['question', 'Question'], ['keep', 'Keep']].map(([k, l]) => `<button class="vd v-${k}" data-act="vtoggle" data-v="${k}" aria-pressed="${k === 'change'}">${l}</button>`).join('')}</div>
    <button class="btn pri" data-act="mksend">Send to the AI as feedback</button></div></div>`;
  bind();
}

// ---- drawing ----
function redraw() { const cv = $('#mkc'); if (!cv) return; const g = cv.getContext('2d'), [W, H] = [cv.width, cv.height]; m.mode === 'stage' ? stage(g, W, H) : sketch(g, W, H); }
function sketch(g, W, H) {
  // a blank frame is a light page you can see; with a picture it is the picture. Strokes live on their own layer so the eraser never rubs out the picture.
  g.fillStyle = m.base ? COLORS.paper : '#efece4'; g.fillRect(0, 0, W, H); if (m.base) g.drawImage(m.base, 0, 0, W, H);
  if (!m.base && !m.strokes.length) { g.fillStyle = 'rgba(20,23,27,.28)'; g.font = '600 22px system-ui'; g.textAlign = 'center'; g.fillText('Draw here', W / 2, H / 2 - 8); g.font = '14px system-ui'; g.fillText(`${m.size} frame: sketch who stands where`, W / 2, H / 2 + 18); g.strokeStyle = 'rgba(20,23,27,.18)'; g.setLineDash([6, 6]); g.strokeRect(10, 10, W - 20, H - 20); g.setLineDash([]); }
  const L = document.createElement('canvas'); L.width = W; L.height = H; const lg = L.getContext('2d'); lg.lineCap = 'round'; lg.lineJoin = 'round';
  for (const s of m.strokes) { lg.strokeStyle = s.c === 'paper' ? '#000' : s.c === 'ink' && !m.base ? '#1a1d22' : COLORS[s.c]; lg.globalCompositeOperation = s.c === 'paper' ? 'destination-out' : 'source-over'; lg.lineWidth = s.w * (W / 270); lg.beginPath(); s.pts.forEach((p, i) => (i ? lg.lineTo(p[0] * W, p[1] * H) : lg.moveTo(p[0] * W, p[1] * H))); if (s.pts.length === 1) lg.lineTo(s.pts[0][0] * W + .1, s.pts[0][1] * H); lg.stroke(); }
  g.drawImage(L, 0, 0);
}
function stage(g, W, H) {
  const pv = m.pv, az = pv.az * Math.PI / 180, el = pv.el * Math.PI / 180, T = [0, 1, 0], pos = [T[0] + pv.dist * Math.cos(el) * Math.sin(az), T[1] + pv.dist * Math.sin(el), T[2] + pv.dist * Math.cos(el) * Math.cos(az)];
  const f = norm(sub(T, pos)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), fpx = (H / 2) / (18 / pv.focal);
  const pr = (v) => { const q = sub(v, pos), z = dot(q, f); return z < .15 ? null : [W / 2 + fpx * dot(q, r) / z, H / 2 - fpx * dot(q, u) / z, z]; };
  g.fillStyle = COLORS.paper; g.fillRect(0, 0, W, H); g.strokeStyle = '#2a3038'; g.lineWidth = 1;
  for (let i = -5; i <= 5; i++) for (const s of [[[i, 0, -5], [i, 0, 5]], [[-5, 0, i], [5, 0, i]]]) { const a = pr(s[0]), b = pr(s[1]); if (a && b) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); } }
  const cols = ['#d9a441', '#6aa0e0', '#5fb37c', '#d9625a'];
  pv.figs.forEach((fg, fi) => {
    const t = fg.rot * Math.PI / 180, P0 = POSES[fg.pose], J = {};
    for (const k in P0) { const l = P0[k]; J[k] = pr([fg.x + l[0] * Math.cos(t) + l[2] * Math.sin(t), l[1], fg.z - l[0] * Math.sin(t) + l[2] * Math.cos(t)]); }
    g.lineCap = 'round'; g.strokeStyle = cols[fi % 4]; g.fillStyle = cols[fi % 4];
    for (const b of BONES) { const a = J[b[0]], c = J[b[1]]; if (!a || !c) continue; g.lineWidth = Math.max(2, .075 * fpx / ((a[2] + c[2]) / 2)); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
    if (J.h) { g.beginPath(); g.arc(J.h[0], J.h[1], Math.max(3, .115 * fpx / J.h[2]), 0, 7); g.fill(); g.fillStyle = '#e8e6e1'; g.font = '12px monospace'; g.textAlign = 'center'; g.fillText(fg.n, J.h[0], J.h[1] - Math.max(8, .18 * fpx / J.h[2])); }
  });
  g.strokeStyle = '#e8e6e1'; g.globalAlpha = .25; g.setLineDash([4, 4]); for (const k of [1, 2]) { g.beginPath(); g.moveTo(W * k / 3, 0); g.lineTo(W * k / 3, H); g.moveTo(0, H * k / 3); g.lineTo(W, H * k / 3); g.stroke(); } g.setLineDash([]); g.globalAlpha = 1;
  g.fillStyle = '#e8e6e1'; g.font = '500 12px monospace'; g.textAlign = 'left'; g.fillText(`${pv.focal}mm · ${pv.dist.toFixed(1)} m · cam ${pos[1].toFixed(1)} m`, 10, H - 12);
}
function bind() {
  const cv = $('#mkc'); if (!cv) return; let cur = null, drag = null;
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
  cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); if (m.mode === 'stage') { drag = { x: e.clientX, y: e.clientY }; return; } cur = { c: m.tool === 'eraser' ? 'paper' : m.ink, w: m.tool === 'eraser' ? m.w * 4 : m.w, pts: [pt(e)] }; m.strokes.push(cur); redraw(); };
  cv.onpointermove = (e) => { if (m.mode === 'stage' && drag) { m.pv.az = (m.pv.az - (e.clientX - drag.x) * .5 + 360) % 360; m.pv.el = Math.max(-10, Math.min(55, m.pv.el + (e.clientY - drag.y) * .3)); drag = { x: e.clientX, y: e.clientY }; redraw(); return; } if (cur) { cur.pts.push(pt(e)); redraw(); } };
  cv.onpointerup = cv.onpointercancel = () => { cur = null; drag = null; };
  cv.onwheel = (e) => { if (m.mode !== 'stage') return; e.preventDefault(); m.pv.dist = Math.max(2, Math.min(10, m.pv.dist + e.deltaY * .004)); redraw(); };
}
document.addEventListener('input', (e) => {
  const k = e.target.dataset && e.target.dataset.s; if (!k || !m) return; const v = Number(e.target.value), pv = m.pv, f = pv.figs[pv.fig];
  if (k === 'dist') pv.dist = v; else if (k === 'az') pv.az = v; else if (k === 'el') pv.el = v; else if (k === 'fx') f.x = v; else if (k === 'fz') f.z = v; else if (k === 'fr') f.rot = v;
  const o = $(`#o-${k}`); if (o) o.textContent = k === 'dist' ? `${v.toFixed(1)} m` : `${Math.round(v)}°`; redraw();
});

async function send() {
  const cv = $('#mkc'), note = $('#mknote').value.trim(), vd = $('#mkmodal .vd[data-act=vtoggle][aria-pressed=true]');
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png')), name = `markup-${Date.now().toString(36)}.png`;
  const pv = m.pv, facts = m.mode === 'stage' ? `\n[3D frame: ${pv.focal}mm lens, ${pv.dist.toFixed(1)} m away, orbit ${Math.round(pv.az)}°, height ${Math.round(pv.el)}°; ${pv.figs.map((f) => `${f.n} ${f.pose} facing ${Math.round(f.rot)}°`).join('; ')}]` : !m.base ? `\n[Storyboard frame, shot size ${m.size}]` : '';
  const r = await fetch(`/api/p/${st.pid}/media/${name}`, { method: 'PUT', headers: { authorization: 'Bearer ' + st.key, 'content-type': 'image/png' }, body: blob });
  if (!r.ok) throw new Error('could not store the drawing');
  const made = await api(P('/comments'), { method: 'POST', body: { ref: m.ref, body: (note + facts).trim(), verdict: vd ? vd.dataset.v : undefined, context: m.ctx || undefined, anchor: m.mode === 'stage' ? 'framing' : 'drawing', attachment: `media/${st.pid}/${name}` } });
  st.flash = made.id; close(); toast('Sent to the AI. It is on this page now, highlighted.');
  document.dispatchEvent(new Event('mf-refresh')); // show the new comment without a manual reload
}
const close = () => { const e = $('#mkmodal'); if (e) e.remove(); m = null; };

export const acts = {
  markup: (el) => open({ ref: el.dataset.ref, context: el.dataset.ctx, mode: el.dataset.mode || 'sketch', base: el.dataset.base || '' }),
  mkclose: close,
  mkmode: (el) => { m.mode = el.dataset.v; build(); redraw(); },
  mkset: (el) => { const k = el.dataset.k; m[k] = ['w'].includes(k) ? Number(el.dataset.v) : el.dataset.v; build(); redraw(); },
  mkundo: () => { m.strokes.pop(); redraw(); },
  mkclear: () => { m.strokes = []; redraw(); },
  mkfig: (el) => { m.pv.fig = Number(el.dataset.v); build(); redraw(); },
  mkpose: (el) => { m.pv.figs[m.pv.fig].pose = el.dataset.v; build(); redraw(); },
  mksend: send,
};
document.addEventListener('mf-markup', (e) => open(e.detail));
