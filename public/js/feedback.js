// Feedback threads on any artifact, the composer, and the before/after diff of a revision.
import { $, esc, st, api, P, toast, ago, isHuman, mediaSrc } from './core.js';
const attSrc = (u) => mediaSrc(u);
import { threads, images, get } from './data.js';

export const VERDICTS = [['keep', 'Keep'], ['change', 'Change'], ['cut', 'Cut'], ['question', 'Question']];
export const FLAGS = [['hold', 'Hold'], ['continuity', 'Continuity risk'], ['anachronism', 'Anachronism']];
export const FAILS = [['anchor', 'Not the anchor'], ['period', 'Wrong period'], ['light', 'Lighting'], ['artifact', 'Artifacts']];
const who = (c) => `<b>${esc(c.author)}</b>${c.author_kind === 'ai' ? '<span class="tag ai">AI</span>' : ''}`;

// A picture to draw on for this artifact, or '' when it is only words (a logline has nothing to draw on).
function drawBase(ref) {
  const i = ref.indexOf(':'), k = ref.slice(0, i), id = ref.slice(i + 1);
  if (k === 'shot' || k === 'keyframe') return images(id)[0] || '';
  if (k === 'canon.cast' || k === 'reference') { const a = ((get(ref) || {}).assets || []).find((x) => (x.mime || '').startsWith('image/')); return a ? mediaSrc(a.uri) : ''; }
  return '';
}
export function composer(ref, { context = '', anchor = '', placeholder = 'Your feedback for the AI (optional with a verdict)', review = false, draw = true } = {}) {
  if (!st.me || st.me.role === 'viewer') return '';
  return `<div class="cmp" data-ref="${esc(ref)}" data-ctx="${esc(context)}" data-anchor="${esc(anchor)}">
    <div class="row">${(review ? [...VERDICTS, ...FLAGS] : VERDICTS).map(([k, l]) => `<button class="vd v-${k}" data-act="vtoggle" data-v="${k}" aria-pressed="false">${l}</button>`).join('')}</div>
    ${review ? `<div class="row"><span class="mute small">Looks wrong:</span>${FAILS.map(([k, l]) => `<button class="vd v-fail" data-act="ftoggle" data-f="${k}" aria-pressed="false">${l}</button>`).join('')}</div>` : ''}
    <textarea placeholder="${esc(placeholder)}"></textarea><div class="row"><button class="btn pri sm" data-act="send">Send feedback</button>${st.meta && st.meta.configured ? '<button class="btn sm" data-act="mic" title="Speak your feedback (Muse Voice Transcribe)">Speak</button>' : ''}${draw && drawBase(ref) ? `<button class="btn sm" data-act="markup" data-ref="${esc(ref)}" data-ctx="${esc(context)}" data-mode="sketch" data-base="${esc(drawBase(ref))}" title="Draw on the picture and send it with your note">Draw on the image</button>` : ''}</div></div>`;
}
const failsOf = (a) => ((/fails:([a-z,]+)/.exec(a || '') || [])[1] || '').split(',').filter(Boolean);

export function threadHtml(c) {
  const human = isHuman();
  return `<div class="th th-${c.status}" id="th-${esc(c.id)}">
    <div class="th-h">${who(c)}${c.verdict ? `<span class="vd v-${esc(c.verdict)} on">${esc(c.verdict)}</span>` : ''}<span class="mute">${ago(c.created)} · v${c.version}${c.context ? ` · in ${esc(c.context)}` : ''}${c.anchor ? ` · ${esc(c.anchor)}` : ''}</span><span class="sp"></span><span class="st s-th-${c.status}">${c.status === 'addressed' ? `answered in v${c.addressed_in}` : c.status}</span></div>
    ${c.body ? `<p class="body">${esc(c.body)}</p>` : ''}${failsOf(c.anchor).length ? `<div class="row">${failsOf(c.anchor).map((k) => `<span class="tag del">${esc((FAILS.find((x) => x[0] === k) || [0, k])[1])}</span>`).join('')}</div>` : ''}${c.attachment ? `<div class="mute small">Drawing by ${esc(c.author)}</div><img class="att" src="${esc(attSrc(c.attachment))}" alt="drawing" data-act="zoom" data-src="${esc(attSrc(c.attachment))}" data-cap="Drawing by ${esc(c.author)}">` : ''}
    ${c.replies.map((r) => `<div class="rp">${who(r)} <span class="mute">${ago(r.created)}</span><p class="body">${esc(r.body)}</p></div>`).join('')}
    ${c.status === 'addressed' && c.addressed_in ? `<div class="row"><button class="btn sm" data-act="showdiff" data-ref="${esc(c.ref)}" data-v="${c.addressed_in}" data-into="df-${esc(c.id)}">What changed in v${c.addressed_in}</button></div><div id="df-${esc(c.id)}"></div>` : ''}
    <div class="row">${st.me.role !== 'viewer' ? `<button class="btn sm" data-act="replytoggle" data-id="${esc(c.id)}">Reply</button>` : ''}${human && c.status !== 'resolved' ? `<button class="btn sm ok" data-act="resolve" data-id="${esc(c.id)}">Resolve</button>` : ''}${human && c.status === 'resolved' ? `<button class="btn sm" data-act="reopen" data-id="${esc(c.id)}">Reopen</button>` : ''}</div>
    <div class="rpl" id="rpl-${esc(c.id)}" hidden><textarea placeholder="Reply${c.status === 'addressed' ? ' (replying reopens it)' : ''}"></textarea><button class="btn pri sm" data-act="reply" data-id="${esc(c.id)}" data-ref="${esc(c.ref)}">Send</button></div></div>`;
}
export function threadsHtml(ref, { composerOpts, hideResolved = true } = {}) {
  const all = threads(ref), open = all.filter((c) => c.status !== 'resolved'), done = all.filter((c) => c.status === 'resolved');
  return `<div class="fb">${open.map(threadHtml).join('')}${done.length ? `<details><summary class="mute">${done.length} resolved</summary>${done.map(threadHtml).join('')}</details>` : ''}${composer(ref, composerOpts)}</div>`;
}

// ---- diff ----
const flat = (v, p = '', o = {}) => { if (v && typeof v === 'object') for (const k of Object.keys(v)) flat(v[k], p ? `${p}.${k}` : k, o); else o[p] = v; return o; };
const show = (v) => (v === undefined ? '<i>(none)</i>' : esc(typeof v === 'string' ? v : JSON.stringify(v)));
export function diffHtml(a, b) {
  const rows = [];
  if (Array.isArray(a?.order) && Array.isArray(b?.order)) { // a cut: show the sequence, not raw JSON
    const A = a.order.map((o) => o.id), B = b.order.map((o) => o.id), secA = Object.fromEntries(a.order.map((o) => [o.id, o.seconds])), secB = Object.fromEntries(b.order.map((o) => [o.id, o.seconds]));
    rows.push(`<tr><td>order</td><td>${A.map((i) => `<span class="tag ${B.includes(i) ? '' : 'del'}">${esc(i)}</span>`).join('')}</td><td>${B.map((i) => `<span class="tag ${A.includes(i) ? (A.indexOf(i) === B.indexOf(i) ? '' : 'mov') : 'add'}">${esc(i)}${secA[i] !== undefined && secA[i] !== secB[i] ? ` ${secA[i]}→${secB[i]}s` : ''}</span>`).join('')}</td></tr>`);
    a = { ...a, order: undefined }; b = { ...b, order: undefined };
  }
  const fa = flat(a || {}), fb = flat(b || {});
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) if (JSON.stringify(fa[k]) !== JSON.stringify(fb[k]) && !(fa[k] === undefined && fb[k] === undefined)) rows.push(`<tr><td>${esc(k)}</td><td class="del">${show(fa[k])}</td><td class="add">${show(fb[k])}</td></tr>`);
  return rows.length ? `<table class="diff"><tr><th></th><th>Before</th><th>After</th></tr>${rows.join('')}</table>` : '<p class="mute">No change to the content (only notes or metadata).</p>';
}
export async function versionDiff(ref, v) {
  const a = await api(P('/artifacts/' + encodeURIComponent(ref))), to = a.versions.find((x) => x.version === v), from = a.versions.find((x) => x.version === v - 1);
  if (!to) return '<p class="mute">That version is gone.</p>';
  return `<div class="why">${esc(to.author)} · ${ago(to.ts)}${to.rationale ? ` — ${esc(to.rationale)}` : ''}</div>${from ? diffHtml(from.data, to.data) : '<p class="mute">First version.</p>'}`;
}

// ---- actions ----
async function post(path, body) { return api(P(path), { method: 'POST', body }); }
export const acts = {
  ftoggle: (el) => el.setAttribute('aria-pressed', String(el.getAttribute('aria-pressed') !== 'true')),
  vtoggle: (el) => { const on = el.getAttribute('aria-pressed') !== 'true'; el.parentElement.querySelectorAll('.vd[data-act=vtoggle]').forEach((b) => b.setAttribute('aria-pressed', 'false')); el.setAttribute('aria-pressed', String(on)); },
  async send(el) {
    const box = el.closest('.cmp'), vd = box.querySelector('.vd[data-act=vtoggle][aria-pressed=true]'), body = box.querySelector('textarea').value.trim();
    const fails = [...box.querySelectorAll('.vd[data-act=ftoggle][aria-pressed=true]')].map((b) => b.dataset.f), anchor = [box.dataset.anchor, fails.length ? `fails:${fails.join(',')}` : ''].filter(Boolean).join(';');
    if (!body && !vd && !fails.length) return toast('Write something or pick a verdict');
    if (vd && ['continuity', 'anachronism'].includes(vd.dataset.v) && !body) return toast('A risk flag needs a note saying what is wrong');
    const made = await post('/comments', { ref: box.dataset.ref, body, verdict: vd ? vd.dataset.v : undefined, context: box.dataset.ctx || undefined, anchor: anchor || undefined }); st.flash = made.id;
    toast('Saved. The AI will see this through MCP.'); return 'refresh';
  },
  replytoggle: (el) => { const b = $(`#rpl-${CSS.escape(el.dataset.id)}`); b.hidden = !b.hidden; if (!b.hidden) b.querySelector('textarea').focus(); },
  async reply(el) { const t = el.previousElementSibling.value.trim(); if (!t) return toast('Write a reply first'); await post('/comments', { ref: el.dataset.ref, body: t, parent: el.dataset.id }); return 'refresh'; },
  async resolve(el) { await post(`/comments/${el.dataset.id}`, { resolved: true }); return 'refresh'; },
  async reopen(el) { await post(`/comments/${el.dataset.id}`, { resolved: false }); return 'refresh'; },
  async showdiff(el) { const t = $(`#${CSS.escape(el.dataset.into)}`); t.innerHTML = 'Loading…'; t.innerHTML = await versionDiff(el.dataset.ref, Number(el.dataset.v)); },
};
