// Shots grouped by scene, and one shot's page: pictures, clip, dialogue, your edits and feedback.
import { $, esc, st, api, P, toast, secs, chip, tag, lightbox, copyText, miniHtml, isHuman, mediaSrc } from './core.js';
import { shots, get, lines, images, thumb, clip, cutsWith, openCount, isNew, ofKind, takesOf, editArtifact } from './data.js';
import { threadsHtml } from './feedback.js';
import { composePrompt } from './stage-math.js';
import { metaCard } from './v-meta.js';

export function vShots() {
  const all = shots(), q = (st.shotQ || '').toLowerCase(), only = st.shotOnly;
  const slots = [...new Set(ofKind('scene').map((s) => s.ref.slice(6)))].filter((s) => all.some((x) => x.parent === `scene:${s}`));
  const keep = (s) => (!q || `${s.ref} ${s.data.title}`.toLowerCase().includes(q)) && (!only || openCount(s.ref) || s.stale || isNew(s));
  return `<h1>Shots</h1><p class="mute">${all.length} shots across ${slots.length} scenes. Click one to see everything about it and react.</p>
  <div class="row"><input id="shotq" placeholder="Filter by name or id" value="${esc(st.shotQ || '')}" style="max-width:260px"><label class="chk"><input type="checkbox" id="shoton" ${only ? 'checked' : ''}> only ones with feedback, changes or stale</label></div>
  ${slots.map((sl) => {
    const list = all.filter((s) => s.parent === `scene:${sl}` && keep(s)); if (!list.length) return '';
    return `<h2>${esc(sl.toUpperCase())} <span class="mute">· ${list.length}</span></h2><div class="shgrid">${list.map((s) => `<a class="shcard" href="#/shot/${esc(s.ref.slice(5))}">${thumb(s.ref.slice(5)) ? `<img src="${esc(thumb(s.ref.slice(5)))}" alt="" loading="lazy">` : '<i></i>'}<div class="shb"><b>${esc(s.ref.slice(5))}</b> ${esc(s.data.title)}<div class="row">${s.stale ? '<span class="st s-stale">stale</span>' : ''}${isNew(s) ? '<span class="tag new">changed</span>' : ''}${openCount(s.ref) ? `<span class="tag fbk">${openCount(s.ref)} open</span>` : ''}${clip(s.ref.slice(5)) ? tag('clip') : ''}${lines(s.ref.slice(5)).length ? tag(`${lines(s.ref.slice(5)).length} lines`) : ''}</div></div></a>`).join('')}</div>`;
  }).join('')}`;
}

export function vShot(id) {
  const s = get(`shot:${id}`);
  if (!s) return '<div class="empty">No such shot. <a href="#/shots">Back to shots</a></div>';
  const D = s.data, imgs = images(id), src = clip(id), ls = lines(id), canEdit = st.me && st.me.role !== 'viewer', ed = st.shotEdit === id;
  const field = (k, label, area) => (ed ? `<label class="k">${label}</label>${area ? `<textarea data-f="${k}">${esc(D[k] || '')}</textarea>` : `<input data-f="${k}" value="${esc(D[k] ?? '')}">`}` : D[k] ? `<div class="kv"><span class="mute">${label}</span> ${esc(D[k])}</div>` : '');
  return `<p><a href="#/shots">← Shots</a></p><div class="row"><h1>${esc(id)} · ${esc(D.title || '')}</h1>${chip(s)}<span class="mute">v${s.version} · ${esc(s.author)}</span>${D.board_status ? tag(`board: ${D.board_status}`, D.board_status === 'source' ? '' : 'warn') : ''}</div>
  <div class="mute">${esc((s.parent || '').replace('scene:', 'scene '))}${(D.mood || []).length ? ` · ${(D.mood || []).map(esc).join(', ')}` : ''}${D.spoiler_level ? ` · spoiler level ${D.spoiler_level}` : ''}</div>
  <div class="two"><div>${src ? `<video class="pv2" controls playsinline preload="metadata" src="${esc(src)}" poster="${esc(imgs[0] || '')}"></video>` : '<div class="empty">No clip yet.</div>'}
    <div class="thumbs">${imgs.map((u, i) => `<img src="${esc(u)}" alt="" data-act="zoom" data-src="${esc(u)}" data-cap="${esc(id)} · image ${i + 1}" data-ref="${esc(s.ref)}" loading="lazy">`).join('')}</div></div>
  <div>${ed ? '<div class="why">Editing. Saving makes this your version and flags the keyframe, clip and dialogue built on it as stale for the AI to redo.</div>' : ''}
    ${field('title', 'Title')}${spec(D, ed)}${field('note', 'Direction note', true)}${field('camera', 'Camera and movement', true)}${field('blocking', 'Blocking (who stands where)', true)}${field('performance', 'Performance (emotion and delivery)', true)}${field('sound', 'Sound', true)}${field('seconds', 'Length (seconds)')}
    ${canEdit ? (ed ? `<input data-f="_why" placeholder="Why? The AI reads this (optional)"><div class="row"><button class="btn pri" data-act="saveshot" data-id="${esc(id)}">Save my version</button><button class="btn" data-act="editshot" data-id="">Cancel</button></div>` : `<button class="btn sm" data-act="editshot" data-id="${esc(id)}">Edit this shot</button>`) : ''}
    <div class="row" style="margin-top:10px"><button class="btn sm" data-act="copylink">Copy link</button>${s.version > 1 ? `<button class="btn sm" data-act="history" data-ref="${esc(s.ref)}">Version history</button>` : ''}<span class="mute">In storylines:</span>${cutsWith(id).map((c) => `<a class="tag" href="#/cut/${esc(c.ref.slice(4))}">${esc(c.data.name)}</a>`).join('') || '<span class="mute">none</span>'}</div></div></div>
  ${stageCard(s, imgs)}${metaCard(s)}${background(D)}${takesOf(id).length > 1 ? `<div class="mute small">${takesOf(id).length} takes for this shot are on the <a href="#/board">review board</a>.</div>` : ''}
  ${ls.length ? `<h2>Dialogue</h2>${ls.map((l) => `<div class="dl big"><b>${esc(l.data.speaker || l.data.role)}</b> ${ed ? `<input data-l="${esc(l.ref)}" data-k="de" value="${esc(l.data.de || '')}"><input data-l="${esc(l.ref)}" data-k="en" value="${esc(l.data.en || '')}" placeholder="English">` : `${esc(l.data.de || '')}${l.data.en ? `<span class="mute"> — ${esc(l.data.en)}</span>` : ''}`}${l.data.delivery ? `<span class="mute small"> ${esc(l.data.delivery)}</span>` : ''}${audioTakes(l)}${l.stale ? '<span class="st s-stale">stale</span>' : ''} <button class="btn sm" data-act="discuss" data-ref="${esc(l.ref)}">Discuss${l.openCount ? '' : ''}</button><div class="dcp" id="dc-${esc(l.ref)}" hidden>${threadsHtml(l.ref)}</div></div>`).join('')}` : ''}
  <h2>Feedback on this shot</h2><div class="row"><button class="btn sm" data-act="markup" data-ref="${esc(s.ref)}" data-mode="sketch">Draw a storyboard frame</button><button class="btn sm" data-act="markup" data-ref="${esc(s.ref)}" data-mode="stage">Frame it in 3D</button><span class="mute small">or click any image above and choose Draw on this</span></div>${threadsHtml(s.ref)}`;
}

const SIZES = ['EWS', 'WS', 'MS', 'MCU', 'CU', 'ECU', 'INS'], LENSES = ['24mm', '35mm', '50mm', '85mm'], MOVES = ['Static', 'Slow push', 'Handheld', 'Rack focus'];
const LENS_HINT = { '24mm': 'Wide. Pushes space around the actor; establishing shots and tension.', '35mm': 'Natural wide. A good default for walking and talking.', '50mm': 'Close to the eye. Calm, honest dialogue.', '85mm': 'Portrait. Compresses the background; emotional close-ups.' };
function spec(D, ed) {
  const row = (k, label, arr) => ed ? `<label class="k">${label}</label><div class="row">${arr.map((v) => `<button class="vd" data-act="specpick" data-k="${k}" data-v="${v}" aria-pressed="${D[k] === v}">${v}</button>`).join('')}</div>` : D[k] ? `<div class="kv"><span class="mute">${label}</span> ${esc(D[k])}</div>` : '';
  return `${row('size', 'Shot size', SIZES)}${row('lens', 'Lens', LENSES)}${ed && D.lens ? `<div class="mute small">${esc(LENS_HINT[D.lens] || '')}</div>` : ''}${row('move', 'Camera move', MOVES)}`;
}
const audios = (l) => (l.assets || []).filter((a) => (a.mime || '').startsWith('audio/'));
function audioTakes(l) {
  const as = audios(l); if (!as.length) return ''; const many = as.length > 1, human = isHuman();
  return as.map((a, i) => `<span class="atk${(l.data.pick_audio || as[0].id) === a.id ? ' on' : ''}"><audio controls preload="none" src="${a.uri.startsWith('audio/') ? '/' + esc(a.uri) : esc(mediaSrc(a.uri))}"></audio>${many ? `<span class="mute small">test ${i + 1}</span>` : ''}${human && many && (l.data.pick_audio || as[0].id) !== a.id ? `<button class="btn sm ok" data-act="audiopick" data-ref="${esc(l.ref)}" data-id="${esc(a.id)}">Use this</button>` : ''}</span>`).join('') + (human ? `<label class="chk"><input type="checkbox" data-act="lipsync" data-ref="${esc(l.ref)}" ${l.data.sync ? 'checked' : ''}> lips match</label>` : l.data.sync ? '<span class="tag add">lips match</span>' : '');
}
function stageCard(s, imgs) {
  const sc = get(s.parent ? `stage:${s.parent.slice(s.parent.indexOf(':') + 1)}` : ''), cfg = sc && (sc.data.shots || {})[s.ref]; if (!cfg) return '';
  const cam = (sc.data.cameras || {})[cfg.camera], ids = (sc.assets || []).filter((a) => a.provenance.shot === s.ref), asset = (role) => { const a = [...ids].reverse().find((x) => x.provenance.role === role); return a ? mediaSrc(a.uri) : ''; };
  const ov = asset('ids') || asset('layout'), base = imgs[0] || '';
  return `<details class="card" open><summary><b>Staging</b> <span class="mute small">camera ${esc(cfg.camera)}${cam ? ` · ${cam.lens} mm · ${(cam.pos[1] || 0).toFixed(1)} m high${cam.move && cam.move.type !== 'static' ? ' · ' + esc(cam.move.type) : ''}` : ''}</span> ${chip(sc)} <a href="#/stage/${esc(sc.ref.slice(6))}">Open in staging</a></summary>
  <p class="small">${esc(composePrompt(sc.data, s.ref, (get('canon.style:look') || { data: {} }).data))}</p>${ov && base ? `<div class="ovl"><img src="${esc(base)}" alt="the image"><img class="ovtop" id="ovtop" src="${esc(ov)}" alt="stage outline" style="opacity:.5"></div><div class="row"><label class="chk">Stage over the image <input type="range" id="ovop" min="0" max="100" value="50"></label><label class="chk"><select id="ovblend"><option value="screen">add</option><option value="difference">difference</option><option value="normal">cover</option></select></label></div><p class="mute small">Slide to see whether the angle and the positions were followed. Anything that does not line up is worth a comment on the object.</p>` : '<p class="mute small">Export the package from staging to compare it with the image.</p>'}</details>`;
}
function background(D) {
  const rows = [['why', 'Why this shot'], ['backstory', 'Backstory'], ['story', 'What happens'], ['use', 'How it is used'], ['pairs_with', 'Pairs with'], ['gives', 'What it gives the cut'], ['prompt', 'Generation prompt'], ['risk', 'Risk'], ['fact', 'Fact or fiction'], ['source', 'Source'], ['location', 'Location'], ['episode_ref', 'Series reference']].filter(([k]) => D[k]);
  return rows.length ? `<details class="card" open><summary><b>Background</b> <span class="mute small">from the teaser board</span></summary>${rows.map(([k, l]) => `<div class="kv"><span class="mute">${l}</span> ${k === 'risk' ? `<b style="color:var(--warn)">${esc(D[k])}</b>` : miniHtml(D[k])}</div>`).join('')}${D.dur_min ? `<div class="kv"><span class="mute">Made for</span> ${D.dur_min}-${D.dur_max}s${D.hero ? ' · hero shot' : ''}${D.is_new ? ' · has new lines to write and voice' : ''}</div>` : ''}</details>` : '';
}
document.addEventListener('input', (e) => { if (e.target.id === 'ovop') document.getElementById('ovtop').style.opacity = e.target.value / 100; });
document.addEventListener('change', (e) => { if (e.target.id === 'ovblend') document.getElementById('ovtop').style.mixBlendMode = e.target.value; });
export const acts = {
  async audiopick(el) { await editArtifact(el.dataset.ref, (d) => { d.pick_audio = el.dataset.id; return d; }, 'Chose this recording'); toast('Chosen'); return 'refresh'; },
  async lipsync(el) { await editArtifact(el.dataset.ref, (d) => { d.sync = el.checked; return d; }, el.checked ? 'Lips match' : 'Lips do not match'); return 'refresh'; },
  specpick: (el) => { const on = el.getAttribute('aria-pressed') !== 'true'; el.parentElement.querySelectorAll('.vd').forEach((b) => b.setAttribute('aria-pressed', 'false')); el.setAttribute('aria-pressed', String(on)); },
  discuss: (el) => { const b = $(`#dc-${CSS.escape(el.dataset.ref)}`); b.hidden = !b.hidden; },
  copylink: () => copyText(location.href, 'Link copied'),
  zoom: (el) => lightbox(el.dataset.src, el.dataset.cap),
  editshot: (el) => { st.shotEdit = el.dataset.id || null; return 'render'; },
  async saveshot(el) {
    const id = el.dataset.id, s = get(`shot:${id}`), data = { ...s.data }, why = $('[data-f=_why]').value.trim() || 'Edited on the shot page';
    document.querySelectorAll('[data-f]').forEach((i) => { const k = i.dataset.f; if (k !== '_why') data[k] = k === 'seconds' ? Number(i.value) || data.seconds : i.value; });
    document.querySelectorAll('.vd[data-act=specpick]').forEach((b) => { if (b.getAttribute('aria-pressed') === 'true') data[b.dataset.k] = b.dataset.v; });
    const changed = JSON.stringify(data) !== JSON.stringify(s.data);
    if (changed) { // the list view has no dependencies, so read them from the artifact itself
      const full = await api(P('/artifacts/' + encodeURIComponent(s.ref)));
      await api(P('/propose'), { method: 'POST', body: { ref: s.ref, data, parent: s.parent, deps: full.deps.filter((x) => x !== s.parent), auto_approve: true, rationale: why } });
    }
    const edits = {};
    document.querySelectorAll('[data-l]').forEach((i) => { (edits[i.dataset.l] ||= {})[i.dataset.k] = i.value; });
    let n = changed ? 1 : 0;
    for (const [ref, v] of Object.entries(edits)) {
      const l = get(ref), nd = { ...l.data, ...v }; if (JSON.stringify(nd) === JSON.stringify(l.data)) continue;
      await api(P('/propose'), { method: 'POST', body: { ref, data: nd, parent: l.parent, auto_approve: true, rationale: why } }); n++;
    }
    st.shotEdit = null; toast(n ? `Saved ${n} change${n > 1 ? 's' : ''} as your version` : 'Nothing changed'); return 'refresh';
  },
};
