// The margin card: click ANY AI-made item (an element made with itemEl() in w-core.js, i.e. class "pk" with data-ref, optional data-part, data-kind, data-img)
// and a note card opens in the margin next to it. Shift-click picks several items of the same kind and gives them the same feedback.
//
// What the person can do on the card: "Looks right" (approve); tap what is off; move sliders; drop numbered pins on the picture; keep chips; write or speak their own words;
// see the plan in plain words with its credit price; "Note for later" (a comment, free) or "Fix it" (a comment, a change request when the item still waits for review,
// then the regenerate handler registered for that kind).
//
// Comments written here: body = the plan sentence without its first sentence ("Fix: too young. Pins: 1 hair must cover the ears. Keep: face shape. Your words: ..."),
// verdict 'change', anchor = "part:<part>" and/or "pin:<n>@<x>,<y>" joined with ';' (x and y are 0..1 on the picture), context = the item's name.
//
// PLUGGING IN A REGENERATE HANDLER (other step files do this):
//   registerFix('face', { cost: 3, run: async (instr) => { await api(P('/wizard/face'), {method:'POST', body:{ id, variant, instruction: instr.instruction }}); return 'Made 3 new faces.'; } })
//   cost: credits per item (number) or (items) => number. Default is CFG[kind].cost in w-pure.js. run is called once per selected item with
//   instr = { ref, part, kind, name, draft:{tags,pins,keeps,v,note,mis}, instruction (readable text), text (whole plan sentence) }; the returned string is shown as the toast.
//   Kinds: sent file ent reading look ref face voice place scene shot obj pic line cue beat dir frame take pack (see CFG in w-pure.js).
// openFix({ ref, part, kind, el }) opens the card programmatically.
import { $, $$, esc, st, api, P, toast, mediaSrc } from './core.js';
import { get, threads } from './data.js';
import { W, itemKey, statusOf, chipOf, approveRefs } from './w-core.js';
import { CFG, kindFor, emptyDraft, planOf, fmtV, anchorOf } from './w-pure.js';

const REGFIX = {}, DR = {};
export const registerFix = (kind, def) => { REGFIX[kind] = def; };
const draftOf = (it) => DR[it.key] || (DR[it.key] = emptyDraft());
const costOf = (list) => { const h = REGFIX[list[0].kind], c = h && h.cost !== undefined ? h.cost : CFG[list[0].kind].cost; return typeof c === 'function' ? c(list) : c * list.length; };

// ---------- selection ----------
const itemOfEl = (el) => { const ref = el.dataset.ref, part = el.dataset.part || ''; return { key: itemKey(ref, part), ref, part, kind: kindFor(ref, el.dataset.kind), name: el.dataset.name || ref, img: el.dataset.img || '' }; };
const els = () => $$('.wz .wpage .pk');
const elOf = (it) => els().find((e) => itemKey(e.dataset.ref, e.dataset.part || '') === it.key);
export function markSel() { const keys = new Set(W.sel.map((s) => s.key)); els().forEach((e) => { const on = keys.has(itemKey(e.dataset.ref, e.dataset.part || '')); e.classList.toggle('sel', on); e.setAttribute('aria-pressed', String(on)); }); }
function paint() { markSel(); const w = $('#fxw'); if (w) { w.innerHTML = marginHtml(); } placeMargin(); }
export function selectEl(el, additive) {
  const it = itemOfEl(el);
  if (additive && W.sel.length && W.sel[0].kind === it.kind && !W.sel[0].part && !it.part) W.sel = W.sel.some((s) => s.key === it.key) ? W.sel.filter((s) => s.key !== it.key) : [...W.sel, it]; else W.sel = [it];
  paint();
}
export function selectFirst(target) {
  const all = els().filter((e) => e.dataset.st);
  const el = target ? els().find((e) => e.dataset.ref === target.ref && (e.dataset.part || '') === (target.part || '')) : all.find((e) => e.dataset.st !== 'ok') || null;
  if (el) { W.sel = [itemOfEl(el)]; paint(); }
}
export function openFix({ ref, part = '', kind, el } = {}) {
  const e = el || els().find((x) => x.dataset.ref === ref && (x.dataset.part || '') === part);
  W.sel = [e ? itemOfEl(e) : { key: itemKey(ref, part), ref, part, kind: kindFor(ref, kind), name: ((get(ref) || {}).data || {}).name || ref, img: '' }];
  if (kind) W.sel[0].kind = kindFor(ref, kind);
  paint();
}
// Put the card level with the selected item (wide screens); on narrow screens CSS pins it to the bottom.
export function placeMargin() {
  const w = $('#fxw'), sheet = $('.wz .sheet'); if (!w || !sheet) return;
  if (innerWidth < 1100) { w.style.top = ''; sheet.style.minHeight = ''; return; }
  const el = $('.wz .wpage .pk.sel'); let top = 0;
  if (el) top = el.getBoundingClientRect().top - sheet.getBoundingClientRect().top - 8;
  top = Math.max(0, top); w.style.top = `${top}px`; sheet.style.minHeight = `${top + w.offsetHeight + 24}px`;
}

// ---------- the card ----------
const imgOf = (it) => {
  if (it.img) return it.img;
  const a = get(it.ref), as = ((a && a.assets) || []).filter((x) => (x.mime || '').startsWith('image/')); if (!as.length) return '';
  const want = a.data && a.data.anchor, x = as.find((y) => y.id === want) || as[as.length - 1];
  return mediaSrc(x.uri);
};
const thumb = (it) => { const im = imgOf(it); return im ? `<div class="wth" style="width:40px"><img src="${esc(im)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"></div>` : `<div class="wth" style="--h:30;width:40px"><svg viewBox="0 0 60 80"><use href="#fig"/></svg></div>`; };
const btn = (act, label, cls = 'bt sm', attrs = '') => `<button class="${cls}" data-act="${act}" ${attrs}>${label}</button>`;
export function marginHtml() {
  const list = W.sel;
  if (!list.length) return `<div class="mcard wempty"><div class="mhead">✎ The margin</div><p class="sm mute" style="margin:0">Click anything the AI made to write a note on just that. Press "Looks right" when it is fine. Shift-click to pick several.</p></div>`;
  const f = list[0], cfg = CFG[f.kind], many = list.length > 1, d = draftOf(f), a = get(f.ref), im = imgOf(f);
  const p = planOf(list, d, cfg, costOf(list) / list.length), stt = statusOf(f.ref);
  const th = threads(f.ref).filter((c) => c.status !== 'resolved' && !c.parent && (!f.part || (c.anchor || '').includes(`part:${f.part}`))).slice(0, 3);
  const pads = (cfg.vis && !many ? `<span class="wk">Point at it. Click the picture to drop a pin</span><div class="pinpad" data-fx="pad" style="--h:30">${im ? `<img src="${esc(im)}" alt="" style="position:absolute;inset:7px;width:calc(100% - 14px);height:calc(100% - 14px);object-fit:cover">` : '<svg viewBox="0 0 60 80"><use href="#fig"/></svg>'}${d.pins.map((x) => `<b class="pin" style="left:${x.x * 100}%;top:${x.y * 100}%">${x.n}</b>`).join('')}</div>${d.pins.map((x) => `<div class="row" style="margin-top:5px"><b class="pinn">${x.n}</b><input class="f" data-fx="pn" data-n="${x.n}" value="${esc(x.note)}" placeholder="What is here?">${btn('wf-unpin', '×', 'bt sm', `data-n="${x.n}"`)}</div>`).join('')}` : '')
    + (cfg.words && !many && a && a.data && a.data.text ? `<span class="wk">Tap a word that is said wrong</span><div class="words">${String(a.data.text).split(' ').map((w) => `<span class="wd ${d.mis.includes(w) ? 'mis' : ''}" tabindex="0" role="button" data-act="wf-word" data-w="${esc(w)}">${esc(w)}</span>`).join(' ')}</div>` : '')
    + (cfg.nudge ? `<span class="wk">Nudge it</span><div class="nudge">${btn('wf-nu', '▲ back', 'bt sm', 'data-dir="up"')}<div class="row">${btn('wf-nu', '◀', 'bt sm', 'data-dir="left"')}<span class="mono sm mute">${d.v.dx || d.v.dz ? 'moved' : '0.0 m'}</span>${btn('wf-nu', '▶', 'bt sm', 'data-dir="right"')}</div>${btn('wf-nu', '▼ forward', 'bt sm', 'data-dir="down"')}</div>` : '');
  const mic = st.meta && st.meta.configured ? btn('mic', 'Speak', 'bt sm') : '';
  const draw = im && !many ? btn('markup', 'Draw', 'bt sm', `data-ref="${esc(f.ref)}" data-ctx="${esc(f.name)}" data-mode="sketch" data-base="${esc(im)}"`) : '';
  return `<div class="mcard"><div class="mhead">✎ Note in the margin · ${cfg.n}</div><div class="fx">
  <div class="row" style="flex-wrap:nowrap"><div style="display:flex;gap:10px;align-items:center;flex:1;min-width:0">${thumb(f)}<div><b style="font-size:14px">${many ? `${list.length} ${cfg.n}s selected` : esc(f.name)}</b><div class="sm mute">${many ? 'the same feedback applies to all' : esc(f.part ? `part: ${f.part}` : (a && a.rationale) || '')}</div></div></div>${btn('wf-close', '×', 'bt sm', 'aria-label="Close the note"')}</div>
  ${a && a.status === 'locked' ? '<div class="row" style="margin-top:6px"><span class="pl info">locked</span><span class="sm mute">Changing it marks what was built on it stale.</span></div>' : ''}${th.length ? `<div class="thr">${th.map((c) => `<div class="sm"><b>${esc(c.author)}</b> · ${esc(c.body || c.verdict || '')}${(c.replies || []).map((r) => `<div class="sm"><b>${esc(r.author)}</b> · ${esc(r.body)}</div>`).join('')}</div>`).join('')}</div>` : ''}
  <div class="row statrow" style="margin:10px 0 2px"><span>${many ? `${list.length} selected` : chipOf(f.ref)}</span><span class="sp"></span>${btn('wf-ok', `✓ ${many ? 'Looks right for all' : 'Looks right'}`, 'bt sm okb', stt === 'ok' ? 'disabled' : '')}</div>
  <span class="wk">${cfg.offT}</span><div>${cfg.off.map((o) => `<span class="ch cl ${d.tags.includes(o) ? 'on' : ''}" tabindex="0" role="button" data-act="wf-tag" data-v="${esc(o)}">${esc(o)}</span>`).join('')}</div>
  ${cfg.adj.length ? `<span class="wk">Adjust</span>${cfg.adj.map((x) => { const v = d.v[x.k] !== undefined ? d.v[x.k] : x.v; return `<div class="sl"><div class="row sm"><span>${x.l}</span><span class="sp"></span><b data-lab="${x.k}">${fmtV(x, v)}</b></div><input type="range" min="${x.lo || 0}" max="${x.hi || 100}" value="${v}" data-fx="adj" data-k="${x.k}"><div class="row sm mute"><span>${x.min}</span><span class="sp"></span><span>${x.max}</span></div></div>`; }).join('')}` : ''}
  ${pads}${cfg.keep.length ? `<span class="wk">Keep exactly as it is</span><div>${cfg.keep.map((o) => `<span class="ch cl ${d.keeps.includes(o) ? 'on' : ''}" tabindex="0" role="button" data-act="wf-keep" data-v="${esc(o)}">${d.keeps.includes(o) ? '✓ ' : ''}${esc(o)}</span>`).join('')}</div>` : ''}
  <span class="wk">Say it in your own words</span><div>${cfg.quick.map((q) => `<span class="ch x cl" tabindex="0" role="button" data-act="wf-quick" data-v="${esc(q)}">+ ${esc(q)}</span>`).join('')}</div>
  <div class="cmp"><textarea class="f" id="wf-note" data-fx="note" style="margin-top:4px" placeholder="Anything else?">${esc(d.note)}</textarea><div class="row" style="margin-top:6px">${mic}${draw}</div></div>
  <div class="wplan" id="wf-plan"><div class="sm"><b>What the AI will do</b></div><div class="sm" id="wf-plantext">${p.empty ? 'Choose what is off, or write a note.' : esc(p.text)}</div><div class="row sm" style="margin-top:6px"><span class="pl info" id="wf-plancost">${p.cost} credit${p.cost === 1 ? '' : 's'}</span><span class="pl warn">touches: ${esc(p.touch)}</span></div></div>
  <div class="row" style="margin-top:8px">${btn('wf-later', 'Note for later', 'bt')}<span class="sp"></span>${btn('wf-fix', p.cost ? `Fix it · ${p.cost} credit${p.cost === 1 ? '' : 's'}` : 'Fix it', 'bt pri')}</div></div></div>`;
}
const syncNote = () => { const t = $('#wf-note'); if (t && W.sel.length) W.sel.forEach((s) => { draftOf(s).note = t.value; }); };
function planLive() {
  syncNote(); if (!W.sel.length) return;
  const list = W.sel, p = planOf(list, draftOf(list[0]), CFG[list[0].kind], costOf(list) / list.length), t = $('#wf-plantext'), c = $('#wf-plancost');
  if (t) t.textContent = p.empty ? 'Choose what is off, or write a note.' : p.text;
  if (c) c.textContent = `${p.cost} credit${p.cost === 1 ? '' : 's'}`;
}
const redraw = () => { syncNote(); const w = $('#fxw'); if (w) { w.innerHTML = marginHtml(); placeMargin(); } };
const each = (fn) => { W.sel.forEach((s) => fn(draftOf(s), s)); redraw(); };
const toggle = (arr, v) => (arr.includes(v) ? arr.filter((z) => z !== v) : [...arr, v]);

async function send(mode) {
  syncNote(); const list = W.sel.slice(); if (!list.length) return;
  for (const it of list) if (planOf([it], draftOf(it), CFG[it.kind]).empty) { toast('Choose what is off, or write a note first.'); return; }
  const done = [];
  for (const it of list) {
    const d = draftOf(it), p = planOf([it], d, CFG[it.kind]), a = get(it.ref);
    await api(P('/comments'), { method: 'POST', body: { ref: it.ref, body: p.instruction, verdict: 'change', anchor: anchorOf(it.part, d.pins) || undefined, context: it.name } });
    if (mode === 'fix' && a && a.status === 'proposed') await api(P('/decide'), { method: 'POST', body: { ref: it.ref, action: 'request_changes', comment: p.instruction } });
    done.push({ it, d, p });
  }
  let msg = 'Saved. The AI will see your note.';
  if (mode === 'fix') {
    const h = REGFIX[list[0].kind]; toast('The AI is working on it...');
    if (h && h.run) {
      try { for (const { it, d, p } of done) { const r = await h.run({ ref: it.ref, part: it.part, kind: it.kind, name: it.name, draft: JSON.parse(JSON.stringify(d)), instruction: p.instruction, text: p.text }); if (typeof r === 'string') msg = r; else msg = 'Sent. The AI is working on it.'; } } catch (e) { msg = `Your note is saved, but I could not redo it yet: ${e.message}`; }
    } else { // no special handler for this kind: let the AI work through the feedback on these items
      toast('The AI is working on it...');
      try { await api(P('/meta/agent'), { method: 'POST', body: { goal: `Work only on the open feedback on ${[...new Set(done.map((x) => x.it.ref))].join(', ')}. Revise each item and answer each thread.` } }); msg = 'The AI worked on your note. Please review what changed.'; } catch (e) { msg = `Your note is saved, but the AI could not work on it yet: ${e.message}`; }
    }
  }
  list.forEach((it) => { delete DR[it.key]; }); toast(msg); return 'refresh';
}

export const fixActs = {
  'wf-tag': (el) => each((d) => { d.tags = toggle(d.tags, el.dataset.v); }),
  'wf-keep': (el) => each((d) => { d.keeps = toggle(d.keeps, el.dataset.v); }),
  'wf-quick': (el) => each((d) => { d.note = `${d.note ? d.note + ' ' : ''}${el.dataset.v}.`; }),
  'wf-word': (el) => each((d) => { d.mis = toggle(d.mis, el.dataset.w); }),
  'wf-unpin': (el) => each((d) => { d.pins = d.pins.filter((x) => x.n !== +el.dataset.n).map((x, i) => ({ ...x, n: i + 1 })); }),
  'wf-nu': (el) => each((d) => { const k = el.dataset.dir; d.v.dx = (d.v.dx || 0) + (k === 'left' ? -1 : k === 'right' ? 1 : 0); d.v.dz = (d.v.dz || 0) + (k === 'up' ? -1 : k === 'down' ? 1 : 0); }),
  'wf-close': () => { W.sel = []; paint(); },
  'wf-later': () => send('later'),
  'wf-fix': () => send('fix'),
  async 'wf-ok'() {
    const refs = W.sel.map((s) => s.ref), cur = W.sel[0], all = els().filter((e) => e.dataset.st), i = all.findIndex((e) => itemKey(e.dataset.ref, e.dataset.part || '') === cur.key);
    if (refs.some((r) => (get(r) || {}).status === 'changes_requested')) toast('You asked for a change. It can be approved once the AI has answered.');
    const h = REGFIX[cur.kind]; if (h && h.ok) await h.ok(W.sel); // a kind may turn "Looks right" into its own choice (a candidate picture becomes the one in use)
    await approveRefs(refs);
    const nx = i >= 0 && W.sel.length === 1 ? [...all.slice(i + 1), ...all.slice(0, i)].find((e) => e.dataset.st !== 'ok' && !refs.includes(e.dataset.ref)) : null;
    W.pending = nx ? { ref: nx.dataset.ref, part: nx.dataset.part || '' } : null;
    return 'refresh';
  },
};

// One set of listeners per render of the wizard root (the root is replaced on every render, so nothing piles up).
export function bindFix(root) {
  root.addEventListener('click', (e) => {
    const t = e.target, pad = t.closest('[data-fx=pad]');
    if (pad && W.sel.length) { const r = pad.getBoundingClientRect(), d = draftOf(W.sel[0]); d.pins.push({ n: d.pins.length + 1, x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), note: '' }); redraw(); return; }
    const go = t.closest('[data-go]'); if (go) { if (!go.disabled) location.hash = go.dataset.go; return; }
    if (t.closest('button,a,input,textarea,label,.ch,.wd,#fxw')) return;
    const it = t.closest('.wpage .pk'); if (it) selectEl(it, e.shiftKey || e.metaKey || e.ctrlKey);
  });
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[tabindex="0"]:not(button):not(input):not(textarea):not(a)')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: e.shiftKey })); }
  });
  root.addEventListener('input', (e) => {
    const t = e.target, fx = t.dataset && t.dataset.fx; if (!fx || !W.sel.length) return;
    if (fx === 'note') W.sel.forEach((s) => { draftOf(s).note = t.value; });
    else if (fx === 'adj') { const a = CFG[W.sel[0].kind].adj.find((z) => z.k === t.dataset.k); W.sel.forEach((s) => { draftOf(s).v[t.dataset.k] = +t.value; }); const lab = $(`#fxw [data-lab="${t.dataset.k}"]`); if (lab) lab.textContent = fmtV(a, +t.value); }
    else if (fx === 'pn') { const x = draftOf(W.sel[0]).pins.find((z) => z.n === +t.dataset.n); if (x) x.note = t.value; }
    planLive();
  });
  root.addEventListener('focusin', (e) => { if (e.target.closest('#fxw')) planLive(); });
  addEventListener('resize', placeMargin, { once: true });
}
