// The canon screens: Story (logline, bible, references), Look and world (base prompt, rules), Voices.
import { $, esc, st, api, P, toast, chip, tag, isHuman, miniHtml, copyText, mediaSrc } from './core.js';
import { get, ofKind, editArtifact, createArtifact, openCount } from './data.js';
import { threadsHtml } from './feedback.js';

const LENS = { 24: 'Wide. Pushes space around the actor. Establishing shots and tension in a room.', 35: 'Natural wide. A good default for walking and talking.', 50: 'Close to the eye. Calm, honest dialogue.', 85: 'Portrait. Compresses the background and isolates faces. Emotional close-ups.' };
const chips = (arr, cur, act, extra = '') => arr.map((v) => `<button class="vd" data-act="${act}" ${extra} data-v="${esc(v)}" aria-pressed="${String(cur) === String(v)}">${esc(v)}</button>`).join('');
const head = (a) => `<div class="row">${chip(a)}<span class="mute">v${a.version} · ${esc(a.author)}</span>${openCount(a.ref) ? `<span class="tag fbk">${openCount(a.ref)} open</span>` : ''}</div>`;
const prose = (v) => (Array.isArray(v) ? `<ul>${v.map((x) => `<li>${miniHtml(x)}</li>`).join('')}</ul>` : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `<div class="kv"><span class="mute">${esc(k)}</span> ${typeof x === 'string' ? miniHtml(x) : prose(x)}</div>`).join('') : `<p>${miniHtml(v)}</p>`);

// ---------- Story ----------
export function vStory() {
  const lg = get('logline:main'), bb = get('bible:main'), refs = ofKind('reference'), cast = ofKind('canon.cast').map((c) => c.data.name);
  const cats = [['mood', 'Mood board'], ['style', 'Style references'], ['place', 'Places and props'], ['cast', 'Character references']];
  return `<h1>Story</h1><p class="mute">The idea everything else must serve. Your edits are saved as your version and flag what was built on them.</p>
  ${lg ? `<div class="card"><h2 style="margin-top:0">Logline</h2>${head(lg)}${isHuman() ? `<textarea id="lgtext">${esc(lg.data.text || '')}</textarea><button class="btn pri sm" data-act="savelogline">Save my version</button>` : `<p class="lead">${esc(lg.data.text || '')}</p>`}${threadsHtml(lg.ref)}</div>` : '<div class="empty">No logline yet. The AI proposes one as <code>logline:main</code>.</div>'}
  ${bb ? `<div class="card"><h2 style="margin-top:0">${esc(bb.data.title || 'Bible')}</h2>${head(bb)}<div class="kv"><span class="mute">Setting</span> ${esc(bb.data.setting || '')} · <span class="mute">language</span> ${esc(bb.data.language || '')}</div>
    ${bb.data.narrator ? `<h2>Narrator</h2>${prose(bb.data.narrator)}` : ''}${bb.data.sources ? `<h2>What is documented, what is invented</h2>${prose(bb.data.sources)}` : ''}${bb.data.fiction_label ? `<h2>Fiction label</h2><div class="kv">${esc(bb.data.fiction_label.hint || '')} <span class="mute">(${esc(bb.data.fiction_label.regex || '')})</span></div>` : ''}${bb.data.packs ? `<h2>Looks and packs</h2>${prose(bb.data.packs)}` : ''}${threadsHtml(bb.ref)}</div>` : ''}
  <h2>References</h2><p class="mute">Pictures that show the AI what you mean. It reads them with the canon.</p>
  ${isHuman() ? `<div class="card"><div class="row"><select id="refcat">${cats.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><select id="reffor" title="For which character">${['Whole cast', ...cast].map((n) => `<option>${esc(n)}</option>`).join('')}</select><input type="file" id="reffiles" accept="image/*" multiple style="max-width:300px"><input id="refnote" placeholder="Note (optional)" style="max-width:260px"><button class="btn pri sm" data-act="refupload">Upload</button></div></div>` : ''}
  ${cats.map(([k, l]) => { const l2 = refs.filter((r) => r.data.category === k); return l2.length ? `<h2>${l} · ${l2.length}</h2><div class="shgrid">${l2.map((r) => `<figure class="refc">${(r.assets || [])[0] ? `<img src="${esc(mediaSrc(r.assets[0].uri))}" alt="" data-act="zoom" data-src="${esc(mediaSrc(r.assets[0].uri))}" data-cap="${esc(r.data.title || r.ref)}" data-ref="${esc(r.ref)}" loading="lazy">` : ''}<figcaption>${esc(r.data.title || r.ref)}${r.data.for && r.data.for !== 'Whole cast' ? ` · ${esc(r.data.for)}` : ''}${r.data.note ? `<br><span class="mute">${esc(r.data.note)}</span>` : ''}</figcaption></figure>`).join('')}</div>` : ''; }).join('') || '<div class="empty">No references yet.</div>'}`;
}

// ---------- Look and world ----------
const basePrompt = (d) => {
  const set = (v) => v !== undefined && v !== '' && v !== null, fmt = [d.aspect, set(d.shot_seconds) ? `${d.shot_seconds} s per shot` : '', set(d.fps) ? `${d.fps} fps` : ''].filter(Boolean).join(', ');
  const rows = [fmt && `FORMAT  ${fmt}`, set(d.lens) && `CAMERA  ${d.lens}mm lens${LENS[d.lens] ? `, ${LENS[d.lens].split('.')[0].toLowerCase()}` : ''}`, d.look && `LOOK    ${d.look}`, [d.period, d.season, d.time_of_day, d.weather].some(Boolean) && `PERIOD  ${[d.period, d.season, d.time_of_day, d.weather].filter(Boolean).join('; ')}`, d.sound && `SOUND   ${d.sound}`, d.rules && `RULES   ${d.rules}`, d.forbidden && d.forbidden.length && `NEVER   ${d.forbidden.join(', ')}`, ofKind('reference').length && `REFS    ${ofKind('reference').length} attached`].filter(Boolean);
  return rows.length ? rows.join('\n') : 'Nothing set yet. Fill in the fields above and the AI gets this block with every shot.';
};
export function vLook() {
  const s = get('canon.style:look'), w = get('canon.world:world');
  if (!s) return '<h1>Look and world</h1><div class="empty">No style canon yet. The AI proposes it as <code>canon.style:look</code>.</div>';
  const d = s.data, ed = isHuman(), f = (k, label, area) => `<label class="k">${label}</label>${area ? `<textarea data-sf="${k}">${esc(Array.isArray(d[k]) ? d[k].join(', ') : d[k] || '')}</textarea>` : `<input data-sf="${k}" value="${esc(d[k] ?? '')}">`}`;
  return `<h1>Look and world</h1><p class="mute">The base prompt every shot inherits, and what may exist on screen.</p>
  <div class="card"><div class="row"><h2 style="margin:0;color:var(--ink)">Base prompt</h2>${head(s)}<span class="sp"></span>${ed ? `<button class="btn sm" data-act="lock" data-ref="${s.ref}" data-lock="${s.status === 'locked' ? 0 : 1}" ${['approved', 'locked'].includes(s.status) ? '' : 'disabled'}>${s.status === 'locked' ? 'Unlock' : 'Lock'}</button>` : ''}</div>
  ${ed ? `<div class="two"><div><label class="k">Aspect</label><div class="row">${chips(['9:16', '16:9', '1:1'], d.aspect, 'stylepick', 'data-k="aspect"')}</div><label class="k">Shot length (s)</label><div class="row">${chips([4, 6, 8, 10], d.shot_seconds, 'stylepick', 'data-k="shot_seconds"')}</div><label class="k">Frame rate</label><div class="row">${chips([24, 30], d.fps, 'stylepick', 'data-k="fps"')}</div><label class="k">Lens</label><div class="row">${chips([24, 35, 50, 85], d.lens, 'stylepick', 'data-k="lens"')}</div><p class="mute small">${esc(LENS[d.lens] || 'Pick a lens.')}</p>${f('look', 'Look')}</div>
    <div>${f('period', 'Period and place')}${f('season', 'Season')}${f('time_of_day', 'Time of day')}${f('weather', 'Weather')}${f('sound', 'Sound')}${f('rules', 'Rules for every shot', true)}${f('forbidden', 'Never on screen (comma separated)', true)}</div></div><button class="btn pri" data-act="savestyle">Save my version</button>` : ''}
  <h2>Assembled prompt</h2><pre id="bp">${esc(basePrompt(d))}</pre><button class="btn sm" data-act="copyprompt">Copy</button>
  ${['language', 'looks', 'camera_label', 'music', 'title_card'].some((k) => d[k]) ? `<h2>Also on the style</h2>${prose(Object.fromEntries(['language', 'looks', 'camera_label', 'music', 'title_card'].filter((k) => d[k]).map((k) => [k, d[k]])))}` : ''}${threadsHtml(s.ref)}</div>
  <h2>World</h2>${w ? world(w, ed) : `<div class="empty">No world canon yet.${ed ? '<br><button class="btn pri sm" data-act="mkworld">Create it</button>' : ''}</div>`}
  <div class="row"><button class="btn sm" data-act="runcont">Check the whole production against the world</button></div><div id="cont"></div>`;
}
function world(w, ed) {
  const d = w.data, list = (k, label) => `<div class="card"><b>${label}</b><div class="row" style="margin:6px 0">${(d[k] || []).map((x, i) => `<span class="tag">${esc(x)}${ed ? ` <a href="#" data-act="wrm" data-k="${k}" data-i="${i}" aria-label="Remove">×</a>` : ''}</span>`).join('') || '<span class="mute">none yet</span>'}</div>${ed ? `<div class="row"><input data-wadd="${k}" placeholder="Add…" style="max-width:240px"><button class="btn sm" data-act="wadd" data-k="${k}">Add</button></div>` : ''}</div>`;
  return `<div class="row">${head(w)}</div><div class="grid3">${list('locations', 'Locations')}${list('props', 'Props')}${list('rules', 'Rules')}${list('forbidden', 'Never on screen')}</div>${threadsHtml(w.ref)}`;
}

// ---------- Voices ----------
const VCHOICES = { timing: ['Slow, measured', 'Brisk', 'Halting'], emotion: ['Calm, dry', 'Wistful', 'Cold', 'Rising alarm', 'Suppressed fear', 'Defiant'], delivery: ['Clear, period diction', 'Whispered', 'Projected'] };
export function vVoices() {
  const vs = ofKind('canon.voice'); if (!vs.length) return '<h1>Voices</h1><div class="empty">No voices yet. The AI proposes them as <code>canon.voice:&lt;role&gt;</code>.</div>';
  return `<h1>Voices</h1><p class="mute">One voice per speaking role, and how it performs. Listen to the lines already recorded for each.</p>${vs.map((v) => {
    const d = v.data, mine = ofKind('dialogue').filter((l) => l.data.role === d.code && (l.assets || []).some((a) => a.uri.startsWith('audio/'))).slice(0, 2), el = d.elevenlabs;
    return `<article class="card"><div class="row"><h2 style="margin:0;color:var(--ink)">${esc(d.label || d.code)}</h2>${tag(d.code)}${head(v)}</div>
    <div class="kv"><span class="mute">Voice</span> ${el ? `${esc(el.name)} <span class="mute">(${esc(el.model)})</span>` : '<i>not assigned</i>'}${d.gender ? ` · ${esc(d.gender)}` : ''}${(d.age || []).length ? ` · ${esc(d.age.join(' / '))}` : ''}</div>${(d.want || []).length ? `<div class="kv"><span class="mute">Wanted</span> ${esc(d.want.join(', '))}</div>` : ''}
    ${Object.entries(VCHOICES).map(([k, opts]) => `<label class="k">${k[0].toUpperCase() + k.slice(1)}</label><div class="row">${isHuman() ? chips(opts, d[k], 'voicepick', `data-ref="${esc(v.ref)}" data-k="${k}"`) : esc(d[k] || '—')}</div>`).join('')}
    ${mine.length ? `<h2>Listen</h2>${mine.map((l) => `<div class="dl">${esc(l.data.de || '')} <audio controls preload="none" src="/${esc(l.assets.find((a) => a.uri.startsWith('audio/')).uri)}"></audio></div>`).join('')}` : '<p class="mute">No recorded line for this role yet.</p>'}${threadsHtml(v.ref)}</article>`;
  }).join('')}`;
}

// ---------- actions ----------
const shrink = (file) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { const s = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); c.toBlob(res, 'image/jpeg', .82); }; im.onerror = rej; im.src = URL.createObjectURL(file); });
export const acts = {
  savelogline: async () => { await editArtifact('logline:main', (d) => { d.text = $('#lgtext').value.trim(); return d; }, 'Edited the logline'); toast('Saved as your version'); return 'refresh'; },
  async refupload() {
    const files = [...$('#reffiles').files]; if (!files.length) return toast('Choose one or more images first');
    const cat = $('#refcat').value, forWho = $('#reffor').value, note = $('#refnote').value.trim(), stamp = Date.now().toString(36);
    for (const [i, f] of files.entries()) {
      const name = `ref-${stamp}-${i}.jpg`, blob = await shrink(f);
      const r = await fetch(`/api/p/${st.pid}/media/${name}`, { method: 'PUT', headers: { authorization: 'Bearer ' + st.key, 'content-type': 'image/jpeg' }, body: blob }); if (!r.ok) throw new Error('upload failed');
      const ref = `reference:${stamp}-${i}`; await createArtifact(ref, { category: cat, title: f.name, note, for: cat === 'cast' ? forWho : undefined }, { why: 'Reference added by a human' });
      await api(P('/assets'), { method: 'POST', body: { ref, uri: `media/${st.pid}/${name}`, mime: 'image/jpeg', bytes: blob.size, provenance: { uploaded_by: st.me.name } } });
    }
    toast(`${files.length} reference${files.length > 1 ? 's' : ''} added`); return 'refresh';
  },
  stylepick: async (el) => { await editArtifact('canon.style:look', (d) => { d[el.dataset.k] = /^\d+(\.\d+)?$/.test(el.dataset.v) && el.dataset.k !== 'aspect' ? Number(el.dataset.v) : el.dataset.v; return d; }, `Set ${el.dataset.k}`); return 'refresh'; },
  async savestyle() {
    await editArtifact('canon.style:look', (d) => { document.querySelectorAll('[data-sf]').forEach((i) => { d[i.dataset.sf] = i.dataset.sf === 'forbidden' ? i.value.split(',').map((x) => x.trim()).filter(Boolean) : i.value; }); return d; }, 'Edited the base prompt');
    toast('Saved as your version. Shots built on it are now stale.'); return 'refresh';
  },
  copyprompt: () => copyText($('#bp').textContent, 'Base prompt copied'),
  mkworld: async () => { await createArtifact('canon.world:world', { locations: [], props: [], rules: [], forbidden: [] }, { deps: ['canon.style:look'] }); return 'refresh'; },
  wadd: async (el) => { const v = $(`[data-wadd="${el.dataset.k}"]`).value.trim(); if (!v) return toast('Type something first'); await editArtifact('canon.world:world', (d) => { (d[el.dataset.k] ||= []).push(v); return d; }, `Added to ${el.dataset.k}`); return 'refresh'; },
  wrm: async (el) => { await editArtifact('canon.world:world', (d) => { d[el.dataset.k].splice(Number(el.dataset.i), 1); return d; }, `Removed from ${el.dataset.k}`); return 'refresh'; },
  voicepick: async (el) => { await editArtifact(el.dataset.ref, (d) => { d[el.dataset.k] = el.dataset.v; return d; }, `Set ${el.dataset.k}`); return 'refresh'; },
  async runcont() { const r = await api(P('/continuity')), box = $('#cont'); box.innerHTML = r.ok ? `<p class="why">All ${r.checked} artifacts pass (${r.forbidden_terms} forbidden terms checked).</p>` : `<table>${r.issues.map((i) => `<tr><td>${esc(i.ref)}</td><td>${esc(i.type)}</td><td>${esc(i.term || i.on || '')}</td></tr>`).join('')}</table>`; },
};
