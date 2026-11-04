// Step 5 Places.  A = for each place: "Use my photo" or "Make one", and the must-keep list.  B = the picture(s) of each place (canon.world:place-*) as the reviewable item.
// Faces and pictures do not need this step to be finished, but scenes are made from what is approved here.
import { $, $$, esc, api, P, toast } from './core.js';
import { keyOf } from './wizard-model.js';
import { registerStep, spine, itemEl, chipOf, pill, nothing, lk, placeArts, ownEdit, refresh, hrefOf } from './w-core.js';
import { registerFix } from './w-fix.js';
import { attachFile, errText, srcOf } from './w-media.js';

const pid = (a) => keyOf(a.ref).replace(/^place-/, ''); // wizard actions take the id without "place-"
const busy = {}; // place id -> { working, err }
const plates = (a) => (a.data.plates || []).filter((p) => srcOf(a.ref, p.id));
const SRC = { none: 'no picture yet', photo: 'your photo', made: 'made by me' };
const stLine = (id) => { const b = busy[id]; return b ? (b.err ? `<span class="sm" style="color:var(--red-ink);display:block;margin-top:4px" role="alert">${esc(b.err)}</span>` : b.working ? `<span class="sm" style="font-style:italic;display:block;margin-top:4px" aria-live="polite">${esc(b.working)}</span>` : '') : ''; };
function paintBusy(id) { const el = $(`[data-wpl-prog="${CSS.escape(id)}"]`); if (el) el.innerHTML = stLine(id); $$(`[data-wpl-btn="${CSS.escape(id)}"]`).forEach((b) => { b.disabled = !!(busy[id] && busy[id].working); }); }

function htmlPlaces(ctx) {
  const ps = placeArts();
  if (!ps.length) return spine(ctx, { A: nothing('Nothing to do yet.'), B: `<p class="nothing">I found no places yet. ${lk('Go to Start', hrefOf('start'))} and let me read your story first.</p>`, items: [], empty: true, ai: 'I need to read your story first.', gate: { ready: false, reason: 'Let me read your story first (steps 1 and 2).' } });
  const A = `<span class="lbl" style="margin-top:0">Where does each picture come from?</span><p class="sm mute" style="margin:0 0 4px">Use your own photo, or let me make one (1 credit). The list says what must be seen in it.</p>
  ${ps.map((a) => { const id = pid(a), mk = a.data.must_keep || [], bz = busy[id] && busy[id].working; return `<div class="wz-plc-row"><div><b>${esc(a.data.name)}</b><div class="sm mute">${esc(a.data.time || '')}${a.data.time ? ' · ' : ''}${SRC[a.data.source] || SRC.none}</div></div>
    <div><label class="bt sm filebtn" ${bz ? 'aria-disabled="true"' : ''}>Use my photo<input type="file" accept="image/*" data-wpl-photo="${esc(id)}" data-wpl-btn="${esc(id)}" ${bz ? 'disabled' : ''}></label> <button class="bt sm ${plates(a).length ? '' : 'pri'}" data-act="wpl-make" data-id="${esc(id)}" data-wpl-btn="${esc(id)}" ${bz ? 'disabled' : ''}>${plates(a).length ? 'Make another' : 'Make one'} · 1 credit</button><span data-wpl-prog="${esc(id)}">${stLine(id)}</span>
    <div style="margin-top:8px"><span class="sm mute">Must be seen:</span> ${mk.map((w, i) => `<span class="ch">${esc(w)}<button class="wz-look-x" data-act="wpl-unkeep" data-id="${esc(a.ref)}" data-i="${i}" aria-label="Remove ${esc(w)}">×</button></span>`).join('')}<span class="wz-look-add wz-plc-add"><input maxlength="40" data-wpl-keep="${esc(a.ref)}" placeholder="the main beam" aria-label="Add something that must be seen in ${esc(a.data.name)}"><button class="bt sm" data-act="wpl-keep" data-id="${esc(a.ref)}">+ add</button></span></div></div></div>`; }).join('')}`;
  const B = ps.map((a) => { const pl = plates(a);
    return `<div style="margin-bottom:16px">${itemEl(a.ref, `<div class="row"><b><i>${esc(a.data.name)}</i></b>${a.data.source === 'photo' ? pill('your photo', 'ok') : a.data.source === 'made' ? pill('made by me', 'info') : ''}<span class="sp"></span>${chipOf(a.ref)}</div>
      <p class="sm" style="margin:4px 0 0">${esc(a.data.desc || '')}</p>
      <div class="wz-plc-plates">${pl.length ? pl.map((p, i) => itemEl(a.ref, `<div class="pic w"><img src="${esc(srcOf(a.ref, p.id))}" alt="Picture ${i + 1} of ${esc(a.data.name)}"><i>${esc(a.data.name)} · ${i + 1}</i></div>`, { part: `plate:${p.id}`, kind: 'place', name: `${a.data.name} · picture ${i + 1}`, img: srcOf(a.ref, p.id), plain: true })).join('') : `<div class="pic w none"><i>No picture yet. Scenes will use the words only.</i></div>`}</div>`, { kind: 'place', name: a.data.name, cls: 'hc' })}</div>`; }).join('');
  const none = ps.filter((a) => !plates(a).length);
  const notice = [...(none.length ? [['warn', `No picture yet for ${none.map((a) => esc(a.data.name)).join(', ')}. Scenes will be made from the written description.`]] : [['ok', 'Every place has a picture.']])];
  return spine(ctx, { A, B, items: ps.map((a) => a.ref), noun: ['place', 'places'], ai: 'Give me a photo of each place, or let me make one. Then check them.', notice, act: ps.some((a) => (a.data.source || 'none') === 'none') ? 'A' : undefined });
}

async function makePlate(id, instruction) { // used by the button and by the margin card
  busy[id] = { working: 'Making a picture... this can take a little while.' }; paintBusy(id);
  try { await api(P('/wizard/plate'), { method: 'POST', body: { id, ...(instruction ? { instruction } : {}) } }); delete busy[id]; }
  catch (e) { busy[id] = { err: errText(e) }; paintBusy(id); throw e; }
}
registerFix('place', { cost: 1, async run({ ref, instruction }) { await makePlate(keyOf(ref).replace(/^place-/, ''), instruction); return 'Made a new picture of this place.'; } });

const keepEdit = (ref, fn) => ownEdit(ref, (d) => { d.must_keep = fn([].concat(d.must_keep || [])); return d; }, 'Must-be-seen list edited');
registerStep('places', {
  items: () => placeArts().map((a) => a.ref), html: htmlPlaces,
  bind(root) {
    $$('[data-wpl-photo]', root).forEach((f) => f.addEventListener('change', async (e) => {
      const file = e.target.files[0], id = f.dataset.wplPhoto, ref = `canon.world:place-${id}`; e.target.value = ''; if (!file) return;
      busy[id] = { working: 'Adding your photo...' }; paintBusy(id);
      try { const as = await attachFile(ref, file, 'place'); await ownEdit(ref, (d) => ({ ...d, source: 'photo', plates: [{ id: as.id }] }), 'The person added their own photo'); delete busy[id]; toast('Your photo is now the picture of this place.'); refresh(); }
      catch (x) { busy[id] = { err: errText(x) }; paintBusy(id); }
    }));
    $$('[data-wpl-keep]', root).forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $(`[data-act=wpl-keep][data-id="${CSS.escape(i.dataset.wplKeep)}"]`, root).click(); } }));
  },
  acts: {
    async 'wpl-make'(el) { const id = el.dataset.id; if (busy[id] && busy[id].working) return; try { await makePlate(id); toast('Made a picture. Please check it.'); } catch { return; } return 'refresh'; },
    async 'wpl-keep'(el) { const i = $(`[data-wpl-keep="${CSS.escape(el.dataset.id)}"]`), v = (i.value || '').trim().slice(0, 40); if (!v) return toast('Write what must be seen in this place.'); await keepEdit(el.dataset.id, (l) => (l.some((x) => x.toLowerCase() === v.toLowerCase()) ? l : [...l, v])); return 'refresh'; },
    async 'wpl-unkeep'(el) { await keepEdit(el.dataset.id, (l) => l.filter((_, k) => k !== +el.dataset.i)); return 'refresh'; },
  },
});
