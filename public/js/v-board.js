// Review board: every candidate image and every take in one place. Compare, flag, pick the one that stays.
import { $, esc, st, api, P, toast, chip, tag, lightbox, mediaSrc, isHuman } from './core.js';
import { ofKind, get, takesOf, takeSrc, editArtifact, openCount, threads } from './data.js';
import { composer, threadsHtml } from './feedback.js';
const takeSel = (shot) => (st.tcmp && st.tcmp[shot]) || [0, 1];

const imgName = (src) => src.split('/').pop().replace(/^img-/, '').replace(/\.jpg$/, '');
const tiles = (kf) => [...(kf.assets || []).filter((x) => x.provenance && x.provenance.transport === 'meta-image').map((a) => ({ id: a.uri.split('/').pop().replace(/\.png$/, ''), src: mediaSrc(a.uri), kf: kf.ref, made: true })).reverse(), ...(kf.data.images || []).map((id) => { const a = (kf.assets || []).find((x) => x.uri.endsWith(`img-${id}.jpg`)); return a ? { id, src: mediaSrc(a.uri), kf: kf.ref } : null; }).filter(Boolean)];
const flagsOn = (ref, id) => threads(ref).filter((c) => (c.anchor || '').includes(`img:${id}`) && c.status !== 'resolved');
const cmpList = () => st.cmp || (st.cmp = []);

export function vBoard() {
  const f = st.boardF || { kind: 'all', flag: 'all' }, kfs = ofKind('keyframe').sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  const approved = kfs.filter((k) => k.data.pick).length;
  const chipRow = (key, opts) => opts.map(([v, l]) => `<button class="vd" data-act="bfilter" data-k="${key}" data-v="${v}" aria-pressed="${f[key] === v}">${l}</button>`).join('');
  const shown = kfs.filter((k) => f.flag === 'all' || (f.flag === 'nopick' ? !k.data.pick : f.flag === 'flagged' ? threads(k.ref).some((c) => ['continuity', 'anachronism', 'hold'].includes(c.verdict) && c.status !== 'resolved') : true));
  return `<h1>Review board</h1><p class="mute">Every candidate image and take. <b>Use this</b> chooses the image a shot is built from (A on a focused image), <b>Hold</b> or <b>Cut</b> flags it (H / X). A take needs an approved keyframe, and picking one makes it the take the cut plays.</p>
  <div class="card"><div class="row"><b>${approved} of ${kfs.length}</b> shots have a chosen image<span class="sp"></span>${chipRow('kind', [['all', 'Images and takes'], ['img', 'Images'], ['take', 'Takes']])}<span class="mute">·</span>${chipRow('flag', [['all', 'All'], ['nopick', 'No image chosen'], ['flagged', 'Flagged']])}</div></div>
  ${cmpPanel()}${shown.map((k) => shotBlock(k, f)).join('') || '<div class="empty">Nothing matches.</div>'}`;
}

function cmpPanel() {
  const l = cmpList();
  if (!l.length) return '<div class="callout">Press <b>Compare</b> on up to three images to judge them side by side.</div>';
  return `<div class="card"><div class="row"><h2 style="margin:0;color:var(--ink)">Compare · ${l.length} of 3</h2><span class="sp"></span><button class="btn sm" data-act="cmpclear">Clear</button></div><div class="cmpgrid">${l.map((c) => `<div><img class="cmpimg" src="${esc(c.src)}" alt="" data-act="zoom" data-src="${esc(c.src)}" data-cap="${esc(c.kf)} · ${esc(c.id)}" data-ref="${esc(c.kf)}"><b>${esc(c.kf.replace('keyframe:', ''))}</b> <span class="mute">${esc(c.id)}</span>
    ${composer(c.kf, { anchor: `img:${c.id}`, review: true, draw: false, placeholder: 'What is right or wrong with this image? (required for a risk flag)' })}</div>`).join('')}</div></div>`;
}

function cmpTakes(id, takes) {
  const [a, b] = takeSel(id).map((i) => takes[i] || takes[0]), opt = (sel) => takes.map((t, i) => `<option value="${i}" ${takes[sel] === t ? 'selected' : ''}>${esc(t.ref.slice(5))}</option>`).join('');
  return `<details class="card"><summary><b>Compare two takes side by side</b></summary><div class="row"><select data-tcmp="${esc(id)}" data-side="0">${opt(takeSel(id)[0])}</select><select data-tcmp="${esc(id)}" data-side="1">${opt(takeSel(id)[1])}</select><button class="btn sm" data-act="playboth" data-shot="${esc(id)}">Play both</button></div><div class="grid3" id="cmpv-${esc(id)}">${[a, b].map((t) => `<div class="take">${takeSrc(t) ? `<video controls preload="metadata" src="${esc(takeSrc(t))}"></video>` : '<div class="mock">no file</div>'}<div class="row">${esc(t.ref.slice(5))} ${chip(t)}</div></div>`).join('')}</div></details>`;
}
function shotBlock(kf, f) {
  const id = kf.ref.slice(9), shot = get(`shot:${id}`), t = tiles(kf), takes = takesOf(id);
  return `<section class="card bsec"><div class="row"><a href="#/shot/${esc(id)}"><b>${esc(id)} · ${esc(shot ? shot.data.title : '')}</b></a>${chip(kf)}${kf.data.pick ? tag('image chosen', 'add') : tag('no image chosen', 'warn')}${openCount(kf.ref) ? `<span class="tag fbk">${openCount(kf.ref)} open</span>` : ''}</div>
  ${f.kind !== 'take' ? `<div class="imggrid">${t.map((x) => `<figure class="imgtile${kf.data.pick === x.id ? ' picked' : ''}" tabindex="0" data-ref="${esc(kf.ref)}" data-img="${esc(x.id)}"><img src="${esc(x.src)}" alt="" loading="lazy" data-act="zoom" data-src="${esc(x.src)}" data-cap="${esc(id)} · ${esc(x.id)}" data-ref="${esc(kf.ref)}">
      <figcaption>${kf.data.pick === x.id ? '<b>chosen</b> · ' : ''}${x.made ? '<span class="tag ai">Muse Image</span> ' : ''}${esc(x.id)}${flagsOn(kf.ref, x.id).map((c) => ` <span class="tag ${c.verdict === 'hold' ? 'warn' : 'del'}">${esc(c.verdict || 'note')}</span>`).join('')}</figcaption>
      <div class="row"><button class="btn sm" data-act="cmp" data-ref="${esc(kf.ref)}" data-img="${esc(x.id)}" data-src="${esc(x.src)}">Compare</button>${isHuman() ? `<button class="btn sm ok" data-act="usepick" data-ref="${esc(kf.ref)}" data-img="${esc(x.id)}" title="A">Use this</button><button class="btn sm" data-act="quickflag" data-v="hold" data-ref="${esc(kf.ref)}" data-img="${esc(x.id)}" title="H">Hold</button><button class="btn sm no" data-act="quickflag" data-v="cut" data-ref="${esc(kf.ref)}" data-img="${esc(x.id)}" title="X">Cut</button>` : ''}</div></figure>`).join('')}</div>` : ''}
  ${f.kind !== 'img' && takes.length > 1 ? cmpTakes(id, takes) : ''}${f.kind !== 'img' && takes.length ? `<h2 style="margin:12px 0 6px">Takes</h2><div class="grid3">${takes.map((tk) => `<div class="take${tk.data.picked ? ' picked' : ''}">${takeSrc(tk) ? `<video controls preload="none" src="${esc(takeSrc(tk))}" poster="${esc(t[0] ? t[0].src : '')}"></video>` : '<div class="mock">no file</div>'}<div class="row">${esc(tk.ref.slice(5))} ${chip(tk)}${tk.data.score != null ? tag(`score ${tk.data.score}`) : ''}${tk.data.picked ? tag('in the cut', 'add') : ''}</div>
      <div class="row"><button class="btn sm" data-act="tmoment" data-ref="${esc(tk.ref)}">Comment at this moment</button><button class="btn sm" data-act="retake" data-ref="${esc(tk.ref)}">Ask for a re-take</button></div><div class="tcw" id="tw-${esc(tk.ref)}" hidden>${composer(tk.ref, { anchor: 't:', draw: false, placeholder: 'What is wrong or right at this moment?' })}</div><div class="row">${isHuman() && !tk.data.picked ? `<button class="btn sm ok" data-act="picktake" data-ref="${esc(tk.ref)}" data-shot="${esc(id)}">Use in the cut</button>` : ''}${isHuman() && tk.status === 'proposed' ? `<button class="btn sm" data-act="decide" data-do="approve" data-ref="${esc(tk.ref)}" data-v="${tk.version}">Approve</button>` : ''}</div></div>`).join('')}</div>` : ''}
  <details><summary class="mute">Feedback on this shot's images (${threads(kf.ref).length})</summary>${threadsHtml(kf.ref, { composerOpts: { review: true } })}</details></section>`;
}

const quick = async (ref, id, verdict, body) => { await api(P('/comments'), { method: 'POST', body: { ref, verdict, body, anchor: `img:${id}` } }); };
export const acts = {
  tmoment(el) { const box = document.getElementById(`tw-${el.dataset.ref}`), v = el.closest('.take').querySelector('video'), t = v ? v.currentTime : 0; if (v) v.pause(); box.hidden = false; box.querySelector('.cmp').dataset.anchor = `t:${t.toFixed(1)}`; box.querySelector('textarea').placeholder = `At ${t.toFixed(1)} s: what is wrong or right?`; box.querySelector('textarea').focus(); },
  retake(el) { const box = document.getElementById(`tw-${el.dataset.ref}`); box.hidden = false; box.querySelector('.cmp').dataset.anchor = 'retake'; box.querySelector('textarea').placeholder = 'What should the next take do differently?'; const ch = box.querySelector('.vd[data-v=change]'); if (ch) ch.setAttribute('aria-pressed', 'true'); box.querySelector('textarea').focus(); },
  playboth(el) { document.querySelectorAll(`#cmpv-${CSS.escape(el.dataset.shot)} video`).forEach((v) => { v.currentTime = 0; v.play().catch(() => {}); }); },
  bfilter: (el) => { st.boardF = { kind: 'all', flag: 'all', ...(st.boardF || {}), [el.dataset.k]: el.dataset.v }; return 'render'; },
  cmp(el) { const l = cmpList(), i = l.findIndex((c) => c.kf === el.dataset.ref && c.id === el.dataset.img); if (i >= 0) l.splice(i, 1); else if (l.length < 3) l.push({ kf: el.dataset.ref, id: el.dataset.img, src: el.dataset.src }); else toast('Compare holds three. Remove one first.'); return 'render'; },
  cmpclear: () => { st.cmp = []; return 'render'; },
  zoom: (el) => lightbox(el.dataset.src, el.dataset.cap, el.dataset.ref ? { ref: el.dataset.ref } : {}),
  async usepick(el) { await editArtifact(el.dataset.ref, (d) => { d.pick = el.dataset.img; return d; }, `Chose image ${el.dataset.img}`); toast(`Chose ${el.dataset.img}. Takes built on this shot are now stale.`); return 'refresh'; },
  async quickflag(el) {
    const verdict = el.dataset.v; let body = '';
    if (verdict === 'cut') { body = (prompt('Why cut this image? (the AI reads this)') || '').trim(); if (!body) return toast('A note is needed'); }
    await quick(el.dataset.ref, el.dataset.img, verdict, body); toast(`Flagged ${verdict}`); return 'refresh';
  },
  async picktake(el) { // exactly one take per shot is the one the cut plays
    for (const t of takesOf(el.dataset.shot)) { const want = t.ref === el.dataset.ref; if (!!t.data.picked !== want) await editArtifact(t.ref, (d) => { d.picked = want; return d; }, want ? 'Chosen for the cut' : 'Another take was chosen'); }
    toast('That take now plays in the cut'); return 'refresh';
  },
};

// A / H / X on a focused image, as on the original board
document.addEventListener('keydown', (e) => {
  const t = e.target.closest && e.target.closest('.imgtile'); if (!t || /INPUT|TEXTAREA/.test(e.target.tagName) || !isHuman()) return;
  const k = { a: 'usepick', h: 'quickflag:hold', x: 'quickflag:cut' }[e.key.toLowerCase()]; if (!k) return;
  const [act, v] = k.split(':'), b = $(`[data-act="${act}"]${v ? `[data-v="${v}"]` : ''}`, t); if (b) b.click();
});

document.addEventListener('change', (e) => { const sh = e.target.dataset && e.target.dataset.tcmp; if (!sh) return; st.tcmp = st.tcmp || {}; const cur = takeSel(sh).slice(); cur[Number(e.target.dataset.side)] = Number(e.target.value); st.tcmp[sh] = cur; document.dispatchEvent(new CustomEvent('mf-rerender')); });
