// Storylines: the grid, the cut viewer with a player, beat-by-beat feedback, and a cut editor for the human's own changes.
import { $, $$, esc, st, api, P, toast, secs, chip, tag, lightbox, copyText, saveText, mediaSrc, isHuman } from './core.js';
import { ofKind, threads, cuts, get, lines, thumb, clip, openCount, isNew, mine, shots, checkCtx, createArtifact, editArtifact, episodeRef } from './data.js';
import { checkCut } from './checks.js';
import { edl, otio, ffmpegList, voScript, reviewDoc, HANDOFF } from './export.js';
import { threadsHtml, composer } from './feedback.js';

const tones = (c) => (c.data.tone || []).map((t) => tag(t)).join('');
const total = (order) => order.reduce((a, o) => a + (Number(o.seconds) || 0), 0);
const orderOf = (cut) => (st.draft && st.draft.id === cut.ref ? st.draft.order : cut.data.order || []);

export function vCuts() {
  const list = cuts();
  if (!list.length) return '<div class="empty">No storylines yet. The AI proposes them as <code>cut:&lt;name&gt;</code>.</div>';
  return `<h1>Storylines</h1><p class="mute">Each one is a complete cut. Open one to watch it, react beat by beat, or change it yourself.</p><div class="sgrid">${list.map((c) => {
    const o = c.data.order || [], tiles = [...new Set(o.map((x) => x.id))].slice(0, 4).map((i) => thumb(i));
    return `<a class="scard" href="#/cut/${esc(c.ref.slice(4))}"><div class="mos">${tiles.map((t) => (t ? `<img src="${esc(t)}" alt="" loading="lazy">` : '<i></i>')).join('')}</div>
      <div class="sb"><div class="row"><b>${esc(c.data.name || c.ref)}</b>${c.data.recommended ? '<span class="tag star">recommended</span>' : ''}${isNew(c) ? '<span class="tag new">changed</span>' : ''}${openCount(c.ref) ? `<span class="tag fbk">${openCount(c.ref)} open</span>` : ''}</div>
      <div class="mute">${esc(c.data.tag || '')}</div><p class="clamp">${esc(c.data.logline || '')}</p><div class="row">${tones(c)}</div>
      <div class="mute">${new Set(o.map((x) => x.id)).size} shots · ${secs(total(o))}${c.data.target_seconds ? ` of ${c.data.target_seconds}s` : ''} ${chip(c)}</div></div></a>`;
  }).join('')}</div>`;
}

function beat(c, o, i, edit, n) {
  const s = get(`shot:${o.id}`), D = s ? s.data : { title: o.id }, ls = lines(o.id), img = thumb(o.id);
  return `<article class="beat" id="beat-${i}" data-i="${i}">
    <div class="bn">${i + 1}</div>
    <div class="bimg">${img ? `<img src="${esc(img)}" alt="" data-act="zoom" data-src="${esc(img)}" data-cap="${esc(D.title || o.id)}" data-ref="shot:${esc(o.id)}" data-ctx="${esc(c.ref)}" loading="lazy">` : '<i></i>'}<button class="btn sm" data-act="playat" data-i="${i}">▶ Play</button></div>
    <div class="bm"><div class="row"><a href="#/shot/${esc(o.id)}"><b>${esc(o.id)} · ${esc(D.title || '')}</b></a>${s && s.stale ? '<span class="st s-stale">stale</span>' : ''}${s && isNew(s) ? '<span class="tag new">changed</span>' : ''}${D.board_status && D.board_status !== 'source' ? tag(D.board_status, 'warn') : ''}${(D.mood || []).map((m) => tag(m)).join('')}</div>
      ${ls.map((l) => `<div class="dl"><b>${esc(l.data.speaker || l.data.role)}</b> ${esc(l.data.de || '')}${l.data.en ? `<span class="mute"> — ${esc(l.data.en)}</span>` : ''}${l.assets && l.assets[0] ? ` <audio controls preload="none" src="${esc(l.assets[0].uri.startsWith('audio/') ? '/' + l.assets[0].uri : '')}"></audio>` : ''}</div>`).join('')}
      <div class="mute small">${D.sound ? `Sound: ${esc(D.sound)}` : ''}${D.camera ? ` · Camera: ${esc(D.camera)}` : ''}</div>${D.note ? `<div class="small">${esc(D.note)}</div>` : ''}
      ${threadsHtml(`shot:${o.id}`, { composerOpts: { context: c.ref, placeholder: `Feedback on beat ${i + 1} in this storyline…` } })}</div>
    <div class="bc">${edit ? `<div class="stack"><button class="btn sm" data-act="mv" data-i="${i}" data-d="-1" ${i ? '' : 'disabled'}>▲</button><button class="btn sm" data-act="mv" data-i="${i}" data-d="1" ${i < n - 1 ? '' : 'disabled'}>▼</button></div>` : ''}
      <div class="secs">${edit ? `<button class="btn sm" data-act="sec" data-i="${i}" data-d="-0.5">−</button>` : ''}<b>${secs(o.seconds)}</b>${edit ? `<button class="btn sm" data-act="sec" data-i="${i}" data-d="0.5">+</button>` : ''}</div>
      ${edit ? `<button class="btn sm no" data-act="rm" data-i="${i}" title="Take this shot out of the cut">✕</button>` : ''}</div></article>`;
  }

export function vCut(id) {
  const c = get(`cut:${id}`);
  if (!c) return '<div class="empty">No such storyline. <a href="#/cuts">Back to storylines</a></div>';
  const edit = st.me && st.me.role !== 'viewer', order = orderOf(c), sum = total(order), inCut = new Set(order.map((o) => o.id));
  const pool = shots().filter((s) => !inCut.has(s.ref.slice(5))).sort((a, b) => a.data.title.localeCompare(b.data.title));
  return `<p><a href="#/cuts">← Storylines</a></p>
  <div class="row"><h1>${esc(c.data.name || c.ref)}</h1>${c.data.recommended ? '<span class="tag star">recommended</span>' : ''}${chip(c)}<span class="mute">v${c.version} · ${esc(c.author)}${mine(c) ? ' (you)' : ''}</span></div>
  <div class="mute">${esc(c.data.tag || '')}${c.data.source ? ` · source: ${esc(c.data.source)}` : ''}</div><p class="lead">${esc(c.data.logline || '')}</p><div class="row">${tones(c)}</div>
  <div class="player"><video id="pv" controls playsinline preload="none"></video><div id="grain" class="grain"></div><div id="cap" class="cap"></div>${bedSrc() ? `<audio id="bed" loop src="${esc(bedSrc())}"></audio>` : ''}</div>
  <div class="row"><button class="btn pri" data-act="playcut">▶ Play the cut</button><button class="btn sm" data-act="pstep" data-d="-1">⏮</button><button class="btn sm" data-act="pstep" data-d="1">⏭</button><label class="chk"><input type="checkbox" id="vo"> play the voice lines too</label><span class="sp"></span><span class="mute small" id="tnow">0.0 s</span><button class="btn sm" data-act="tcut">Comment at this moment</button>${ofKind('captions').length ? `<select id="capsel" aria-label="Captions"><option value="">no captions</option>${ofKind('captions').map((x) => `<option value="${esc(x.ref.slice(9))}">${esc(x.data.language || x.ref)}</option>`).join('')}</select>` : ''}<b>${secs(sum)}</b><span class="mute">${c.data.target_seconds ? `of ${c.data.target_seconds}s target` : ''}</span></div>
  <div id="tcw" hidden>${composer(c.ref, { anchor: 't:', draw: false, placeholder: 'What is wrong or right at this moment?' })}</div>
  <div class="tl" id="tl">${order.map((o, i) => `<button style="flex:${o.seconds || 1}" data-act="playat" data-i="${i}" title="${esc(o.id)} · ${secs(o.seconds)}">${thumb(o.id) ? `<img src="${esc(thumb(o.id))}" alt="">` : ''}<span>${i + 1}</span></button>`).join('')}</div>
  ${gradePanel(c)}${checksPanel(c, order)}${exportPanel(c)}
  ${momentMarks(c, sum)}<h2>Feedback on the storyline</h2>${threadsHtml(c.ref, { composerOpts: { placeholder: 'What works, what does not, what is missing in this storyline as a whole…' } })}
  <h2>Beats</h2>${order.map((o, i) => beat(c, o, i, edit, order.length)).join('') || '<div class="empty">This cut has no shots.</div>'}
  ${edit ? `<div class="add"><select id="addshot"><option value="">Add a shot to this cut…</option>${pool.map((s) => `<option value="${esc(s.ref.slice(5))}">${esc(s.ref.slice(5))} · ${esc(s.data.title)}</option>`).join('')}</select><button class="btn sm" data-act="add">Add at the end</button></div>` : ''}
  ${st.draft && st.draft.id === c.ref ? editorBar(c) : ''}`;
}

const LOOKS = { Neutral: '', 'Candle warm': 'sepia(.5) saturate(1.2) brightness(.95)', 'Cold noir': 'grayscale(.7) contrast(1.25) brightness(.85)', 'Muted film': 'saturate(.7) contrast(1.05)' };
const GR0 = { look: 'Neutral', grain: 20, lift: 0, mix: { d: 80, a: 50, m: 40 } };
const bedSrc = () => { const e = get(episodeRef()); const a = e && (e.assets || []).find((x) => (x.mime || '').startsWith('audio/') && x.uri.includes('music')); return a ? mediaSrc(a.uri) : ''; };
const gradeOf = (id) => (st.gdraft && st.gdraft.id === id ? st.gdraft : { id, ...GR0, mix: { ...GR0.mix }, ...((get(`grade:${id}`) || {}).data || {}) });
function gradePanel(c) {
  const id = c.ref.slice(4), g = gradeOf(id), edit = isHuman();
  const sl = (k, label, min, max, v) => `<label class="k">${label} <b id="gv-${k}">${v}</b></label><input type="range" data-g="${k}" min="${min}" max="${max}" value="${v}" ${edit ? '' : 'disabled'}>`;
  return `<h2>Grade and mix</h2><div class="card"><p class="mute small">Moves live on the player above. Save it as the storyline's look; the AI and the editor use these numbers.</p><div class="row">${Object.keys(LOOKS).map((k) => `<button class="vd" data-act="glook" data-v="${k}" aria-pressed="${g.look === k}" ${edit ? '' : 'disabled'}>${k}</button>`).join('')}</div>
  <div class="gr3">${sl('grain', 'Grain', 0, 60, g.grain)}${sl('lift', 'Lift', -20, 20, g.lift)}${sl('md', 'Dialogue', 0, 100, g.mix.d)}${sl('ma', 'Ambience', 0, 100, g.mix.a)}${sl('mm', 'Music', 0, 100, g.mix.m)}</div>
  <p class="note small" id="gwarn" style="color:var(--warn)">${g.mix.d < g.mix.a || g.mix.d < g.mix.m ? 'Dialogue is quieter than another group. Raise it so lines stay clear.' : ''}</p>${edit ? `<button class="btn pri sm" data-act="savegrade">Save this grade</button>${get(`grade:${id}`) ? `<span class="mute small"> saved v${get(`grade:${id}`).version} by ${esc(get(`grade:${id}`).author)}</span>` : ''}` : ''}</div>`;
}
function checksPanel(c, order) {
  const r = checkCut({ ...c.data, order }, checkCtx());
  return `<h2>Checks <span class="mute">· ${r.filter((x) => x.lvl !== 'ok').length} to look at</span></h2><div class="card"><ul class="chks">${r.map((x) => `<li class="${x.lvl}">${esc(x.txt)}</li>`).join('')}</ul></div>`;
}
function exportPanel(c) {
  return `<h2>Share and hand off</h2><div class="card"><div class="row"><button class="btn sm" data-act="copylink">Copy link</button><button class="btn sm" data-act="exp" data-v="review">Download review (Markdown)</button><button class="btn sm" data-act="exp" data-v="vo">Voice-over script</button><button class="btn sm" data-act="exp" data-v="edl">EDL</button><button class="btn sm" data-act="exp" data-v="otio">OTIO</button><button class="btn sm" data-act="exp" data-v="ffmpeg">ffmpeg list</button></div>
  <details><summary class="mute">How to continue in another tool</summary>${HANDOFF.map(([n, t]) => `<div class="kv"><b>${esc(n)}</b> <span class="mute">${esc(t)}</span></div>`).join('')}</details></div>`;
}
function momentMarks(c, sum) {
  const ms = threads(c.ref).map((t) => ({ t, at: Number((/^t:([\d.]+)/.exec(t.anchor || '') || [])[1]) })).filter((x) => !Number.isNaN(x.at) && x.t.status !== 'resolved');
  return ms.length ? `<h2>Comments on moments</h2><div class="row">${ms.map((x) => `<button class="btn sm" data-act="tseek" data-t="${x.at}" title="${esc(x.t.body)}">${x.at.toFixed(1)} s · ${esc((x.t.body || x.t.verdict || '').slice(0, 40))}</button>`).join('')}</div>` : '';
}
function editorBar(c) {
  const a = (c.data.order || []).map((o) => o.id), b = st.draft.order.map((o) => o.id);
  const rm = a.filter((i) => !b.includes(i)).length, ad = b.filter((i) => !a.includes(i)).length, mv = b.filter((i) => a.includes(i) && a.indexOf(i) !== b.indexOf(i)).length;
  const ln = st.draft.order.filter((o) => (c.data.order.find((x) => x.id === o.id) || {}).seconds !== o.seconds && a.includes(o.id)).length;
  return `<div class="ebar"><b>Your edit</b> <span class="mute">${[rm && `${rm} removed`, ad && `${ad} added`, mv && `${mv} moved`, ln && `${ln} retimed`].filter(Boolean).join(' · ') || 'no change yet'}</span>
    <input id="enote" placeholder="Why? The AI reads this (optional)"><button class="btn pri" data-act="savecut">Save my version</button><button class="btn" data-act="discard">Discard</button></div>`;
}

// ---- player ----
let ctl = null;
export function bind(id) {
  const pv = $('#pv'), c = get(`cut:${id}`); if (!pv || !c) return;
  let voice = [];
  const mark = (i) => { $$('#tl button').forEach((b, k) => b.classList.toggle('now', k === i)); $$('.beat').forEach((b, k) => b.classList.toggle('now', k === i)); if (i >= 0) $(`#beat-${i}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  const play = (i, off = 0) => {
    const order = orderOf(c); voice.forEach((a) => a.pause()); voice = [];
    if (i < 0 || i >= order.length) { st.play = null; mark(-1); $('#cap').textContent = ''; const bed = $('#bed'); if (bed) bed.pause(); return; }
    const o = order[i], src = clip(o.id); st.play = { i };
    if (!src) { toast(`No clip for ${o.id}`); return play(i + 1); }
    pv.src = src; if (off) pv.addEventListener('loadedmetadata', () => { pv.currentTime = off; }, { once: true }); pv.play().catch(() => {}); mark(i); const bed = $('#bed'); if (bed && i === 0) { bed.currentTime = 0; bed.play().catch(() => {}); }
    const ls = lines(o.id); if (!($('#capsel') || {}).value) $('#cap').innerHTML = ls.map((l) => `<b>${esc(l.data.speaker || l.data.role)}</b> ${esc(l.data.en || l.data.de || '')}`).join('<br>');
    if ($('#vo')?.checked) { voice = ls.filter((l) => l.assets && l.assets[0]).map((l) => new Audio(l.assets[0].uri.startsWith('audio/') ? '/' + l.assets[0].uri : '')); voice.forEach((a, k) => { a.onended = () => voice[k + 1] && voice[k + 1].play(); }); voice[0] && voice[0].play().catch(() => {}); }
  };
  const look = () => { const g = gradeOf(id); pv.style.filter = `${LOOKS[g.look] || ''} brightness(${1 + g.lift / 100})`.trim(); const gr = $('#grain'); if (gr) gr.style.opacity = String(g.grain / 140); const bed = $('#bed'); if (bed) bed.volume = Math.min(1, g.mix.m / 100 * .6); voice.forEach((a) => { a.volume = g.mix.d / 100; }); };
  look(); ctl = { look };
  const cutTime = () => { if (!st.play) return 0; const o = orderOf(c); let at = 0; for (let k = 0; k < st.play.i; k++) at += o[k].seconds; return at + (pv.currentTime || 0); };
  const capNow = () => { const sel = $('#capsel'), n = $('#tnow'); if (n) n.textContent = `${cutTime().toFixed(1)} s`; if (!sel || !sel.value) return; const cap = get(`captions:${sel.value}`), t = cutTime(), cue = cap && (cap.data.cues || []).find((x) => t >= x.start && t < x.end); $('#cap').textContent = cue ? cue.text : ''; };
  pv.ontimeupdate = () => { if (st.play && pv.currentTime >= (orderOf(c)[st.play.i].seconds || 99)) play(st.play.i + 1); capNow(); };
  pv.onended = () => st.play && play(st.play.i + 1);
  const seek = (t) => { const o = orderOf(c); let at = 0; for (let k = 0; k < o.length; k++) { if (t < at + o[k].seconds) return play(k, t - at); at += o[k].seconds; } }; ctl = { ...ctl, play, seek, time: cutTime, order: () => orderOf(c) }; look();
}

// ---- edits (kept in memory until saved) ----
function draft(cutRef) { if (!st.draft || st.draft.id !== cutRef) st.draft = { id: cutRef, order: get(cutRef).data.order.map((o) => ({ ...o })) }; return st.draft.order; }
const cutRef = () => `cut:${location.hash.split('/')[2]}`;
document.addEventListener('input', (e) => {
  const k = e.target.dataset && e.target.dataset.g; if (!k) return; const id = location.hash.split('/')[2], g = gradeOf(id), v = Number(e.target.value);
  st.gdraft = { ...g, mix: { ...g.mix }, id }; if (k === 'md') st.gdraft.mix.d = v; else if (k === 'ma') st.gdraft.mix.a = v; else if (k === 'mm') st.gdraft.mix.m = v; else st.gdraft[k] = v;
  const lab = $(`#gv-${k}`); if (lab) lab.textContent = v; const w = $('#gwarn'); if (w) w.textContent = st.gdraft.mix.d < st.gdraft.mix.a || st.gdraft.mix.d < st.gdraft.mix.m ? 'Dialogue is quieter than another group. Raise it so lines stay clear.' : ''; if (ctl && ctl.look) ctl.look();
});
const cutNow = () => { const c = get(cutRef()); return { c, order: orderOf(c), ctx: checkCtx() }; };
export const acts = {
  playcut: () => ctl && ctl.play(0),
  playat: (el) => ctl && ctl.play(Number(el.dataset.i)),
  pstep: (el) => ctl && ctl.play((st.play ? st.play.i : -1) + Number(el.dataset.d)),
  mv(el) { const o = draft(cutRef()), i = Number(el.dataset.i), j = i + Number(el.dataset.d); if (o[j]) [o[i], o[j]] = [o[j], o[i]]; return 'render'; },
  sec(el) { const o = draft(cutRef()), r = o[Number(el.dataset.i)]; r.seconds = Math.max(0.5, Math.round((r.seconds + Number(el.dataset.d)) * 10) / 10); return 'render'; },
  rm(el) { draft(cutRef()).splice(Number(el.dataset.i), 1); return 'render'; },
  add() { const v = $('#addshot').value; if (!v) return toast('Pick a shot first'); draft(cutRef()).push({ id: v, seconds: get(`shot:${v}`).data.seconds || 4 }); return 'render'; },
  tcut() { const box = $('#tcw'), pv = $('#pv'), t = ctl && ctl.time ? ctl.time() : 0; if (pv) pv.pause(); box.hidden = false; box.querySelector('.cmp').dataset.anchor = `t:${t.toFixed(1)}`; box.querySelector('textarea').placeholder = `At ${t.toFixed(1)} s: what is wrong or right?`; box.querySelector('textarea').focus(); },
  tseek: (el) => ctl && ctl.seek && ctl.seek(Number(el.dataset.t)),
  glook(el) { st.gdraft = { ...gradeOf(location.hash.split('/')[2]), look: el.dataset.v }; return 'render'; },
  async savegrade() { const id = location.hash.split('/')[2], g = gradeOf(id), data = { look: g.look, grain: g.grain, lift: g.lift, mix: g.mix }; if (get(`grade:${id}`)) await editArtifact(`grade:${id}`, () => data, 'Set the grade and mix'); else await createArtifact(`grade:${id}`, data, { parent: episodeRef(), why: 'Set the grade and mix' }); st.gdraft = null; toast('Grade saved. The AI will see it.'); return 'refresh'; },
  copylink: () => copyText(location.href, 'Link copied'),
  exp(el) { const { c, order } = cutNow(), n = c.ref.slice(4), v = el.dataset.v;
    if (v === 'review') saveText(`${n}-review.md`, reviewDoc(c, order, checkCut({ ...c.data, order }, checkCtx())), 'text/markdown');
    else if (v === 'vo') saveText(`${n}-voice-over.txt`, voScript(c, order)); else if (v === 'edl') saveText(`${n}.edl`, edl(c, order)); else if (v === 'otio') saveText(`${n}.otio`, otio(c, order), 'application/json'); else if (v === 'ffmpeg') saveText(`${n}-cut.txt`, ffmpegList(order));
    toast('Downloaded'); },
  discard() { st.draft = null; return 'render'; },
  async savecut() {
    const c = get(cutRef()), order = st.draft.order; if (!order.length) return toast('A cut needs at least one shot');
    await api(P('/propose'), { method: 'POST', body: { ref: c.ref, data: { ...c.data, order, total_seconds: Math.round(total(order) * 10) / 10 }, parent: c.parent, deps: [...new Set(order.map((o) => `shot:${o.id}`))], auto_approve: true, rationale: $('#enote').value.trim() || 'Edited in the cut editor' } });
    st.draft = null; toast('Saved as your version. The AI will see the change.'); return 'refresh';
  },
};
