// Step 6, Scenes: the Stage page and the Pictures page of one scene.
//   Stage: the 3D layout (stage:<scene>) of people and camera, shown for the Start and the End of the scene. The full editor is the studio's own page #/stage/<scene>.
//   Pictures: three candidates for each start and end picture of the scene, made from that layout. "Use this" sets keyframe:<scene>-c<n>-<start|end> data.chosen (that is the review).
// The picture SOURCE and the clip join are decided on the Brief page only; here they are read-only with a link.
import { $, $$, esc, st, api, P, toast, mediaSrc, isHuman } from './core.js';
import { get, createArtifact } from './data.js';
import { R, keyOf, SUBS, ANCHOR_MODES, sceneReadiness } from './wizard-model.js';
import { W, spine, itemEl, chipOf, pill, lk, nothing, ownEdit, approveRefs, rerender, refresh, hrefOf, castArts } from './w-core.js';
import { registerFix } from './w-fix.js';
import { registerSub } from './w-scenes.js';
import { renderScene } from './stage.js';
import { project, checkStage, frame, parseAspect, moveEnd, MOVES } from './stage-math.js';
import { starterStage, camFor, nudgeStage, slotsOf, clipsOf, plainError, driftLines, STEP, planItems, planBounds, planHit, moveTo, setCamera, LENSES } from './w-stage-pure.js';

const SS = { mom: 'start', view: 'plan', sel: null, drag: null, work: null, geo: null, busy: {}, err: {}, adh: {} }; // which moment the Stage page shows; picture-making progress and errors per slot; adherence results per picture
const sceneOf = (ctx) => get(R.scene(ctx.scene));
const aspect = () => ((get('canon.style:look') || {}).data || {}).aspect || '9:16';
const nameOf = (c) => ((get(c.cast) || {}).data || {}).name || c.name || c.id.charAt(0).toUpperCase() + c.id.slice(1);
const modeName = (m) => (ANCHOR_MODES.find((x) => x[0] === m) || ['', m])[1];

// ---------- the head shared by both pages: scene name and the five page tabs ----------
function head(ctx) {
  const sc = sceneOf(ctx), d = sc.data, r = sceneReadiness(sc, { get, assets: (ref) => (get(ref) || {}).assets || [] }), place = d.place && get(d.place);
  return `<div class="shead"><span class="snum">${d.n}</span><div><h2 style="margin:0">${esc(d.name)}</h2><div class="sm mute">${[d.tag, d.seconds && `${d.seconds} s`, place && place.data.name].filter(Boolean).map(esc).join(' · ')}</div></div></div>
  <div class="ptabs" role="tablist">${SUBS.map((u, i) => `<button class="k-${u[0]} ${u[0] === ctx.sub ? 'on' : ''}" data-go="${hrefOf('scenes', ctx.scene, u[0])}"><small>${i + 1}</small>${u[1]}${r[i] === 2 ? ' <span class="tick">✓</span>' : ''}</button>`).join('')}</div>`;
}
// Where a picture comes from is decided on the Brief page; this only shows it.
const sourceLine = (ctx, mode) => `<span class="sm">${esc(modeName(mode))}</span> <span class="sm mute">· ${lk('Change in Brief', hrefOf('scenes', ctx.scene, 'brief'))}</span>`;

// ================= STAGE =================
const camLine = (c, mom) => (c ? `Camera ${c.key} · ${c.lens} mm${c.move && c.move.type && c.move.type !== 'static' ? ` · ${c.move.type.replace('-', ' ')} over ${c.move.seconds} s${mom === 'end' ? ' (the end of the move)' : ''}` : ' · does not move'}` : 'No camera');
const dim = (a) => frame(a === '16:9' || a === '1:1' ? a : '9:16', 480);

// People and objects as the camera sees them: [{ id, name, part, kind, x, y (percent), inFrame, side }]
function spots(stage, cam, W, H) {
  const out = [], one = (id, name, p, up, extra = {}) => {
    const q = project([p[0], p[1] + up, p[2]], cam, W, H), ok = !!q && q[0] > 0 && q[0] < W && q[1] > 0 && q[1] < H;
    out.push({ id, name, x: q ? Math.max(6, Math.min(94, q[0] / W * 100)) : 50, y: q ? Math.max(8, Math.min(92, q[1] / H * 100)) : 8, inFrame: ok, side: !q ? 'behind the camera' : q[0] < W * 0.4 ? 'left' : q[0] > W * 0.6 ? 'right' : 'centre', ...extra });
  };
  for (const c of stage.characters || []) one(c.id, nameOf(c), c.pos, (c.height || 1.7) * 0.55, { who: true });
  for (const o of (stage.set || []).filter((x) => x.type !== 'light')) one(o.id, o.name || o.id, o.pos, (o.size || [0, 0.5, 0])[1] / 2);
  return out;
}

function stageHtml(ctx) {
  const sc = sceneOf(ctx), d = sc.data, id = ctx.scene, ref = R.stage(id), a = get(ref), clips = clipsOf(d), mom = SS.mom;
  const toggle = `<span class="lbl" style="margin-top:0">Which moment do you want to look at?</span><div>${['start', 'end'].map((k) => `<span class="ch cl ${mom === k ? 'on' : ''}" tabindex="0" role="button" aria-pressed="${mom === k}" data-act="wzs-mom" data-v="${k}">${k === 'start' ? 'Start' : 'End'} of the scene</span>`).join('')}</div>`;
  const src = `<span class="lbl">Where the pictures come from</span><div class="arow"><b>Start picture</b><div>${sourceLine(ctx, (d.start || {}).mode || 'stage')}</div></div><div class="arow"><b>End picture</b><div>${sourceLine(ctx, (d.end || {}).mode || 'stage')}</div></div>`;
  if (!a) {
    const A = `<p style="margin:0 0 10px">There is no layout for this scene yet. I can set one up from the people and the place in your Brief. You can move everything afterwards.</p><button class="bt pri big wzs-go" data-act="wzs-setup">Set up the stage</button>${src}`;
    return spine(ctx, { head: head(ctx), A, B: nothing('Nothing to review yet. Set up the stage and it will appear here.'), items: [], empty: true, gate: { ready: false, reason: 'Set up the stage first. Then look at it and press "Looks right".' }, ai: 'There is no layout for this scene yet. I can set one up from the people and the place in your Brief.' });
  }
  const stage = a.data, [W, H] = dim(aspect()), cam = camFor(stage, id, mom === 'start' ? 1 : clips.length, mom);
  const hot = cam ? spots(stage, cam, W, H) : [], cams = Object.entries(stage.cameras || {});
  const still = mom === 'end' && cam && camFor(stage, id, 1, 'start') && JSON.stringify(camFor(stage, id, 1, 'start').pos) === JSON.stringify(cam.pos);
  const viewSw = `<span class="lbl" style="margin-top:0">How do you want to see it?</span><div>${[['plan', 'Floor plan · drag things to move them'], ['shot', 'Through the camera']].map(([k, l]) => `<span class="ch cl ${SS.view === k ? 'on' : ''}" tabindex="0" role="button" aria-pressed="${SS.view === k}" data-act="wzs-view" data-v="${k}">${l}</span>`).join('')}</div>`;
  const A = `${viewSw}${SS.view === 'shot' ? toggle : ''}<div class="wzs-open"><a class="bt pri big wzs-go" href="#/stage/${esc(id)}">Open the 3D editor</a><span class="sm mute">Move people, objects and cameras in 3D. There is a way back to this page.</span></div>${src}
    <div class="sm mute" style="margin-top:10px">The pictures are made from this layout on the ${lk('Pictures', hrefOf('scenes', id, 'pictures'))} page.</div>`;
  const view = `<figure class="wzs-view" style="--w:${W};--h:${H}"><div class="wzs-cap"><span>Where everyone stands</span><span>${mom} of the scene</span></div><div class="wzs-frame"><canvas id="wzs-cv" width="${W}" height="${H}" role="img" aria-label="The stage seen from the camera at the ${mom} of the scene"></canvas>${hot.map((s) => itemEl(ref, `<span class="wzs-dot">${esc(s.name.charAt(0))}</span><span class="wzs-lab">${esc(s.name)}</span>`, { part: `obj:${s.id}`, kind: 'obj', name: s.name, cls: `wzs-hot ${s.inFrame ? '' : 'out'}`, plain: true }).replace('<div class="pk', `<div style="left:${s.x.toFixed(1)}%;top:${s.y.toFixed(1)}%" class="pk`)).join('')}</div><figcaption class="sm mute">${esc(camLine(cam, mom))}${still ? '. The camera does not move in this scene, so the end looks like the start.' : ''}</figcaption></figure>`;
  const list = `<span class="lbl" style="margin-top:0">In the picture · click one to move it</span>${hot.map((s) => itemEl(ref, `<div class="ri"><b>${esc(s.name)}</b><div class="sm mute">${s.inFrame ? s.side : 'not in the picture'}</div></div>`, { part: `obj:${s.id}`, kind: 'obj', name: s.name, cls: 'wzs-row', plain: true })).join('')}${cams.map(([k, c]) => itemEl(ref, `<div class="ri"><b>Camera ${esc(k)}</b><div class="sm mute">${c.lens} mm${c.move && c.move.type !== 'static' ? ` · ${esc(c.move.type.replace('-', ' '))}` : ''}</div></div>`, { part: `obj:cam-${k}`, kind: 'obj', name: `Camera ${k}`, cls: 'wzs-row', plain: true })).join('')}<div style="margin-top:12px">${itemEl(ref, `<div class="row"><b>The whole layout</b>${chipOf(ref)}</div>`, { kind: 'obj', name: 'The layout', cls: 'wzs-row' })}</div>`;
  const ed = isHuman(), camCtl = cams.map(([k, c]) => `<div class="wzs-camrow"><b>Camera ${esc(k)}</b><label class="sm">Lens <select class="f" data-wzs-cam="${esc(k)}" data-f="lens" ${ed ? '' : 'disabled'}>${LENSES.map((l) => `<option value="${l}" ${Number(c.lens) === l ? 'selected' : ''}>${l} mm</option>`).join('')}</select></label><label class="sm">Move <select class="f" data-wzs-cam="${esc(k)}" data-f="move" ${ed ? '' : 'disabled'}>${MOVES.map((m) => `<option value="${m}" ${(c.move || {}).type === m ? 'selected' : ''}>${m.replace('-', ' ')}</option>`).join('')}</select></label></div>`).join('');
  const plan = `<figure class="wzs-view wzs-plan"><div class="wzs-cap"><span>The stage from above</span><span>${ed ? 'drag to move' : 'view only'}</span></div><canvas id="wzs-plan" width="640" height="460" role="img" aria-label="The stage from above. People, objects and cameras can be dragged."></canvas><figcaption class="sm mute">${ed ? 'Drag a person, an object or a camera. Drag the small ring to aim a camera. Dashed line: where a camera moves to. For small steps use the arrows on the right.' : 'You can look but not move things.'}</figcaption>${camCtl}</figure>`;
  const B = `<div class="wzs-b ${SS.view === 'plan' ? 'wzs-wide' : ''}">${SS.view === 'plan' ? plan : view}<div>${list}</div></div>`;
  const checks = checkStage(stage, { aspect: aspect(), cast: castArts().map((c) => c.ref) });
  const notice = checks.map((x) => [x.lvl === 'ok' ? 'ok' : 'warn', esc(x.txt)]);
  return spine(ctx, { head: head(ctx), A, B, items: [ref], noun: ['layout', 'layouts'], notice, ai: 'This is who stands where and where the camera is. Drag people, objects and cameras on the floor plan to move them, or click one for small steps. The 3D editor is there for fine work.', next: { label: 'Go to Pictures →', href: hrefOf('scenes', id, 'pictures') } });
}

function drawStage(root, ctx) {
  const cv = $('#wzs-cv', root), a = get(R.stage(ctx.scene)); if (!cv || !a) return;
  const sc = sceneOf(ctx), clips = clipsOf(sc.data), cam = camFor(a.data, ctx.scene, SS.mom === 'start' ? 1 : clips.length, SS.mom);
  if (cam) renderScene(cv.getContext('2d'), { ...a.data, cameras: {} }, cam, cv.width, cv.height, 'layout');
}

registerSub('stage', {
  items: (ctx) => (get(R.stage(ctx.scene)) ? [R.stage(ctx.scene)] : []),
  html: stageHtml,
  bind: (root, ctx) => { drawStage(root, ctx); bindPlan(root, ctx); },
  acts: {
    'wzs-view': (el) => { SS.view = el.dataset.v === 'shot' ? 'shot' : 'plan'; return 'render'; },
    'wzs-mom': (el) => { SS.mom = el.dataset.v === 'end' ? 'end' : 'start'; return 'render'; },
    async 'wzs-setup'() {
      const id = W.scene, sc = get(R.scene(id)); if (!sc) return;
      const data = starterStage(id, sc.data, (r) => (get(r) || {}).data, (r) => (r && get(r) || {}).data || null);
      await createArtifact(R.stage(id), data, { parent: R.scene(id), why: 'A first layout made from the scene (the people, the place, one camera per clip)' });
      toast('The stage is set up. Look at it, move what is off, then press "Looks right".'); return 'refresh';
    },
  },
});

// ---- the floor plan: draw it, and let a person drag things on it ----
const PALETTE = ['#2d6f8f', '#7a4f9a', '#b5651d', '#3d7a4a', '#a23b5a'];
function geoOf(cv, stage) { const b = planBounds(stage), s = Math.min(cv.width / (b.x1 - b.x0), cv.height / (b.z1 - b.z0)); return { b, s, ox: (cv.width - (b.x1 - b.x0) * s) / 2, oz: (cv.height - (b.z1 - b.z0) * s) / 2 }; }
function drawPlan(cv, stage, sel, geo) {
  const g = cv.getContext('2d'), { b, s, ox, oz } = geo, X = (x) => ox + (x - b.x0) * s, Z = (z) => oz + (z - b.z0) * s;
  g.clearRect(0, 0, cv.width, cv.height); g.fillStyle = '#f4efe3'; g.fillRect(0, 0, cv.width, cv.height);
  g.lineWidth = 1; g.font = '11px ui-monospace,monospace'; g.fillStyle = '#9a917c';
  for (let x = Math.ceil(b.x0); x <= b.x1; x++) { g.strokeStyle = x === 0 ? '#c9bfa6' : '#e4dcc9'; g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), cv.height); g.stroke(); if (x % 2 === 0) g.fillText(`${x} m`, X(x) + 3, cv.height - 4); }
  for (let z = Math.ceil(b.z0); z <= b.z1; z++) { g.strokeStyle = z === 0 ? '#c9bfa6' : '#e4dcc9'; g.beginPath(); g.moveTo(0, Z(z)); g.lineTo(cv.width, Z(z)); g.stroke(); }
  const on = (id) => sel === id;
  (stage.set || []).filter((o) => o.type !== 'light').forEach((o, i) => { const w = ((o.size || [0.5, 0.5, 0.5])[0]) * s, d = Math.max(0.2, (o.size || [0.5, 0.5, 0.5])[2]) * s, rot = (Array.isArray(o.rot) ? o.rot[1] : o.rot || 0) * Math.PI / 180;
    g.save(); g.translate(X(o.pos[0]), Z(o.pos[2])); g.rotate(rot); g.fillStyle = 'rgba(181,101,29,.22)'; g.strokeStyle = on(o.id) ? '#b3261e' : '#b5651d'; g.lineWidth = on(o.id) ? 3 : 1.5; g.fillRect(-w / 2, -d / 2, w, d); g.strokeRect(-w / 2, -d / 2, w, d); g.restore();
    g.fillStyle = '#6b5a3a'; g.font = '12px Georgia,serif'; g.fillText(o.name || o.id, X(o.pos[0]) - 22, Z(o.pos[2]) - d / 2 - 5); });
  for (const [k, c] of Object.entries(stage.cameras || {})) {
    const p = [X(c.pos[0]), Z(c.pos[2])], t = [X(c.target[0]), Z(c.target[2])], a = Math.atan2(t[1] - p[1], t[0] - p[0]), half = Math.atan(12 / (c.lens || 35)), len = Math.max(40, Math.hypot(t[0] - p[0], t[1] - p[1])), e = moveEnd(c), pe = [X(e.pos[0]), Z(e.pos[2])];
    g.fillStyle = 'rgba(15,107,107,.10)'; g.strokeStyle = 'rgba(15,107,107,.45)'; g.lineWidth = 1; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] + Math.cos(a - half) * len, p[1] + Math.sin(a - half) * len); g.lineTo(p[0] + Math.cos(a + half) * len, p[1] + Math.sin(a + half) * len); g.closePath(); g.fill(); g.stroke();
    if (Math.hypot(pe[0] - p[0], pe[1] - p[1]) > 4) { g.setLineDash([6, 5]); g.strokeStyle = '#0f6b6b'; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(pe[0], pe[1]); g.stroke(); g.setLineDash([]); g.beginPath(); g.arc(pe[0], pe[1], 6, 0, 7); g.stroke(); }
    g.save(); g.translate(p[0], p[1]); g.rotate(a); g.fillStyle = '#0f6b6b'; g.strokeStyle = on(`cam-${k}`) ? '#b3261e' : '#fff'; g.lineWidth = on(`cam-${k}`) ? 3 : 1.5; g.beginPath(); g.moveTo(16, 0); g.lineTo(-11, -11); g.lineTo(-11, 11); g.closePath(); g.fill(); g.stroke(); g.restore();
    g.fillStyle = '#0f6b6b'; g.font = '700 12px ui-monospace,monospace'; g.fillText(`Cam ${k}`, p[0] + 14, p[1] + 20);
    g.beginPath(); g.arc(t[0], t[1], 9, 0, 7); g.strokeStyle = on(`aim-${k}`) ? '#b3261e' : '#0f6b6b'; g.lineWidth = on(`aim-${k}`) ? 3 : 2; g.stroke(); g.beginPath(); g.arc(t[0], t[1], 2.5, 0, 7); g.fillStyle = '#0f6b6b'; g.fill();
  }
  (stage.characters || []).forEach((c, i) => { g.beginPath(); g.arc(X(c.pos[0]), Z(c.pos[2]), Math.max(11, 0.28 * s), 0, 7); g.fillStyle = PALETTE[i % PALETTE.length]; g.fill(); g.lineWidth = on(c.id) ? 3.5 : 1.5; g.strokeStyle = on(c.id) ? '#b3261e' : '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.font = '700 13px Georgia,serif'; g.textAlign = 'center'; g.fillText(nameOf(c).charAt(0).toUpperCase(), X(c.pos[0]), Z(c.pos[2]) + 4.5); g.textAlign = 'left'; g.fillStyle = '#2b2418'; g.font = '12px Georgia,serif'; g.fillText(nameOf(c), X(c.pos[0]) + 15, Z(c.pos[2]) - 10); });
}
function bindPlan(root, ctx) {
  const cv = $('#wzs-plan', root), a = get(R.stage(ctx.scene)); if (!cv || !a) return;
  const ref = a.ref, geo = geoOf(cv, a.data), names = (c) => nameOf(c), draw = (stage) => drawPlan(cv, stage, SS.sel, geo); draw(a.data);
  $$('[data-wzs-cam]', root).forEach((sel) => sel.addEventListener('change', async () => { try { await ownEdit(ref, (d) => { setCamera(d, sel.dataset.wzsCam, { [sel.dataset.f]: sel.value }); return d; }, `Camera ${sel.dataset.wzsCam}: ${sel.dataset.f} set to ${sel.value}`); toast(`Camera ${sel.dataset.wzsCam} changed.`); refresh(); } catch (e) { toast(e.message); } }));
  if (!isHuman()) return;
  const world = (e) => { const r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * cv.width / r.width, py = (e.clientY - r.top) * cv.height / r.height; return [(px - geo.ox) / geo.s + geo.b.x0, (py - geo.oz) / geo.s + geo.b.z0]; };
  const tol = () => Math.max(0.35, 18 / geo.s); // a fingertip-sized target
  let last = null;
  cv.addEventListener('pointerdown', (e) => {
    const [x, z] = world(e), hit = planHit(planItems(a.data, names), x, z, tol());
    SS.sel = hit ? hit.id : null; if (!hit) { draw(a.data); return; }
    cv.setPointerCapture(e.pointerId); SS.drag = hit; SS.work = JSON.parse(JSON.stringify(a.data)); last = [hit.x, hit.z]; cv.style.cursor = 'grabbing'; draw(SS.work);
  });
  cv.addEventListener('pointermove', (e) => {
    const [x, z] = world(e);
    if (!SS.drag) { cv.style.cursor = planHit(planItems(a.data, names), x, z, tol()) ? 'grab' : 'default'; return; }
    last = [x, z]; moveTo(SS.work, SS.drag, x, z); draw(SS.work);
  });
  const end = async (e) => {
    if (!SS.drag) return; const hit = SS.drag; SS.drag = null; cv.style.cursor = 'grab';
    const moved = Math.hypot(last[0] - hit.x, last[1] - hit.z) > 0.04; SS.work = null; if (!moved) { draw(a.data); return; }
    try { await ownEdit(ref, (d) => { moveTo(d, hit, last[0], last[1]); return d; }, `Moved ${hit.name} on the floor plan`); toast(`Moved ${hit.name}.`); refresh(); } catch (x) { toast(x.message); draw(a.data); }
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', () => { SS.drag = null; SS.work = null; draw(a.data); });
}

// The margin card's nudge arrows (and the facing slider) move one person, object or camera on the stage.
registerFix('obj', {
  cost: 0,
  async run(instr) {
    const was = (get(instr.ref) || {}).status; // what it was before this note was written: a layout still waiting for review stays waiting
    const a = await api(P('/artifacts/' + encodeURIComponent(instr.ref))), data = JSON.parse(JSON.stringify(a.data));
    if (!instr.part || !nudgeStage(data, instr.part, instr.draft.v)) return 'Saved your note. Nothing to move here, so the layout is as it was.';
    await api(P('/propose'), { method: 'POST', body: { ref: instr.ref, data, parent: a.parent || undefined, deps: (a.deps || []).filter((x) => x !== a.parent), auto_approve: was !== 'proposed', rationale: `${instr.name}: ${instr.text.replace(/^I will move /, 'moved ')}` } });
    const me = (st.me || {}).name; // the move is done, so the note about it is settled
    for (const c of (await api(P('/comments'))).filter((x) => x.ref === instr.ref && x.status === 'open' && !x.parent && x.verdict === 'change' && x.author === me && (x.anchor || '').includes(`part:${instr.part}`))) await api(P(`/comments/${c.id}`), { method: 'POST', body: { resolved: true } });
    return `Moved ${instr.name}. Each click is ${Math.round(STEP * 100)} cm.`;
  },
});

// ================= PICTURES =================
const imgs = (ref) => ((get(ref) || {}).assets || []).filter((x) => (x.mime || '').startsWith('image/'));
const chosenOf = (ref) => ((get(ref) || {}).data || {}).chosen || '';
const sceneNo = (ctx) => (sceneOf(ctx).data || {}).n;
const prevScene = (ctx) => { const n = sceneNo(ctx); return n > 1 ? Object.values(st.d.by).find((a) => a.kind === 'scene' && (a.data || {}).n === n - 1) : null; };
const lastEnd = (sc) => { const k = clipsOf(sc.data).length; return R.frame(keyOf(sc.ref), k, 'end'); };

function slotHtml(ctx, s, stage) {
  const id = ctx.scene, cands = imgs(s.ref), pick = chosenOf(s.ref), box = '<div class="wzs-sheet">';
  if (s.mode === 'skip') return `<div class="wzs-slot"><div class="row"><b>${esc(s.label)}</b>${pill('skipped', 'warn')}</div><div class="nopic">Skipped in the Brief. The video maker decides it. ${lk('Change in Brief', hrefOf('scenes', id, 'brief'))}</div></div>`;
  if (s.mode === 'chain') {
    const ps = prevScene(ctx), pr = ps && lastEnd(ps), pi = pr ? imgs(pr) : [], use = pr && pi.find((x) => x.id === chosenOf(pr)) || pi[pi.length - 1];
    return `<div class="wzs-slot"><div class="row"><b>${esc(s.label)}</b>${pill('from the scene before', 'info')}</div>${use ? `<div class="wzs-sheet one"><figure class="wzs-c"><div class="wzs-img"><img src="${esc(mediaSrc(use.uri))}" alt="End picture of scene ${ps.data.n}"></div><figcaption class="sm mute">End picture of scene ${ps.data.n}</figcaption></figure><p class="sm" style="margin:0">This picture is used as the start. It is the end picture of the scene before, so the cut is seamless. ${lk('Change in Brief', hrefOf('scenes', id, 'brief'))}</p></div>` : `<div class="nopic">${ps ? `Scene ${ps.data.n} has no end picture yet. ${lk('Make it there first', hrefOf('scenes', keyOf(ps.ref), 'pictures'))}` : 'There is no scene before this one.'} ${lk('Change in Brief', hrefOf('scenes', id, 'brief'))}</div>`}</div>`;
  }
  const lay = stage ? `<figure class="wzs-c"><div class="wzs-img lay"><canvas data-lay="${esc(s.which)}" data-clip="${s.clip}" width="180" height="320" aria-label="Your layout at the ${s.which}"></canvas></div><figcaption class="sm mute">your layout</figcaption></figure>` : `<figure class="wzs-c"><div class="wzs-img nolay"><span>No layout yet</span></div><figcaption class="sm mute">${lk('Set up the stage', hrefOf('scenes', id, 'stage'))}</figcaption></figure>`;
  const sorted = [...cands].reverse().sort((a, b) => (b.id === pick) - (a.id === pick)).slice(0, 6);
  const cell = (x, i) => {
    const on = x.id === pick, staged = stage && (stage.shots || {})[R.shot(id, s.clip)], adh = SS.adh[x.id], src = mediaSrc(x.uri);
    return itemEl(s.ref, `<div class="wzs-img"><img src="${esc(src)}" alt="${esc(s.label)}, picture ${i + 1}">${on ? '<em>in use</em>' : ''}</div><div class="row wzs-act">${on ? '' : `<button class="bt sm" data-act="wzs-use" data-ref="${esc(s.ref)}" data-id="${esc(x.id)}">Use this</button>`}${staged && stage ? `<button class="bt sm" data-act="wzs-adh" data-ref="${esc(s.ref)}" data-id="${esc(x.id)}" data-uri="${esc(x.uri)}" data-clip="${s.clip}" ${SS.adh[x.id] === 'busy' ? 'disabled' : ''}>${SS.adh[x.id] === 'busy' ? 'Checking…' : 'Check layout'}</button>` : ''}</div>${adh && adh !== 'busy' ? adhHtml(adh) : ''}`, { part: `pic:${x.id}`, kind: 'frame', img: src, name: `${s.label}, picture ${i + 1}`, cls: `wzs-c ${on ? 'on' : ''}`, plain: true, tag: 'figure' });
  };
  return `<div class="wzs-slot"><div class="row"><b>${esc(s.label)}</b>${pick ? pill('chosen', 'ok') : cands.length ? pill('choose one', 'warn') : pill('not made yet')}<span class="sp"></span><span class="sm mute">${esc(modeName(s.mode))} · ${lk('Change in Brief', hrefOf('scenes', id, 'brief'))}</span></div>${box}${lay}${sorted.length ? sorted.map(cell).join('') : `<figure class="wzs-c"><div class="wzs-img nopic2"><span>${s.mode === 'own' ? 'Your own picture from the Brief shows here' : 'No pictures yet'}</span></div><figcaption class="sm mute">${s.mode === 'own' ? '' : 'Make 3 pictures above'}</figcaption></figure>`}</div></div>`;
}
const adhHtml = (r) => (r.error ? `<div class="sm wzs-adh">${esc(r.error)}</div>` : `<div class="wzs-adh sm"><b>${Math.round(r.score * 100)}% like the layout</b>${driftLines(r).filter((x) => x[0] !== 'ok').map((x) => `<div><i class="dot warn"></i> ${esc(x[1])}</div>`).join('') || '<div>The picture follows the layout.</div>'}</div>`);

function picturesHtml(ctx) {
  const sc = sceneOf(ctx), id = ctx.scene, d = sc.data, slots = slotsOf(id, d), stageA = get(R.stage(id)), stage = stageA && stageA.data;
  const own = slots.filter((s) => s.mode !== 'skip' && s.mode !== 'chain'), left = st.budget ? Math.max(0, st.budget.budget - st.budget.spent) : null;
  const errs = Object.entries(SS.err).filter(([k]) => slots.some((s) => s.ref === k));
  const note = !stageA ? `<p class="sm" style="margin:0 0 8px">There is no layout yet, so the pictures are made without one. ${lk('Set up the stage first', hrefOf('scenes', id, 'stage'))} to make them match.</p>` : stageA.status === 'proposed' ? `<p class="sm" style="margin:0 0 8px">The layout still waits for your review, so pictures are made without it. ${lk('Review the stage first', hrefOf('scenes', id, 'stage'))}.</p>` : '';
  const A = `${note}<span class="lbl" style="margin-top:0">Make the pictures</span>${slots.map((s) => {
    const b = SS.busy[s.ref], n = imgs(s.ref).length;
    return `<div class="arow"><b>${esc(s.label)}</b><div>${s.mode === 'skip' ? `<span class="sm mute">Skipped in the Brief · ${lk('Change in Brief', hrefOf('scenes', id, 'brief'))}</span>` : s.mode === 'chain' ? `<span class="sm">Uses the end picture of the scene before. ${lk('Change in Brief', hrefOf('scenes', id, 'brief'))}</span>` : s.mode === 'own' ? `<span class="sm">Your own picture. ${lk('Change in Brief', hrefOf('scenes', id, 'brief'))}</span>` : `<button class="bt acc sm" data-act="wzs-make" data-ref="${esc(s.ref)}" data-which="${s.which}" data-clip="${s.clip}" ${b ? 'disabled' : ''}>${b ? `Making pictures… ${b.done} of 3` : n ? 'Make 3 more · 3 credits' : 'Make 3 pictures · 3 credits'}</button>`}</div></div>${SS.err[s.ref] ? `<div class="wzs-err" role="alert">${esc(SS.err[s.ref].text)} ${SS.err[s.ref].href ? lk(esc(SS.err[s.ref].go), SS.err[s.ref].href) : ''}</div>` : ''}`;
  }).join('')}${left !== null ? `<div class="sm mute" style="margin-top:8px">Credits left: ${Math.round(left)} of ${st.budget.budget}</div>` : ''}`;
  const B = slots.map((s) => slotHtml(ctx, s, stage)).join('');
  const items = own.map((s) => s.ref).filter((r) => get(r));
  const missing = own.filter((s) => !chosenOf(s.ref)).map((s) => s.label.toLowerCase());
  const gate = { ready: !missing.length, reason: missing.length ? `Choose a picture with "Use this" for: ${missing.join(', ')}.` : 'Every picture you need is chosen. You can go on.' };
  const notice = [];
  if (stage && imgs(slots[0].ref).length) notice.push(['ok', 'Pictures are made from your layout and the anchor faces. "Check against the layout" shows where a picture drifted.']);
  for (const [k] of errs) notice.push(['warn', esc(SS.err[k].text)]);
  return spine(ctx, { head: head(ctx), A, B, items, noun: ['picture', 'pictures'], gate, notice, ai: own.length ? 'I make three pictures for each start and end from your layout. Choose one with "Use this", or click one to say what is off.' : 'No pictures to make for this scene. The Brief decides where they come from.', next: { label: 'Go to Sound →', href: hrefOf('scenes', id, 'sound') }, act: missing.length ? 'A' : 'C' });
}

// Make 3 pictures for one slot: three requests in parallel (the first alone when the slot has never been made, so the clip shells are not created twice).
async function make(ref, scene, clip, which, instruction) {
  const call = () => api(P('/wizard/frame'), { method: 'POST', body: { scene, clip, which, ...(instruction ? { instruction } : {}) } });
  const b = (SS.busy[ref] = { done: 0 }), errs = [], one = async () => { try { await call(); } catch (e) { errs.push(e.message); } b.done++; rerender(); };
  try { if (!get(ref)) await one(); const rest = 3 - b.done; await Promise.all(Array.from({ length: rest }, one)); } finally { delete SS.busy[ref]; }
  return { made: 3 - errs.length, error: errs[0] };
}
const doneToast = (r, scene) => { const e = r.error && plainError(r.error, scene); return r.made === 3 ? 'Made 3 new pictures.' : r.made ? `Made ${r.made} of 3 pictures. ${e.text}` : e.text; };

registerSub('pictures', {
  items: (ctx) => slotsOf(ctx.scene, sceneOf(ctx).data).filter((s) => s.mode !== 'skip' && s.mode !== 'chain').map((s) => s.ref).filter((r) => get(r)),
  html: picturesHtml,
  bind(root, ctx) {
    const a = get(R.stage(ctx.scene)); if (!a) return;
    $$('canvas[data-lay]', root).forEach((cv) => { const cam = camFor(a.data, ctx.scene, +cv.dataset.clip, cv.dataset.lay); if (cam) renderScene(cv.getContext('2d'), { ...a.data, cameras: {} }, cam, cv.width, cv.height, 'layout'); });
  },
  acts: {
    async 'wzs-make'(el) {
      const ref = el.dataset.ref, scene = W.scene; delete SS.err[ref];
      rerender(); const r = await make(ref, scene, +el.dataset.clip, el.dataset.which);
      if (r.error) SS.err[ref] = plainError(r.error, scene);
      toast(doneToast(r, scene)); return 'refresh';
    },
    async 'wzs-use'(el) { await ownEdit(el.dataset.ref, (d) => ({ ...d, chosen: el.dataset.id }), 'Chosen in the wizard'); await approveRefs([el.dataset.ref]); delete SS.err[el.dataset.ref]; toast('This picture is in use.'); return 'refresh'; },
    async 'wzs-adh'(el) {
      const id = el.dataset.id, ref = el.dataset.ref, scene = W.scene; SS.adh[id] = 'busy'; rerender();
      try { SS.adh[id] = await api(P('/meta/adherence'), { method: 'POST', body: { stage: R.stage(scene), shot: R.shot(scene, +el.dataset.clip), uri: el.dataset.uri } }); }
      catch (e) { SS.adh[id] = { error: /MODEL_API_KEY|not set/i.test(e.message) ? 'The layout check is not available right now.' : /nothing in frame|no camera/i.test(e.message) ? 'The layout has nobody in frame for this clip, so there is nothing to compare.' : `I could not check it: ${e.message}` }; }
      return 'render';
    },
  },
});

// A candidate's margin card: "Fix it" makes 3 new pictures with the instruction (3 credits, one per picture). "Looks right" on a candidate means "Use this".
registerFix('frame', {
  async run(instr) {
    const d = (get(instr.ref) || {}).data || {}, r = await make(instr.ref, d.scene, d.clip, d.role, instr.instruction);
    if (r.error) SS.err[instr.ref] = plainError(r.error, d.scene); else delete SS.err[instr.ref];
    return doneToast(r, d.scene);
  },
  async ok(sel) { for (const s of sel) if (s.part.startsWith('pic:')) { await ownEdit(s.ref, (d) => ({ ...d, chosen: s.part.slice(4) }), 'Chosen in the wizard'); } },
});
