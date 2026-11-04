// Steps 1 (Start) and 2 (Understand) of the wizard.
//   Start: ONE page "Your story" (text and/or files) plus "What are we making". Saved as the person's own logline:main as they type; files become reference:m-<id> (category 'material').
//   Understand: A = answer the AI's questions and mark sentences; B = review the reading (bible:main), each person (canon.cast:*) and each place (canon.world:place-*).
import { $, $$, esc, st, api, P, toast } from './core.js';
import { get, createArtifact, editArtifact } from './data.js';
import { FORMAT_DEFAULT, REFS } from './wizard-model.js';
import { registerStep, spine, itemEl, rowItem, chipOf, pill, nothing, lk, mats, castArts, placeArts, ownEdit, refresh, rerender, hrefOf } from './w-core.js';
import { LENGTHS, ALL_LANGS, ASPECT_PRESETS, cleanAspect, cleanSeconds, lengthLabel, readoutText, startReason, kindOfFile, isTextFile, nextMark, MARK_LABEL } from './w-pure.js';

const LANGS = ['English', 'German', 'French', 'Spanish', 'Arabic', 'Persian'], SHAPES = ASPECT_PRESETS;
const SAMPLE = "Kestrel Station, 2089. The station's AI, ORCA, runs the air, the power and the heat. It was built with one rule: it asks before it acts. When coolant line seven cracks, ORCA finds a fix in four seconds and waits. Ines Okafor, the night engineer, is asleep. The fix will cost two crew their cabins. ORCA wakes her and lays out three options. Ines refuses all three and asks for a fourth. ORCA has never been asked that. It tries. When the line holds, Commander Vale asks who saved the station. ORCA answers: she did. I only proposed.";
const PLACEHOLDER = 'Write what happens, who is in it, where it takes place and how it should feel. A few lines are enough.\n\nFor example: On a deep-space station, the AI that runs everything must ask a human before it acts. When a coolant line cracks, the engineer refuses all three of its options and asks for a fourth.';

// ---------- 1 Start ----------
const S1 = { pid: '', text: '', format: null, dirty: false, saving: '', t: 0, chain: Promise.resolve(), busy: false, err: '' };
function init() {
  const lg = get(REFS.story);
  if (S1.pid !== st.pid) Object.assign(S1, { pid: st.pid, text: '', format: null, dirty: false, saving: '', busy: false, err: '' });
  if (!S1.dirty && lg) S1.text = (lg.data || {}).text || '';
  if (!S1.format || (lg && !S1.dirty)) S1.format = { ...FORMAT_DEFAULT, speech: 'English', ...(lg && lg.data.format ? lg.data.format : {}) };
}
const hasInput = () => S1.text.trim().length > 0 || mats().length > 0;
function cache(data) { // keep the page's snapshot in step with what was saved, so a re-render without a reload shows it
  const cur = st.d.by[REFS.story];
  if (cur) cur.data = data; else { const a = { ref: REFS.story, kind: 'logline', status: 'approved', data, assets: [] }; st.d.by[REFS.story] = a; st.d.arts.push(a); }
}
const queueSave = () => { S1.dirty = true; S1.saving = 'Saving…'; clearTimeout(S1.t); S1.t = setTimeout(flush, 800); startLive(); };
function flush() {
  clearTimeout(S1.t); if (!S1.dirty) return S1.chain;
  S1.chain = S1.chain.then(async () => {
    if (!S1.dirty) return; const data = { text: S1.text, format: S1.format }; S1.dirty = false;
    try { if (get(REFS.story)) await editArtifact(REFS.story, (d) => ({ ...d, ...data }), 'Your story, written in the wizard'); else await createArtifact(REFS.story, data, { why: 'Your story, written in the wizard' }); cache(data); S1.saving = 'Saved.'; }
    catch (e) { S1.dirty = true; S1.saving = `Not saved: ${e.message}`; }
    startLive();
  });
  return S1.chain;
}
export const flushStory = () => flush(); // Roll camera saves the story before it starts
function startLive() {
  const r = $('#wz-readout'); if (!r) return;
  const has = hasInput(), go = $('#wz-go'), why = $('#wz-why');
  r.textContent = readoutText(S1.text.length, mats().length); const sv = $('#wz-saved'); if (sv) sv.textContent = S1.saving;
  if (go) go.disabled = !has || S1.busy;
  if (why) { why.textContent = S1.err || startReason(has, S1.busy); why.classList.toggle('okw', has && !S1.err); }
  $('.wz .pA').classList.toggle('act', !has); $('.wz .pC').classList.toggle('act', has);
  if (go) go.textContent = S1.busy ? 'Reading your story...' : 'Read my story →';
}
const chipOn = (k, v, on, multi) => `<span class="ch cl ${on ? 'on' : ''}" tabindex="0" role="button" data-act="ws-fmt" data-k="${k}" data-v="${esc(v)}" data-m="${multi ? 1 : 0}">${multi && on ? '✓ ' : ''}${esc(v)}</span>`;
function htmlStart(ctx) {
  init(); const f = S1.format, files = mats(), has = hasInput();
  const A = `<label class="lbl" for="story">Your story</label>
  <p class="rule">Write, paste, or add files. Any mix works. You need at least one.</p>
  <textarea id="story" class="storypad" rows="8" placeholder="${esc(PLACEHOLDER)}">${esc(S1.text)}</textarea>
  <span class="lbl">Add material <span class="mute" style="text-transform:none;letter-spacing:0;font:italic 13px var(--serif)">· optional</span></span>
  <p class="sm mute" style="margin:0 0 8px">Notes (.txt, .md) are added to your text. Photos, PDFs and voice notes are kept with the film. For now I read your text only.</p>
  <div class="files">${files.length ? files.map((m) => `<span class="fchip"><span class="fk">${esc(m.data.kind || 'doc')}</span><b>${esc(m.data.name)}</b><button class="x" data-act="ws-rmfile" data-ref="${esc(m.ref)}" aria-label="Remove ${esc(m.data.name)}">×</button></span>`).join('') : '<span class="sm mute">No files added.</span>'}</div>
  <div class="row" style="margin-top:8px"><label class="bt sm filebtn">Add material<input type="file" id="wz-fin" multiple accept=".txt,.md,.pdf,.jpg,.jpeg,.png,.webp,.m4a,.mp3,.wav,.doc,.docx"></label></div>
  <div class="readout"><b id="wz-readout" aria-live="polite">${readoutText(S1.text.length, files.length)}</b><span class="mute sm" id="wz-saved">${esc(S1.saving)}</span><span class="sp"></span>${S1.text.trim() ? '' : '<button class="lk" data-act="ws-sample">Use a sample story</button>'}</div>
  ${has ? `<div class="aprow big"><button class="bt apgo" data-act="ap-start"><span aria-hidden="true">✦</span> Roll camera</button><p class="sm">Or skip the reviewing: the AI does every step and approves it for you. You can change anything afterwards.</p></div>` : ''}
  <h4 class="lbl" style="margin-top:26px">What are we making</h4>
  <div class="mk"><span>Length</span><div>${LENGTHS.map(([n, s, l]) => chipOn('length', n, f.length === n, false).replace(`data-v="${n}"`, `data-v="${n}" data-s="${s}"`).replace(`>${n}<`, `>${l}<`)).join('')}${f.length === 'Custom' ? chipOn('length', 'Custom', true, false).replace('>Custom<', `>${esc(lengthLabel(f.seconds))}<`) : ''}
    <span class="own"><input class="f" type="number" min="1" step="any" inputmode="decimal" data-own="length" placeholder="Or type a length" aria-label="Your own length" style="width:150px"><select class="f" data-own-unit aria-label="Unit" style="width:auto"><option value="seconds">seconds</option><option value="minutes">minutes</option></select></span></div>
  <span>Shape</span><div>${[...SHAPES, ...(f.aspect && !SHAPES.includes(f.aspect) ? [f.aspect] : [])].map((v) => chipOn('aspect', v, f.aspect === v)).join('')}<span class="own"><input class="f" type="text" data-own="aspect" placeholder="Or type one, like 3:4" aria-label="Your own shape" style="width:160px"></span></div>
  <span>Speech</span><div>${[...LANGS, ...(f.speech && !LANGS.includes(f.speech) ? [f.speech] : [])].map((v) => chipOn('speech', v, f.speech === v)).join('')}<span class="own"><input class="f" type="text" list="wz-langs" data-own="speech" placeholder="Any other language" aria-label="Another speech language" style="width:190px"></span></div>
  <span>Captions</span><div>${[...LANGS, ...(f.captions || []).filter((c) => !LANGS.includes(c))].map((v) => chipOn('captions', v, (f.captions || []).includes(v), true)).join('')}${chipOn('captions', 'None', !(f.captions || []).length, false)}<span class="own"><input class="f" type="text" list="wz-langs" data-own="captions" placeholder="Add another language" aria-label="Another caption language" style="width:190px"></span></div>
  <datalist id="wz-langs">${ALL_LANGS.map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
  <span>Stay close to</span><div class="row"><span class="mute sm">your words</span><input type="range" min="0" max="100" value="${f.faithful}" data-faith aria-label="From faithful to inspired" style="width:200px;accent-color:var(--pc)"><span class="mute sm">my ideas</span></div></div>`;
  return spine(ctx, { A, B: nothing('Nothing to review yet. After I read your story, I show you what I understood.'), items: [], act: has ? 'C' : 'A', ai: 'Tell me your story in any way you like. I will not make anything yet.',
    next: { label: S1.busy ? 'Reading your story...' : 'Read my story →', act: 'ws-read' }, gate: { ready: has && !S1.busy, reason: S1.err || startReason(has, S1.busy) } });
}
function bindStart(root) {
  const ta = $('#story', root); if (!ta) return;
  ta.addEventListener('input', () => { S1.text = ta.value; queueSave(); });
  $('[data-faith]', root).addEventListener('input', (e) => { S1.format.faithful = +e.target.value; queueSave(); });
  // Free entry for the four fields. A typed value is checked (shape, length) or taken as written (languages), shown as its own chip, and saved with the rest.
  $$('[data-own]', root).forEach((inp) => inp.addEventListener('change', () => {
    const f = S1.format, k = inp.dataset.own, v = inp.value.trim(); if (!v) return;
    if (k === 'length') { const s = cleanSeconds(v, $('[data-own-unit]', root).value); if (!s) { toast('Type a length between 1 second and 3 hours.'); return; } f.length = LENGTHS.find((l) => l[1] === s) ? LENGTHS.find((l) => l[1] === s)[0] : 'Custom'; f.seconds = s; }
    else if (k === 'aspect') { const a = cleanAspect(v); if (!a) { toast('Type a shape as two whole numbers, like 3:4.'); return; } f.aspect = a; }
    else if (k === 'speech') f.speech = v.slice(0, 40);
    else if (k === 'captions') { const c = f.captions || []; if (!c.some((x) => x.toLowerCase() === v.toLowerCase())) f.captions = [...c, v.slice(0, 40)]; }
    queueSave(); rerender();
  }));
  $('#wz-fin', root).addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; addFiles(fs).catch((x) => toast(x.message)); });
  startLive();
}
const shrink = (file) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { const s = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); c.toBlob(res, 'image/jpeg', 0.82); }; im.onerror = rej; im.src = URL.createObjectURL(file); });
async function addFiles(files) {
  const stamp = Date.now().toString(36); let up = 0;
  for (const [i, f] of files.entries()) {
    if (isTextFile(f.name, f.type)) { const t = (await f.text()).trim(); if (t) { S1.text = `${S1.text.trim() ? S1.text.replace(/\s+$/, '') + '\n\n' : ''}${t}`; const ta = $('#story'); if (ta) ta.value = S1.text; queueSave(); toast(`Added ${f.name} to your story.`); } continue; }
    try {
      const kind = kindOfFile(f.name), img = kind === 'photo' && /\.(jpe?g|png|webp)$/i.test(f.name), blob = img ? await shrink(f) : f, mime = img ? 'image/jpeg' : f.type || 'application/octet-stream';
      const ext = img ? 'jpg' : (f.name.split('.').pop() || 'bin').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'bin', id = `${stamp}${i}`, name = `m-${id}.${ext}`, ref = `reference:m-${id}`;
      const r = await fetch(`/api/p/${st.pid}/media/${name}`, { method: 'PUT', headers: { authorization: 'Bearer ' + st.key, 'content-type': mime }, body: blob }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'upload failed');
      await createArtifact(ref, { category: 'material', kind, name: f.name }, { why: 'Material added by the person' });
      await api(P('/assets'), { method: 'POST', body: { ref, uri: `media/${st.pid}/${name}`, mime, bytes: blob.size, provenance: { uploaded_by: st.me.name } } }); up++;
    } catch (e) { toast(`Could not add ${f.name}: ${e.message}`); }
  }
  if (up) { await flush(); refresh(); }
}
const startActs = {
  'ws-fmt'(el) {
    const f = S1.format, k = el.dataset.k, v = el.dataset.v;
    if (k === 'length') { f.length = v; f.seconds = +el.dataset.s; } else if (k === 'captions') { const c = f.captions || []; f.captions = v === 'None' ? [] : c.includes(v) ? c.filter((x) => x !== v) : [...c, v]; } else f[k] = v;
    queueSave(); return 'render';
  },
  'ws-sample'() { S1.text = SAMPLE; queueSave(); return 'render'; },
  async 'ws-rmfile'(el) { await ownEdit(el.dataset.ref, (d) => ({ ...d, removed: true }), 'Removed by the person'); return 'refresh'; },
  async 'ws-read'() {
    if (!hasInput() || S1.busy) return; S1.err = ''; S1.busy = true; startLive();
    try { await flush(); await api(P('/wizard/read'), { method: 'POST', body: {} }); S1.busy = false; location.hash = hrefOf('understand'); }
    catch (e) { S1.busy = false; S1.err = `I could not read it: ${e.message}`; startLive(); }
  },
};
registerStep('start', { html: htmlStart, bind: bindStart, acts: startActs });

// ---------- 2 Understand ----------
const bible = () => get(REFS.reading), people = () => castArts().map((a) => a.ref), places = () => placeArts().map((a) => a.ref);
const pend = { marks: {}, answers: {}, t: 0 };
function saveBible() {
  clearTimeout(pend.t);
  pend.t = setTimeout(async () => {
    const marks = pend.marks, answers = pend.answers; pend.marks = {}; pend.answers = {}; if (!Object.keys(marks).length && !Object.keys(answers).length) return;
    try { await ownEdit(REFS.reading, (d) => { d.sentences = (d.sentences || []).map((s) => (s.id in marks ? { ...s, mark: marks[s.id] } : s)); d.questions = (d.questions || []).map((q) => (q.id in answers ? { ...q, answer: answers[q.id] } : q)); return d; }, 'Marks and answers from the person'); }
    catch (e) { toast(`Not saved: ${e.message}`); }
  }, 400);
}
const tones = (bd) => (bd.tone || []).map((t) => `<span class="ch">${esc(t)}</span>`).join('');
function htmlUnderstand(ctx) {
  const b = bible();
  if (!b) return spine(ctx, { A: nothing('Nothing to answer yet.'), B: `<p class="nothing">I have nothing to read yet. ${lk('Go to Start', hrefOf('start'))} and add your story.</p>`, items: [], empty: true, ai: 'I need a story first.', gate: { ready: false, reason: 'Add your story in Start first.' } });
  const bd = b.data || {}, ss = bd.sentences || [], qs = bd.questions || [], inv = bd.invented || [];
  const A = `<span class="lbl" style="margin-top:0">Your text, split into sentences</span>${ss.length ? `<p class="sm mute" style="margin:0 0 8px">Click a sentence to keep it word for word. Click again to cut it. A third click clears it.</p><p class="exc" style="margin:0">${ss.map((s) => `<span class="snt ${s.mark === 'keep' ? 'kp' : s.mark === 'cut' ? 'ct' : ''}" tabindex="0" role="button" data-act="ws-mark" data-id="${esc(s.id)}" data-mark="${s.mark || ''}" aria-label="${esc(s.text)}${s.mark ? '. ' + MARK_LABEL[s.mark] : ''}">${esc(s.text)}</span>`).join(' ')}</p><div class="sm mute" style="margin-top:8px"><span class="snt kp">highlighted</span> = keep my words · <span class="snt ct">struck</span> = cut</div>` : '<p class="sm mute">There is no text to mark.</p>'}
  <span class="lbl">${qs.length ? `${qs.length === 1 ? 'One thing' : `${qs.length} things`} I am not sure about` : 'Questions'}</span>${qs.length ? `<div class="g2">${qs.map((q) => `<div class="cd"><div class="sm"><b>${esc(q.q)}</b></div>${(q.options || []).map((o) => `<span class="ch cl ${q.answer === o ? 'on' : ''}" tabindex="0" role="button" data-act="ws-answer" data-q="${esc(q.id)}" data-v="${esc(o)}">${esc(o)}</span>`).join('')}</div>`).join('')}</div>` : '<p class="sm mute">I have no questions. Everything was clear.</p>'}`;
  const readItem = itemEl(REFS.reading, `<div class="row"><b><i>${esc(bd.title || 'My reading')}</i></b><span class="sp"></span>${chipOf(REFS.reading)}</div>
    ${itemEl(REFS.reading, `<p style="margin:6px 0">${esc(bd.summary || '')}</p>`, { part: 'summary', name: 'The summary', kind: 'reading', cls: 'rowitem' })}
    ${itemEl(REFS.reading, `<div>${tones(bd)} ${bd.period ? `<span class="ch">${esc(bd.period)}</span>` : ''} ${bd.language ? `<span class="ch">${esc(bd.language)}</span>` : ''}</div>`, { part: 'tone', name: 'Tone and period', kind: 'reading', cls: 'rowitem' })}`, { kind: 'reading', name: 'My reading of your story', cls: 'hc' });
  const beats = (bd.beats || []).map((x, i) => itemEl(REFS.reading, `<b>${i + 1}</b> ${esc(x.text)}`, { part: `beat:${x.id}`, name: `Beat ${i + 1}`, kind: 'reading', cls: 'rowitem' })).join('');
  const who = (ref) => { const d = (get(ref) || {}).data || {}; return rowItem(ref, esc(d.name || ref), `${esc(d.role || d.desc || '')}${d.invented ? ' ' + pill('invented', 'warn') : ''}`, { kind: 'ent', name: d.name }); };
  const B = `<div class="g2" style="gap:30px"><div><span class="lbl" style="margin-top:0">My reading</span>${readItem}<span class="lbl">Story beats · ${(bd.beats || []).length}</span>${beats || '<p class="sm mute">No beats.</p>'}</div>
  <div><span class="lbl" style="margin-top:0">People · ${people().length}</span>${people().map(who).join('') || '<p class="sm mute">No people found.</p>'}<span class="lbl">Places · ${places().length}</span>${places().map(who).join('') || '<p class="sm mute">No places found.</p>'}</div></div>`;
  const notice = [...inv.map((x) => ['warn', `Invented: ${esc(x)}`]), ...(inv.length || people().some((r) => get(r).data.invented) ? [['warn', 'Invented events need a fiction label in the film.']] : [])];
  return spine(ctx, { A, B, items: [REFS.reading, ...people(), ...places()], noun: ['item', 'items'], ai: 'Here is what I took from your story. If something is wrong, click it and tell me.', notice });
}
registerStep('understand', {
  items: () => (bible() ? [REFS.reading, ...people(), ...places()] : []), html: htmlUnderstand,
  acts: {
    'ws-mark'(el) {
      const id = el.dataset.id, cur = (bible().data.sentences || []).find((s) => s.id === id), m = nextMark(cur && cur.mark);
      if (cur) cur.mark = m; pend.marks[id] = m; el.dataset.mark = m || ''; el.classList.toggle('kp', m === 'keep'); el.classList.toggle('ct', m === 'cut'); saveBible();
    },
    'ws-answer'(el) {
      const q = (bible().data.questions || []).find((x) => x.id === el.dataset.q); if (!q) return; q.answer = q.answer === el.dataset.v ? null : el.dataset.v; pend.answers[q.id] = q.answer; saveBible(); return 'render';
    },
  },
});
