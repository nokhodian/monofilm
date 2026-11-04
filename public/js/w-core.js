// The wizard shell: contents column, step header, the page with its three parts (A "You tell me", B "I made this, please review", C "Then"), the margin column.
//
// HOW A STEP PLUGS IN (steps 3-7 are written by other files; this file never needs editing for that)
//   registerStep(key, { items?(ctx), html(ctx), bind?(root, ctx), acts? })      key is one of STEPS[].key (wizard-model.js)
//     items(ctx)  -> array of artifact refs the person must review on this page (drives counts, "Approve all", the forward button, the contents badge).
//     html(ctx)   -> a string (usually the result of spine(ctx, {...})); may be async.
//     bind(root, ctx) -> called after every render with the .wz root, to attach listeners to what html() produced.
//     acts        -> { 'name': (el) => void | 'refresh' | 'render' }, used as data-act="name" (merged into the studio's ACTS registry via wzActs). Prefix your names (e.g. 'wp-').
//   ctx = { step, scene, sub, d, get, ofKind }   scene/sub only on the 'scenes' step (#/w/scenes/<sceneId>/<sub>).
//   spine(ctx, { A, B, items, noun, ai, notice, act, next, gate, empty, title, head, right, n }) builds the whole page body; see its comment.
//   itemEl(ref, inner, { part, kind, cls, name, img, plain }) wraps anything the AI made so a click opens the margin card (w-fix.js).
//   Re-render without a network call: rerender(). Reload the data then render: refresh(). Both are the studio's existing document events.
import { $, $$, esc, st, api, P, toast } from './core.js';
import { get, ofKind, threads } from './data.js';
import { STEPS, SUBS, review, sceneReadiness, keyOf, REFS } from './wizard-model.js';
import { gateReason, progressText } from './w-pure.js';
import { fixActs, marginHtml, bindFix, placeMargin, selectFirst, markSel } from './w-fix.js';

export const W = { step: 'start', scene: null, sub: 'brief', sel: [], routeKey: '', fresh: false, keepY: 0, pending: null };
const REG = {};
export const wzActs = { ...fixActs };
export function registerStep(key, def) { REG[key] = def; if (def.acts) Object.assign(wzActs, def.acts); }
export const rerender = () => document.dispatchEvent(new Event('mf-rerender'));
export const refresh = () => document.dispatchEvent(new Event('mf-refresh'));

// ---------- route: #/w/<step>[/<sceneId>[/<sub>]] ----------
export const hrefOf = (step, scene, sub) => `#/w/${[step, scene, sub].filter(Boolean).map(encodeURIComponent).join('/')}`;
export const wgo = (step, scene, sub) => { location.hash = hrefOf(step, scene, sub); };
function readRoute() {
  const p = location.hash.replace(/^#\/?/, '').split('/').map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  let step = STEPS.some((s) => s.key === p[1]) ? p[1] : null;
  if (!step) step = get(REFS.reading) ? 'understand' : 'start'; // #/w alone: carry on where the person is
  const scene = step === 'scenes' && p[2] ? p[2] : null, sub = step === 'scenes' && scene ? (SUBS.some((u) => u[0] === p[3]) ? p[3] : 'brief') : 'brief';
  return { step, scene, sub };
}

// ---------- data helpers for steps ----------
export const castArts = () => ofKind('canon.cast');
export const placeArts = () => ofKind('canon.world').filter((a) => a.ref.startsWith('canon.world:place-'));
export const sceneArts = () => ofKind('scene').sort((a, b) => ((a.data || {}).n || 0) - ((b.data || {}).n || 0));
export const mats = () => ofKind('reference').filter((r) => (r.data || {}).category === 'material' && !(r.data || {}).removed);
export const ctxOf = (o = {}) => ({ step: W.step, scene: W.scene, sub: W.sub, d: st.d, get, ofKind, ...o });
// A human's own edit of an artifact. If the AI's version still waits for review it stays "To review" (the edit must not approve it by accident); otherwise it is approved at once.
export async function ownEdit(ref, fn, why = 'Edited in the wizard') {
  // base_version makes the studio refuse the save if the AI or another tab saved in between; we then read again and apply the same change to the newer data.
  for (let i = 0; ; i++) {
    const a = await api(P('/artifacts/' + encodeURIComponent(ref))), data = fn(JSON.parse(JSON.stringify(a.data)));
    try { return await api(P('/propose'), { method: 'POST', body: { ref, data, parent: a.parent || undefined, deps: (a.deps || []).filter((x) => x !== a.parent), auto_approve: a.status !== 'proposed', rationale: why, base_version: a.version } }); }
    catch (e) { if (!/changed while you were saving/.test(e.message) || i >= 4) throw e; }
  }
}

// ---------- review status of one item: 'review' (To review), 'ok' (Approved), 'change' (Needs a change), 'none' (not made yet) ----------
export const LBL = { review: 'To review', ok: 'Approved', change: 'Needs a change', none: 'Not made yet' };
export const IC = { review: '●', ok: '✓', change: '✎', none: '–' };
export const myOpenChanges = (ref) => threads(ref).filter((c) => c.status === 'open' && !c.parent && c.verdict === 'change' && c.author === (st.me || {}).name);
export function statusOf(ref) {
  const a = get(ref); if (!a) return 'none';
  if (ref.startsWith('keyframe:') && !(a.data || {}).chosen) return myOpenChanges(ref).length ? 'change' : (a.assets || []).length ? 'review' : 'none'; // a start/end picture is only approved once one candidate is chosen (the Pictures page)
  const s = review(a).state, note = myOpenChanges(ref).length > 0;
  if (s === 'change') return 'change';
  if (s === 'approved') return note ? 'change' : 'ok';
  return note ? 'change' : 'review';
}
export const chipOf = (ref) => { const k = statusOf(ref); return `<span class="wstc ${k}"><b aria-hidden="true">${IC[k]}</b>${LBL[k]}</span>`; };
export const itemKey = (ref, part) => ref + (part ? `|${part}` : '');
const openCount = (ref, part) => threads(ref).filter((c) => c.status === 'open' && !c.parent && (!part || (c.anchor || '').includes(`part:${part}`))).length;
// Anything the AI made: click it and the margin card opens next to it. part = a sub-part of the artifact (a sentence, a beat); it only anchors the comment, the status is the artifact's.
export function itemEl(ref, inner, o = {}) {
  const part = o.part || '', stt = statusOf(ref), show = !part && !o.plain && stt !== 'none', k = itemKey(ref, part), sel = W.sel.some((s) => s.key === k), b = openCount(ref, part) && stt !== 'ok' ? openCount(ref, part) : 0;
  const name = o.name || ((get(ref) || {}).data || {}).name || ((get(ref) || {}).data || {}).title || ref;
  return `<${o.tag || 'div'} class="pk ${o.cls || ''} ${sel ? 'sel' : ''}" data-ref="${esc(ref)}" data-part="${esc(part)}" data-kind="${esc(o.kind || '')}" data-name="${esc(name)}" data-img="${esc(o.img || '')}"${show ? ` data-st="${stt}" data-ic="${IC[stt]}"` : ''} tabindex="0" role="button" aria-pressed="${sel}" aria-label="Comment on ${esc(name)}${show ? '. ' + LBL[stt] : ''}">${inner}${b ? `<span class="bdg" title="${b} open comment${b > 1 ? 's' : ''}">${b}</span>` : ''}</${o.tag || 'div'}>`;
}
export const rowItem = (ref, main, sub, o = {}) => itemEl(ref, `<div class="ri"><b>${main}</b><div class="sm mute">${sub || ''}</div></div>${chipOf(ref)}`, { ...o, cls: `rowitem hc ${o.cls || ''}` });
export const pill = (t, c = '') => `<span class="pl ${c}">${esc(t)}</span>`;
export const lk = (label, href) => `<a class="lk" href="${href}">${label}</a>`;
export const nothing = (t = 'Nothing to write here.') => `<p class="nothing">${t}</p>`;

export async function approveRefs(refs) {
  let n = 0;
  for (const ref of [...new Set(refs)]) {
    const a = get(ref); if (!a) continue;
    if (a.status === 'proposed') { await api(P('/decide'), { method: 'POST', body: { ref, action: 'approve' } }); n++; }
    for (const c of myOpenChanges(ref)) await api(P(`/comments/${c.id}`), { method: 'POST', body: { resolved: true } }); // "Looks right" settles my own earlier notes
  }
  return n;
}
Object.assign(wzActs, {
  async 'w-all'(el) { const n = await approveRefs(JSON.parse(el.dataset.refs || '[]')); toast(n ? `Approved ${n} item${n === 1 ? '' : 's'}.` : 'Nothing was waiting for approval.'); return 'refresh'; },
});

// ---------- progress ----------
const ctxFor = (key) => ctxOf({ step: key, scene: null, sub: 'brief' });
export const itemsOf = (key) => { const def = REG[key]; try { return def && def.items ? [...new Set(def.items(ctxFor(key)) || [])].filter((r) => get(r)) : []; } catch { return []; } };
export function stepDone(key) {
  if (key === 'start') return !!get(REFS.reading);
  if (key === 'ship') return false;
  const it = itemsOf(key); if (!it.length) return false;
  if (!it.every((r) => statusOf(r) === 'ok')) return false;
  return key !== 'scenes' || sceneArts().every((s) => sceneReadiness(s, rctx()).every((x) => x === 2));
}
const rctx = () => ({ get, assets: (ref) => (get(ref) || {}).assets || [] });
const todoOf = (key) => itemsOf(key).filter((r) => statusOf(r) !== 'ok').length;
const grpOf = (s, sub) => (s.group === 'film' ? 'canon' : s.group === 'finish' ? 'ship' : sub ? sub : 'over');

function defaultNext(ctx) {
  const i = STEPS.findIndex((s) => s.key === ctx.step), scenes = sceneArts();
  if (ctx.step === 'ship') return null;
  if (ctx.step === 'scenes') {
    if (!ctx.scene) return scenes.length ? { label: 'Open scene 1 →', href: hrefOf('scenes', keyOf(scenes[0].ref)) } : { label: 'Go to Ship →', href: hrefOf('ship') };
    const k = SUBS.findIndex((u) => u[0] === ctx.sub), si = scenes.findIndex((s) => keyOf(s.ref) === ctx.scene);
    if (k < SUBS.length - 1) return { label: `Go to ${SUBS[k + 1][1]} →`, href: hrefOf('scenes', ctx.scene, SUBS[k + 1][0]) };
    return si >= 0 && si < scenes.length - 1 ? { label: `Go to scene ${si + 2} →`, href: hrefOf('scenes', keyOf(scenes[si + 1].ref)) } : { label: 'Go to Ship →', href: hrefOf('ship') };
  }
  return { label: `Go to ${STEPS[i + 1].label} →`, href: hrefOf(STEPS[i + 1].key) };
}
const part = (L, title, body, o = {}) => `<section class="part p${L} ${o.act ? 'act' : ''}" aria-labelledby="wh${L}"><header class="ph"><span class="pn">${L}</span><h3 id="wh${L}">${title}</h3><span class="ptag">${o.tag || 'Do this now'}</span><span class="sp"></span>${o.right || ''}</header><div class="pb">${body}</div></section>`;

// Builds the step header, the AI line and the page. spec:
//   A (html) "You tell me"; B (html) "I made this, please review" (put itemEl()s here); items (refs to review); noun [one, many] for the reason text;
//   ai (the AI's one line); notice [['ok'|'warn', text]]; act ('A'|'B'|'C' which part is highlighted, default: B while something is unreviewed, else C);
//   next ({label, href} or {label, act, ...} for a data-act; null = no forward button; default = the next page); gate ({ready, reason}) overrides the review rule;
//   empty (true: nothing to review yet, forward is off); title; head (html above the parts, e.g. scene tabs); right (extra html in B's header); n (step number override).
export function spine(ctx, o = {}) {
  const refs = [...new Set(o.items || [])].filter((r) => get(r)), sts = refs.map((r) => statusOf(r));
  const n = refs.length, okN = sts.filter((s) => s === 'ok').length, chg = sts.filter((s) => s === 'change').length, todo = n - okN;
  const nx = o.next === undefined ? defaultNext(ctx) : o.next, def = STEPS.find((s) => s.key === ctx.step);
  let ready, reason;
  if (o.gate) ({ ready, reason } = o.gate); else { ready = !o.empty && todo === 0; reason = gateReason({ empty: o.empty, todo, chg, noun: o.noun, n }); }
  const act = o.act || (todo > 0 ? 'B' : 'C'), approvable = refs.filter((r, i) => sts[i] !== 'ok' && get(r).status !== 'changes_requested');
  const scn = ctx.scene && sceneArts().find((s) => keyOf(s.ref) === ctx.scene), subName = (SUBS.find((u) => u[0] === ctx.sub) || [])[1];
  const prog = progressText({ n: def.n, scene: scn ? (scn.data || {}).n : null, sub: scn ? subName : '', okN, itemsN: n });
  const cnt = n ? `<span class="cnt ${todo ? 'wtodo' : 'done'}">${todo ? todo + ' to review' : 'All approved'}</span>${chg ? `<span class="cnt chg">${chg} need${chg === 1 ? 's' : ''} a change</span>` : ''}` : '';
  const right = `${cnt}${n ? `<button class="bt sm okb" data-act="w-all" data-refs="${esc(JSON.stringify(approvable))}" ${approvable.length ? '' : 'disabled'}>Approve all</button>` : ''}${o.right || ''}`;
  const notice = o.notice && o.notice.length ? `<span class="lbl">What I noticed</span><ul class="lines">${o.notice.map((c) => `<li><i class="dot ${c[0] === 'ok' ? '' : c[0]}"></i>${c[1]}</li>`).join('')}</ul>` : '';
  const btn = nx ? `<button class="bt pri big" id="wz-go" ${nx.act ? `data-act="${esc(nx.act)}"` : `data-go="${esc(nx.href || '')}"`} ${ready ? '' : 'disabled'} aria-describedby="wz-why">${nx.label}</button>` : '';
  const segs = STEPS.map((s, i) => `<i class="k-${grpOf(s)} ${i < def.n - 1 || stepDone(s.key) ? 'd' : ''} ${s.key === ctx.step ? 'c' : ''}" ${s.key === ctx.step ? `style="--f:${n ? okN / n : ready ? 1 : 0}"` : ''}></i>`).join('');
  return `<div class="band"><span class="chapbadge">0${o.n || def.n}</span><div class="bt1"><div class="prog" id="wz-prog">${esc(prog)}</div><h1>${esc(o.title || def.title)}</h1></div></div>
  <div class="segs" aria-hidden="true">${segs}</div>
  <div class="ai-says"><b>The AI</b>${o.ai || ''}</div>
  <div class="sheet"><div class="wpage">${o.head || ''}${part('A', 'You tell me', o.A || nothing(), { act: act === 'A', tag: 'Do this now' })}${part('B', 'I made this, please review', (o.B || nothing('Nothing to review yet.')) + notice, { act: act === 'B', right })}
  <section class="part pC ${act === 'C' ? 'act' : ''}" aria-labelledby="whC"><header class="ph"><span class="pn">C</span><h3 id="whC">Then</h3><span class="ptag">Ready</span></header><div class="pb then">${btn}<span class="wwhy ${ready ? 'okw' : ''}" id="wz-why">${esc(reason)}</span></div></section></div>
  <div class="margin"><div id="fxw">${marginHtml()}</div></div></div>`;
}

// ---------- the contents column ----------
function toc(ctx) {
  const prod = (st.prods || []).find((p) => p.id === st.pid) || {}, scenes = sceneArts();
  const lg = get(REFS.story), fmt = (lg && lg.data && lg.data.format) || {};
  const stb = (s) => { const todo = todoOf(s.key), done = stepDone(s.key), on = s.key === ctx.step; return `<a class="wst k-${grpOf(s)} ${on ? 'on' : ''}" href="${hrefOf(s.key)}" ${on && !ctx.scene ? 'aria-current="page"' : ''}><b class="nb">0${s.n}</b><span>${s.label}</span>${done ? '<i class="dn" aria-label="done">✓</i>' : todo ? `<i class="td" title="${todo} to review">${todo}</i>` : '<i></i>'}</a>`; };
  const scs = `<div class="scs ${ctx.step === 'scenes' ? 'here' : ''}"><a class="sc ${ctx.step === 'scenes' && !ctx.scene ? 'on' : ''}" href="${hrefOf('scenes')}">Overview</a>${scenes.map((s) => { const id = keyOf(s.ref), r = sceneReadiness(s, rctx()); return `<a class="sc ${ctx.scene === id ? 'on' : ''}" href="${hrefOf('scenes', id)}">${(s.data || {}).n} · ${esc((s.data || {}).name || id)}<span class="mini">${SUBS.map((u, i) => `<i class="k-${u[0]} ${r[i] === 2 ? 'd' : ''}"></i>`).join('')}</span></a>`; }).join('')}</div>`;
  const by = (g) => STEPS.filter((s) => s.group === g).map(stb).join('');
  return `<nav class="toc" aria-label="Contents"><div class="wbrand">Monofilm<small>${esc([prod.name, fmt.seconds ? `${fmt.seconds} s` : '', fmt.aspect].filter(Boolean).join(' · '))}</small></div>
  <div class="tocl"><h6>The whole film</h6>${by('film')}<h6>Each scene</h6>${by('scene')}${scs}<h6>The finished film</h6>${by('finish')}</div>
  <div class="legend"><h6>Colour guide</h6><div class="lgs"><span><i class="k-canon sw"></i>Whole film</span><span><i class="k-brief sw"></i>Brief</span><span><i class="k-stage sw"></i>Stage</span><span><i class="k-pictures sw"></i>Pictures</span><span><i class="k-sound sw"></i>Sound</span><span><i class="k-pack sw"></i>Pack</span></div><div class="lg2"><span class="wstc review"><b>●</b>To review</span><span class="wstc ok"><b>✓</b>Approved</span><span class="wstc change"><b>✎</b>Needs a change</span></div><div class="sm mute" style="margin-top:6px">Red pencil is always the AI and your feedback.</div></div>
  <p class="sm" style="margin:16px 0 0"><a class="lk" href="#/overview">Advanced studio →</a></p></nav>`;
}

const SPRITE = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="fig" viewBox="0 0 60 80"><circle cx="30" cy="14" r="9"/><path d="M14 78 L18 34 Q30 26 42 34 L46 78 Z"/></symbol><symbol id="arch" viewBox="0 0 60 80"><path d="M4 78 V34 Q4 8 30 4 Q56 8 56 34 V78 H44 V36 Q44 20 30 17 Q16 20 16 36 V78 Z"/></symbol><symbol id="beam" viewBox="0 0 60 80"><path d="M2 30 L58 22 L58 34 L2 42 Z M26 40 H34 V78 H26 Z"/></symbol><symbol id="crowd" viewBox="0 0 60 80"><circle cx="14" cy="30" r="6"/><circle cx="30" cy="24" r="7"/><circle cx="46" cy="30" r="6"/><path d="M4 78 L8 42 H20 L24 78 Z M22 78 L25 36 H35 L38 78 Z M36 78 L40 42 H52 L56 78 Z"/></symbol><symbol id="house" viewBox="0 0 60 80"><path d="M4 40 L30 14 L56 40 V78 H4 Z M24 78 V54 H36 V78 Z"/></symbol><symbol id="candle" viewBox="0 0 60 80"><path d="M26 30 H34 V76 H26 Z"/><path d="M30 6 Q38 18 30 28 Q22 18 30 6 Z"/></symbol></svg>'; // picture placeholders: fig arch beam crowd house candle
const placeholder = (ctx) => { const def = STEPS.find((s) => s.key === ctx.step); return spine(ctx, { A: nothing('Nothing for you to do here yet.'), B: nothing(`This page is being built. ${def.label} will appear here soon. You can still move through the contents list.`), ai: 'This page is being built.', gate: { ready: true, reason: 'This page is being built, so there is nothing to review. You can go on.' } }); };

// app.js renders this into #view when the hash is #/w...
export async function vWizard() {
  const r = readRoute(), key = [r.step, r.scene, r.sub].join('/');
  W.fresh = key !== W.routeKey; if (W.fresh) { W.sel = []; W.pending = null; } W.routeKey = key; Object.assign(W, r);
  W.sel = W.sel.filter((s) => get(s.ref)); W.keepY = W.fresh ? 0 : scrollY;
  const ctx = ctxOf(), def = REG[r.step];
  const body = def ? await def.html(ctx) : placeholder(ctx);
  const stp = STEPS.find((s) => s.key === r.step);
  document.title = `Monofilm · ${stp.label}`;
  return `<div class="wz">${SPRITE}<div class="app">${toc(ctx)}<div class="wmain k-${grpOf(stp, r.scene ? r.sub : '')}">${body}</div></div></div>`;
}
export function bindWizard(root) {
  if (!root) return;
  const ctx = ctxOf(), def = REG[W.step];
  bindFix(root);
  if (def && def.bind) def.bind(root, ctx);
  markSel(); scrollTo(0, W.keepY);
  if (W.pending) { selectFirst(W.pending); W.pending = null; } else if (W.fresh && innerWidth >= 1100) selectFirst(null);
  W.fresh = false; placeMargin();
}
