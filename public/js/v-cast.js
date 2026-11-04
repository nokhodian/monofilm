// The cast: who they are, how they must look, who voices them. One image per character is the anchor every shot must match.
import { $, esc, st, api, P, toast, tag, chip, isHuman, mediaSrc } from './core.js';
import { ofKind, get, openCount, isNew, editArtifact, createArtifact } from './data.js';
import { threadsHtml } from './feedback.js';

export function vCast() {
  const list = ofKind('canon.cast');
  if (!list.length) return '<div class="empty">No cast yet. The AI proposes characters as <code>canon.cast:&lt;name&gt;</code>.</div>';
  const refs = ofKind('reference').filter((r) => r.data.category === 'cast');
  return `<h1>Cast</h1><p class="mute">Pick one image per character as the <b>anchor</b>, then lock it: every later shot must match it. Feedback here applies to the whole film.</p>${list.map((c) => {
    const imgs = (c.assets || []).filter((a) => (a.mime || '').startsWith('image/')), mine = refs.filter((r) => r.data.for === c.data.name), anchor = c.data.anchor, ed = isHuman();
    return `<article class="cast"><div class="cimgs">${imgs.slice(0, 1).map((a) => `<img class="main" src="${esc(mediaSrc(a.uri))}" alt="" data-act="zoom" data-src="${esc(mediaSrc(a.uri))}" data-cap="${esc(c.data.name)}" data-ref="${esc(c.ref)}" loading="lazy">`).join('') || '<i></i>'}</div>
    <div class="cb"><div class="row"><h2 style="margin:0;color:var(--ink)">${esc(c.data.name)}</h2>${c.data.age ? tag(`age ${c.data.age}`) : ''}${chip(c)}${anchor ? tag('anchor set', 'add') : tag('no anchor yet', 'warn')}${isNew(c) ? '<span class="tag new">changed</span>' : ''}${openCount(c.ref) ? `<span class="tag fbk">${openCount(c.ref)} open</span>` : ''}<span class="sp"></span>${ed ? `<button class="btn sm" data-act="lock" data-ref="${esc(c.ref)}" data-lock="${c.status === 'locked' ? 0 : 1}" ${['approved', 'locked'].includes(c.status) && anchor ? '' : 'disabled'} title="Set an anchor first">${c.status === 'locked' ? 'Unlock' : 'Lock the anchor'}</button>` : ''}</div>
      <div class="mute">${esc(c.data.role || '')}</div><p>${esc(c.data.facts || '')}</p>${c.data.period_check ? `<div class="kv"><span class="mute">Period check</span> ${esc(c.data.period_check)}</div>` : ''}${c.data.voice ? `<div class="kv"><span class="mute">Voice</span> ${esc(c.data.voice)}</div>` : ''}
      <div class="thumbs big">${imgs.map((a) => { const id = a.uri.split('/').pop().replace(/^img-/, '').replace(/\.jpg$/, ''); return `<figure class="imgtile${anchor === id ? ' picked' : ''}"><img src="${esc(mediaSrc(a.uri))}" alt="" data-act="zoom" data-src="${esc(mediaSrc(a.uri))}" data-cap="${esc(c.data.name)} · ${esc(id)}" data-ref="${esc(c.ref)}" loading="lazy"><figcaption>${anchor === id ? '<b>anchor</b>' : esc(id)}</figcaption>${ed && c.status !== 'locked' && anchor !== id ? `<button class="btn sm ok" data-act="anchor" data-ref="${esc(c.ref)}" data-img="${esc(id)}">Set as anchor</button>` : ''}</figure>`; }).join('')}</div>
      ${mine.length ? `<div class="row"><span class="mute small">Your references:</span>${mine.map((r) => ((r.assets || [])[0] ? `<img class="refthumb" src="${esc(mediaSrc(r.assets[0].uri))}" alt="" data-act="zoom" data-src="${esc(mediaSrc(r.assets[0].uri))}" data-cap="${esc(r.data.title)}" data-ref="${esc(r.ref)}">` : '')).join('')}</div>` : ''}
      ${ed ? `<div class="row"><input type="file" accept="image/*" multiple data-castfiles="${esc(c.data.name)}" style="max-width:260px"><button class="btn sm" data-act="castref" data-name="${esc(c.data.name)}">Add references for ${esc(c.data.name)}</button></div>` : ''}
      ${threadsHtml(c.ref)}</div></article>`;
  }).join('')}`;
}

const shrink = (file) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { const s = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); c.toBlob(res, 'image/jpeg', .82); }; im.onerror = rej; im.src = URL.createObjectURL(file); });
export const acts = {
  async anchor(el) { await editArtifact(el.dataset.ref, (d) => { d.anchor = el.dataset.img; return d; }, `Chose ${el.dataset.img} as the anchor`); toast('Anchor set. Lock it when you are sure.'); return 'refresh'; },
  async castref(el) {
    const input = $(`[data-castfiles="${CSS.escape(el.dataset.name)}"]`), files = [...input.files]; if (!files.length) return toast('Choose one or more images first');
    const stamp = Date.now().toString(36);
    for (const [i, f] of files.entries()) {
      const name = `ref-${stamp}-${i}.jpg`, blob = await shrink(f), ref = `reference:${stamp}-${i}`;
      const r = await fetch(`/api/p/${st.pid}/media/${name}`, { method: 'PUT', headers: { authorization: 'Bearer ' + st.key, 'content-type': 'image/jpeg' }, body: blob }); if (!r.ok) throw new Error('upload failed');
      await createArtifact(ref, { category: 'cast', title: f.name, for: el.dataset.name }, { why: 'Reference added by a human' });
      await api(P('/assets'), { method: 'POST', body: { ref, uri: `media/${st.pid}/${name}`, mime: 'image/jpeg', bytes: blob.size, provenance: { uploaded_by: st.me.name } } });
    }
    toast(`${files.length} reference${files.length > 1 ? 's' : ''} added`); return 'refresh';
  },
};
