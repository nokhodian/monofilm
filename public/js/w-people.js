// Step 4 People.  A = "Make faces" for each person (3 candidates, made in parallel).  B = per person: the three candidate faces (click one for the margin card; "Use this face" sets the anchor)
// and the voice as a second reviewable item (a description plus speed and energy; Meta has no voice generator, so the voice is words in the pack, with an optional sample recording).
// Items = every person (canon.cast) and every voice (canon.voice). Ready to go on = all approved AND every person has an anchor face.
import { $, $$, esc, api, P, toast, mediaSrc } from './core.js';
import { get } from './data.js';
import { R, keyOf } from './wizard-model.js';
import { registerStep, spine, itemEl, chipOf, pill, nothing, lk, castArts, statusOf, ownEdit, refresh, rerender, hrefOf } from './w-core.js';
import { registerFix } from './w-fix.js';
import { attachFile, errText, reviseEdit, assetsOf, srcOf } from './w-media.js';

const LET = ['A', 'B', 'C'];
const busy = {}; // person id -> { done, total, err, msg }
const people = () => castArts();
const cand = (a) => (a.data.candidates || []).slice().sort((x, y) => x.letter.localeCompare(y.letter));
const hasAnchor = (a) => !!a.data.anchor && (a.data.candidates || []).some((c) => c.id === a.data.anchor);
const voiceRef = (a) => R.voice(keyOf(a.ref));
const items = () => people().flatMap((a) => [a.ref, ...(get(voiceRef(a)) ? [voiceRef(a)] : [])]);

const progLine = (id) => { const b = busy[id]; if (!b) return ''; return b.err ? `<span class="wz-ppl-st err" role="alert">${esc(b.err)}</span>` : b.total ? `<span class="wz-ppl-st work" aria-live="polite">${b.wait ? 'Waiting for the faces before this one...' : `Making faces... ${b.done} of ${b.total} done`}</span>` : b.msg ? `<span class="wz-ppl-st">${esc(b.msg)}</span>` : ''; };
function paintBusy(id) { const el = $(`[data-wppl-prog="${CSS.escape(id)}"]`); if (el) el.innerHTML = progLine(id); const b = $(`[data-act=wppl-make][data-id="${CSS.escape(id)}"]`); if (b) b.disabled = !!(busy[id] && busy[id].total); }

const slider = (ref, k, label, lo, hi, v) => `<div class="wz-ppl-sl"><span>${label}</span><span class="mute">${lo}</span><input type="range" min="0" max="100" value="${v}" data-wppl-sl="${k}" data-ref="${esc(ref)}" aria-label="${label}"><span class="mute">${hi}</span></div>`;
function voiceHtml(a) {
  const ref = voiceRef(a), v = get(ref); if (!v) return '';
  const d = v.data, sample = assetsOf(ref).filter((x) => (x.mime || '').startsWith('audio/')).slice(-1)[0];
  return `<div class="wz-ppl-voice"><span class="lbl" style="margin-top:0">${esc(a.data.name)}'s voice</span>${itemEl(ref, `<div class="row"><b>${esc(d.desc || 'No description yet')}</b><span class="sp"></span>${chipOf(ref)}</div>
    <label class="sm mute" for="wv-${esc(keyOf(ref))}">How does ${esc(a.data.name)} sound?</label><textarea id="wv-${esc(keyOf(ref))}" data-wppl-desc data-ref="${esc(ref)}" maxlength="200">${esc(d.desc || '')}</textarea>
    ${slider(ref, 'speed', 'Speed', 'slow', 'fast', d.speed ?? 50)}${slider(ref, 'energy', 'Energy', 'calm', 'urgent', d.energy ?? 40)}
    ${sample ? `<audio class="wz-ppl-audio" controls preload="none" src="${esc(mediaSrc(sample.uri))}"></audio>` : ''}
    <div class="row" style="margin-top:6px"><label class="bt sm filebtn">${sample ? 'Replace the sample' : 'Add a voice sample'}<input type="file" data-wppl-voice data-ref="${esc(ref)}" accept="audio/*"></label><span class="sm mute">Optional. Meta has no voice generator: the voice is a description that goes into the pack.</span></div>`, { kind: 'voice', name: `${a.data.name}'s voice`, cls: 'hc' })}</div>`;
}
function faceHtml(a) {
  const cs = cand(a), byL = Object.fromEntries(cs.map((c) => [c.letter, c]));
  return LET.map((L) => {
    const c = byL[L]; if (!c) return `<div class="wz-ppl-face"><div class="pic none"><i>Face ${L} · not made</i></div></div>`;
    const on = a.data.anchor === c.id, src = srcOf(a.ref, c.id);
    return `<div class="wz-ppl-face">${itemEl(a.ref, `<div class="pic ${on ? 'on' : ''}">${src ? `<img src="${esc(src)}" alt="Face ${L} of ${esc(a.data.name)}">` : ''}${on ? '<em>main</em>' : ''}<i>Face ${L}</i></div>`, { part: `face:${L}`, kind: 'face', name: `${a.data.name} · face ${L}`, img: src, plain: true })}
      ${c.check && c.check.ok === false ? `<div class="sm wzp-bad" role="alert"><b>This may be wrong.</b> ${esc(c.check.problem || c.check.seen || '')} I drew it again once and it still looks off.</div>` : ''}
      <button class="bt sm wz-ppl-use ${on ? '' : 'pri'}" data-act="wppl-use" data-ref="${esc(a.ref)}" data-id="${esc(c.id)}" ${on ? 'disabled' : ''}>${on ? '✓ Main face' : 'Use this face'}</button></div>`;
  }).join('');
}
function htmlPeople(ctx) {
  const ps = people();
  if (!ps.length) return spine(ctx, { A: nothing('Nothing to do yet.'), B: `<p class="nothing">I found no people yet. ${lk('Go to Start', hrefOf('start'))} and let me read your story first.</p>`, items: [], empty: true, ai: 'I need to read your story first.', gate: { ready: false, reason: 'Let me read your story first (steps 1 and 2).' } });
  const A = `<span class="lbl" style="margin-top:0">Make faces</span><p class="sm mute" style="margin:0 0 6px">I make three faces for each person from the description. Each face costs 1 credit.</p>
    ${ps.map((a) => `<div class="wz-ppl-who"><div><b>${esc(a.data.name)}</b><div class="sm mute">${esc(a.data.role || '')}</div></div><div><button class="bt sm ${cand(a).length ? '' : 'pri'}" data-act="wppl-make" data-id="${esc(keyOf(a.ref))}" ${busy[keyOf(a.ref)] && busy[keyOf(a.ref)].total ? 'disabled' : ''}>${cand(a).length ? 'Make 3 new faces' : 'Make 3 faces'} · 3 credits</button><span data-wppl-prog="${esc(keyOf(a.ref))}">${progLine(keyOf(a.ref))}</span></div></div>`).join('')}
    <p class="sm mute" style="margin:8px 0 0">Voices need nothing from you. Change one on the right if it is wrong.</p>`;
  const B = ps.map((a) => `<div class="wz-ppl-card">${itemEl(a.ref, `<div class="cn"><b><i>${esc(a.data.name)}</i></b></div><div class="sm mute">${esc(a.data.role || '')}</div><div style="margin-top:4px">${a.data.invented ? pill('invented', 'warn') + ' ' : ''}${hasAnchor(a) ? pill('main face chosen', 'ok') : pill('choose a face', 'warn')}</div><div style="margin-top:6px">${chipOf(a.ref)}</div>`, { kind: 'face', name: a.data.name, cls: 'rowitem', img: srcOf(a.ref, a.data.anchor) })}
    <div><div class="wz-ppl-faces">${faceHtml(a)}</div>${cand(a).length ? '<p class="sm mute" style="margin:6px 0 0">Click a face to tell me what is off. Press "Use this face" to make it the main one.</p>' : '<p class="sm mute" style="margin:8px 0 0">No faces yet. Press "Make 3 faces" above.</p>'}${voiceHtml(a)}</div></div>`).join('');
  const missing = ps.filter((a) => !hasAnchor(a)), notice = [...(missing.length ? [['warn', `No main face yet for ${missing.map((a) => esc(a.data.name)).join(', ')}.`]] : [['ok', 'Every person has a main face.']]), ['warn', 'If you change a main face later, every picture built on it must be made again.']];
  const its = items(), sts = its.map(statusOf), todo = sts.filter((s) => s !== 'ok').length;
  const ready = !missing.length && todo === 0, reason = missing.length ? `Choose a main face for ${missing.map((a) => a.data.name).join(', ')}.` : todo ? `${todo} face or voice item${todo === 1 ? '' : 's'} still to review. Press "Looks right" on each or "Approve all".` : 'All faces and voices are approved.';
  return spine(ctx, { A, B, items: its, noun: ['face or voice', 'faces and voices'], ai: 'Make the faces first. Then choose one for each person and check each voice.', notice, gate: { ready, reason }, act: ps.some((a) => !cand(a).length) ? 'A' : undefined });
}

let queue = Promise.resolve(); // one person at a time (three faces of that person in parallel): many at once overload the studio
const one = async (id, v) => { try { return await api(P('/wizard/face'), { method: 'POST', body: { id, variant: v } }); } catch (e) { if (!/internal error|restarted/i.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 600)); return api(P('/wizard/face'), { method: 'POST', body: { id, variant: v } }); } };
function makeFaces(id) { const b = busy[id] = { done: 0, total: 3, err: '', wait: true }; paintBusy(id); const run = queue.then(() => doFaces(id, b)); queue = run.catch(() => {}); return run; }
async function doFaces(id, b) {
  b.wait = false; paintBusy(id);
  const res = await Promise.allSettled([0, 1, 2].map((v) => one(id, v).then((r) => { b.done++; paintBusy(id); return r; })));
  const bad = res.filter((r) => r.status === 'rejected');
  if (bad.length) b.err = errText(bad[0].reason) + (bad.length < 3 ? ` (${3 - bad.length} of 3 faces were made.)` : '');
  else { // three writes at once can overwrite each other's list: check, and redo any letter that went missing one by one
    for (let k = 0; k < 3; k++) {
      const a = await api(P('/artifacts/' + encodeURIComponent(R.cast(id)))), have = (a.data.candidates || []).map((c) => c.letter);
      const miss = [0, 1, 2].filter((v) => !have.includes(LET[v])); if (!miss.length) break;
      try { await api(P('/wizard/face'), { method: 'POST', body: { id, variant: miss[0] } }); } catch (e) { b.err = errText(e); break; }
    }
  }
  b.total = 0; if (!b.err) delete busy[id];
  refresh();
}
registerFix('face', {
  cost: 1,
  async run({ ref, part, instruction }) {
    const id = keyOf(ref), a = get(ref), mine = a && (a.data.candidates || []).find((c) => c.id === a.data.anchor), L = (part.split(':')[1] || (mine && mine.letter) || 'A'), variant = Math.max(0, LET.indexOf(L));
    await api(P('/wizard/face'), { method: 'POST', body: { id, variant, instruction } });
    await ownEdit(ref, (d) => ((d.candidates || []).some((c) => c.id === d.anchor) ? d : { ...d, anchor: null }), 'The main face was replaced, so it is no longer chosen'); // a replaced anchor must not dangle
    return `Made a new face ${L}.`;
  },
});
registerFix('voice', {
  cost: 0,
  async run({ ref, draft, name }) {
    const tags = (draft.tags || []).map((t) => `not ${t.toLowerCase()}`);
    await reviseEdit(ref, (d) => ({ ...d, speed: draft.v.speed ?? d.speed, energy: draft.v.energy ?? d.energy, desc: [d.desc, tags.length && tags.join(', '), draft.note].filter(Boolean).join('. ').slice(0, 200) }), 'Changed from your note');
    return `${name} updated. Please check it.`;
  },
});

registerStep('people', {
  items: () => items(), html: htmlPeople,
  bind(root) {
    $$('[data-wppl-desc]', root).forEach((t) => t.addEventListener('change', () => save(t.dataset.ref, { desc: t.value.trim().slice(0, 200) })));
    $$('[data-wppl-sl]', root).forEach((s) => s.addEventListener('change', () => save(s.dataset.ref, { [s.dataset.wpplSl]: +s.value })));
    $$('[data-wppl-voice]', root).forEach((f) => f.addEventListener('change', async (e) => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      try { await attachFile(f.dataset.ref, file, 'voice'); toast('Voice sample added.'); refresh(); } catch (x) { toast(`Could not add the sample: ${errText(x)}`); }
    }));
  },
  acts: {
    'wppl-make'(el) { const id = el.dataset.id; if (busy[id] && busy[id].total) return; makeFaces(id).catch((e) => { busy[id] = { total: 0, err: errText(e) }; paintBusy(id); }); },
    async 'wppl-use'(el) { await ownEdit(el.dataset.ref, (d) => ({ ...d, anchor: el.dataset.id }), 'Chose the main face'); return 'refresh'; },
  },
});
async function save(ref, patch) { try { await ownEdit(ref, (d) => ({ ...d, ...patch }), 'Voice edited in the wizard'); refresh(); } catch (e) { toast(`Not saved: ${errText(e)}`); } }
