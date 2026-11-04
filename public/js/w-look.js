// Step 3 Look.  A = choose one of three looks, the "Never on screen" list, style reference pictures.  B = the look itself (canon.style:look) as ONE reviewable item.
// Choosing a look or editing the never-list is the person's own edit (ownEdit): it stays "To review" if the AI's version was never approved, otherwise it is approved at once.
// The picture shape comes from Start and is shown read-only.
import { $, esc, toast, mediaSrc } from './core.js';
import { get, ofKind, createArtifact } from './data.js';
import { REFS } from './wizard-model.js';
import { registerStep, spine, itemEl, chipOf, pill, nothing, lk, ownEdit, refresh, hrefOf } from './w-core.js';
import { attachFile, errText } from './w-media.js';

const look = () => get(REFS.look), ld = () => (look() || {}).data || {};
const styleRefs = () => ofKind('reference').filter((r) => (r.data || {}).category === 'style' && !r.data.removed);
const never = () => [].concat(ld().forbidden || []);
const chosenOpt = () => (ld().options || []).find((o) => o.id === ld().chosen);
// What every picture is told about the look. Mirrors lookText() in src/wizard.js.
export const toldText = (d) => [d.look, d.period && `Period: ${d.period}`, [].concat(d.forbidden || []).length && `Never show: ${[].concat(d.forbidden).join(', ')}`, d.rules, `${d.aspect || '9:16'}, ${d.fps || 24} fps, ${d.shot_seconds || 6} seconds per shot, ${d.lens || 35} mm lens`].filter(Boolean).join('. ') + '.';

function htmlLook(ctx) {
  const lg = look();
  if (!lg) return spine(ctx, { A: nothing('Nothing to choose yet.'), B: `<p class="nothing">I have not made any looks yet. ${lk('Go to Start', hrefOf('start'))} and let me read your story first.</p>`, items: [], empty: true, ai: 'I need to read your story first.', gate: { ready: false, reason: 'Let me read your story first (steps 1 and 2).' } });
  const d = lg.data, opts = d.options || [], refs = styleRefs();
  const A = `<span class="lbl" style="margin-top:0">Which look do you want?</span>
  <div class="wz-look-opts" role="group" aria-label="Looks">${opts.map((o, i) => `<button class="wz-look-opt" data-act="wl-pick" data-id="${esc(o.id)}" aria-pressed="${o.id === d.chosen}"><b>${esc(o.name)}</b>${i === 0 ? ' ' + pill('my pick', 'info') : ''}<span class="sm mute">${esc(o.sub)}</span><span class="sm">${esc(o.desc)}</span></button>`).join('') || '<p class="sm mute">I made no looks.</p>'}</div>
  <span class="lbl">Never on screen</span><p class="sm mute" style="margin:0 0 6px">Things that must not appear in any picture. Remove one with ×.</p>
  <div>${never().map((w, i) => `<span class="ch">${esc(w)}<button class="wz-look-x" data-act="wl-unnever" data-i="${i}" aria-label="Remove ${esc(w)}">×</button></span>`).join('')}<span class="wz-look-add"><input id="wl-never" maxlength="40" placeholder="electric light" aria-label="Add something that must never be on screen"><button class="bt sm" data-act="wl-never">+ add</button></span></div>
  <span class="lbl">Your reference pictures <span class="mute" style="text-transform:none;letter-spacing:0;font:italic 13px var(--serif)">· optional</span></span>
  <p class="sm mute" style="margin:0 0 6px">Pictures with the colours, light or clothes you like. They are kept with the film.</p>
  <div class="wz-look-refs">${refs.map((r) => { const a = (r.assets || [])[0]; return `<div class="wz-look-ref">${a ? `<img src="${esc(mediaSrc(a.uri))}" alt="${esc(r.data.title || 'Reference')}" loading="lazy">` : ''}<button class="x" data-act="wl-rmref" data-ref="${esc(r.ref)}" aria-label="Remove ${esc(r.data.title || 'reference')}">×</button></div>`; }).join('') || '<span class="sm mute">No reference pictures.</span>'}</div>
  <label class="bt sm filebtn">Add reference pictures<input type="file" id="wl-ref" multiple accept="image/*"></label><span class="sm mute" id="wl-refmsg" aria-live="polite" style="margin-left:8px"></span>
  <div class="sm mute" style="margin-top:12px">Picture shape: <b>${esc(d.aspect || '')}</b> · ${lk('Change in Start', hrefOf('start'))}</div>`;
  const o = chosenOpt(), name = o ? o.name : 'The look';
  const B = itemEl(REFS.look, `<div class="row"><b><i>${esc(name)}</i></b>${o && opts[0] && o.id === opts[0].id ? pill('my pick', 'info') : ''}<span class="sp"></span>${chipOf(REFS.look)}</div>
    <p style="margin:6px 0">${esc(d.look || 'No look chosen yet.')}</p>
    <div><span class="ch">${esc(d.aspect || '')}</span><span class="ch">${esc(d.shot_seconds || 6)} s a shot</span><span class="ch">${esc(d.fps || 24)} fps</span><span class="ch">${esc(d.lens || 35)} mm</span>${d.period ? `<span class="ch">${esc(d.period)}</span>` : ''} <span class="sm mute">picture shape and length come from Start · ${lk('Change in Start', hrefOf('start'))}</span></div>
    <span class="lbl">What every picture will be told</span><div class="wz-look-told">${esc(toldText(d))}</div>`, { kind: 'look', name: "The look", cls: 'hc' });
  const notice = [d.look ? ['ok', 'Every picture, face and place is made with this look.'] : ['warn', 'Choose a look on the left.'], ...(never().length ? [] : [['warn', 'Nothing is listed as never on screen. Add anything that does not fit your period.']])];
  return spine(ctx, { A, B, items: [REFS.look], noun: ['look', 'looks'], ai: 'I made three looks and picked one. Choose the one you like. Click the look on the right to tell me what is off.', notice });
}

const setForbidden = (fn) => ownEdit(REFS.look, (d) => { d.forbidden = fn([].concat(d.forbidden || [])); return d; }, 'Never-on-screen list edited');
async function addRefs(files) {
  const msg = $('#wl-refmsg'); let n = 0;
  for (const [i, f] of files.entries()) {
    try {
      if (msg) msg.textContent = `Adding ${i + 1} of ${files.length}...`;
      const ref = `reference:s-${Date.now().toString(36)}${i}`;
      await createArtifact(ref, { category: 'style', title: f.name, note: '' }, { why: 'Style reference added by the person' });
      await attachFile(ref, f, 'ref'); n++;
    } catch (e) { toast(`Could not add ${f.name}: ${errText(e)}`); }
  }
  if (n) refresh(); else if (msg) msg.textContent = '';
}
registerStep('look', {
  items: () => (look() ? [REFS.look] : []), html: htmlLook,
  bind(root) {
    const fi = $('#wl-ref', root); if (fi) fi.addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) addRefs(fs); });
    const ni = $('#wl-never', root); if (ni) ni.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-act=wl-never]', root).click(); } });
  },
  acts: {
    async 'wl-pick'(el) { const o = (ld().options || []).find((x) => x.id === el.dataset.id); if (!o) return; await ownEdit(REFS.look, (d) => ({ ...d, chosen: o.id, look: o.desc }), `Chose the look "${o.name}"`); return 'refresh'; },
    async 'wl-never'() { const v = ($('#wl-never').value || '').trim().slice(0, 40); if (!v) return toast('Write what must never be on screen.'); if (never().some((x) => x.toLowerCase() === v.toLowerCase())) return toast('That is in the list already.'); await setForbidden((l) => [...l, v]); return 'refresh'; },
    async 'wl-unnever'(el) { await setForbidden((l) => l.filter((_, i) => i !== +el.dataset.i)); return 'refresh'; },
    async 'wl-rmref'(el) { await ownEdit(el.dataset.ref, (d) => ({ ...d, removed: true }), 'Removed by the person'); return 'refresh'; },
  },
});
