// The Meta models in the interface: Muse Image keyframes, a SAM 3.1 adherence check, Muse Spark doing the revising, Muse Voice Transcribe for spoken feedback.
// The key stays on the server; the page only asks the studio to call Meta.
import { $, esc, st, api, P, toast, tag, isHuman, mediaSrc } from './core.js';
import { get, editArtifact } from './data.js';
import { composePrompt } from './stage-math.js';

export async function loadMeta() { try { st.meta = await api('/meta/status'); } catch { st.meta = { configured: false }; } }
const on = () => !!(st.meta && st.meta.configured);
const keyOf = (ref) => ref.slice(ref.indexOf(':') + 1);

// ---- generation and the adherence check, shown on a shot page ----
export function metaCard(s, kf) {
  if (!isHuman()) return '';
  const stageRef = s.parent ? `stage:${keyOf(s.parent)}` : '', stage = get(stageRef), staged = !!(stage && (stage.data.shots || {})[s.ref]), exported = staged && (stage.assets || []).some((a) => a.provenance.shot === s.ref && a.provenance.role === 'layout');
  return `<details class="card" open><summary><b>Meta models</b> ${on() ? tag('connected', 'add') : tag('key not set', 'warn')} <span class="mute small">Muse Image makes the picture, SAM 3.1 checks it against the stage</span></summary>
  <div class="row"><button class="btn pri" data-act="metagen" data-shot="${esc(s.ref)}" ${on() ? '' : 'disabled'}>Generate with Muse Image</button><button class="btn" data-act="metaadh" data-shot="${esc(s.ref)}" ${on() && staged ? '' : 'disabled'}>Check adherence with SAM 3.1</button></div>
  <p class="mute small">${staged ? (exported ? `Uses the stage ${esc(stageRef)}: the flat layout and each character's anchor face go in as reference images.` : 'The stage has not been exported yet, so the prompt is built from its words only. Export the package in Staging for the best result.') : 'This shot is not staged, so Muse Image gets only the shot prompt.'} Each picture costs 1 credit.</p><div id="adh"></div></details>`;
}
const lastImage = (kf) => { const a = (kf.assets || []).filter((x) => x.provenance && x.provenance.transport === 'meta-image'); return a.length ? a[a.length - 1] : null; };

// ---- Muse Spark ----
export function agentCard() {
  if (!isHuman()) return '';
  return `<div class="card"><div class="row"><b>Let the AI work through your feedback</b>${on() ? tag('Muse Spark', 'add') : tag('key not set', 'warn')}<span class="sp"></span><button class="btn pri" data-act="metaagent" ${on() ? '' : 'disabled'}>Run the AI now</button></div>
  <p class="mute small">Muse Spark reads what is waiting for it, revises, and answers each thread. It can propose and reply; it cannot approve. You still see the diff and decide.</p><div id="agentout">${agentHtml()}</div></div>`;
}
const agentHtml = () => { const r = st.agentLast; if (!r) return ''; if (r.error) return `<p class="del">${esc(r.error)}</p>`; return `<ol class="small">${r.steps.map((x) => `<li class="${x.ok ? '' : 'del'}">${esc(x.summary)}</li>`).join('')}</ol><p>${esc(r.text || '(no summary)')}</p>${r.finished ? '' : '<p class="mute small">It hit its step limit; run it again to continue.</p>'}`; };
const draw = (rows, expected) => rows.map((r) => `<span class="abox ${r.verdict}" style="${r.found ? `left:${r.found[0] * 100}%;top:${r.found[1] * 100}%;width:${(r.found[2] - r.found[0]) * 100}%;height:${(r.found[3] - r.found[1]) * 100}%` : 'display:none'}"><i>${esc(r.id)}</i></span>`).join('') + expected.map((e) => `<span class="abox plan" style="left:${e.box[0] * 100}%;top:${e.box[1] * 100}%;width:${(e.box[2] - e.box[0]) * 100}%;height:${(e.box[3] - e.box[1]) * 100}%"></span>`).join('');

// ---- voice: record, make a 16 kHz mono WAV in the browser (the file endpoint only takes WAV), send it for transcription ----
let rec = null;
async function toWav(blob) {
  const ac = new AudioContext(), buf = await ac.decodeAudioData(await blob.arrayBuffer()), rate = 16000, off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * rate)), rate), src = off.createBufferSource();
  src.buffer = buf; src.connect(off.destination); src.start(); const d = (await off.startRendering()).getChannelData(0), out = new DataView(new ArrayBuffer(44 + d.length * 2)), w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + d.length * 2, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, d.length * 2, true);
  d.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true)); ac.close(); return new Blob([out.buffer], { type: 'audio/wav' });
}

export const acts = {
  async metagen(el) {
    const s = get(el.dataset.shot), id = keyOf(s.ref), stageRef = s.parent ? `stage:${keyOf(s.parent)}` : '', stage = get(stageRef), staged = stage && (stage.data.shots || {})[s.ref];
    const prompt = s.data.prompt || s.data.note || s.data.title || id; el.disabled = true; el.textContent = 'Generating…';
    try { await api(P('/tool-call'), { method: 'POST', body: { tool: 'muse-image', ref: `keyframe:${id}`, input: { prompt, ...(staged ? { stage: { ref: stageRef, shot: s.ref } } : {}) } } }); toast('Muse Image made a new picture. It is first in the list.'); }
    catch (e) { toast(/no enabled tool/.test(e.message) ? 'Register the Muse Image tool first (Tools tab)' : /budget/.test(e.message) ? 'Out of credits: add some in Credits' : e.message); }
    return 'refresh';
  },
  async metaadh(el) {
    const s = get(el.dataset.shot), id = keyOf(s.ref), kf = get(`keyframe:${id}`), a = kf && lastImage(kf), box = $('#adh');
    if (!a) return toast('Generate a picture first, or choose one with Use this on the board');
    box.innerHTML = '<p class="mute">SAM 3.1 is looking…</p>'; const r = await api(P('/meta/adherence'), { method: 'POST', body: { stage: `stage:${keyOf(s.parent)}`, shot: s.ref, uri: a.uri } });
    box.innerHTML = `<div class="ovl" style="position:relative;max-width:380px"><img src="${esc(mediaSrc(a.uri))}" alt="the generated picture" style="width:100%;display:block">${draw(r.rows, r.expected)}</div>
    <p><b>Adherence ${Math.round(r.score * 100)}%</b> <span class="mute small">dashed = where the stage put it, solid = where SAM found it</span></p><table>${r.rows.map((x) => `<tr><td>${esc(x.id)}</td><td><span class="st ${x.verdict === 'ok' ? 's-approved' : x.verdict === 'drift' ? 's-proposed' : 's-rejected'}">${esc(x.verdict)}</span></td><td>${esc(x.note)}</td></tr>`).join('')}</table>
    ${r.summary.length ? `<button class="btn pri sm" data-act="metaadhsend" data-shot="${esc(s.ref)}" data-notes="${esc(JSON.stringify(r.rows.filter((x) => x.verdict !== 'ok').map((x) => [x.id, x.note])))}">Send the drift to the AI as feedback</button>` : '<p class="why">The picture follows the stage.</p>'}`;
  },
  async metaadhsend(el) {
    const s = el.dataset.shot, stageRef = `stage:${keyOf(get(s).parent)}`;
    for (const [id, note] of JSON.parse(el.dataset.notes)) await api(P('/comments'), { method: 'POST', body: { ref: stageRef, body: `${note} (measured by SAM 3.1 on the latest picture)`, verdict: 'change', anchor: `obj:${id}`, context: s } });
    toast('Sent. The AI will see which objects drifted and by how much.'); return 'refresh';
  },
  async metaagent(el) {
    const box = $('#agentout'); el.disabled = true; el.textContent = 'Muse Spark is working…'; box.innerHTML = '<p class="mute">This can take up to a minute.</p>';
    try { st.agentLast = await api(P('/meta/agent'), { method: 'POST', body: {} }); } catch (e) { st.agentLast = { error: e.message }; }
    return 'refresh'; // the result is kept, so the refreshed page still shows it
  },
  async mic(el) {
    if (rec) { rec.stop(); return; }
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }), chunks = []; rec = new MediaRecorder(stream); el.textContent = 'Stop'; el.classList.add('rec');
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => { stream.getTracks().forEach((t) => t.stop()); rec = null; el.classList.remove('rec'); el.textContent = 'Transcribing…';
        try { const wav = await toWav(new Blob(chunks)), r = await fetch(`/api/p/${st.pid}/meta/transcribe`, { method: 'POST', headers: { authorization: 'Bearer ' + st.key, 'content-type': 'audio/wav' }, body: wav }), j = await r.json(); if (!r.ok) throw new Error(j.error); const ta = el.closest('.cmp').querySelector('textarea'); ta.value = `${ta.value ? ta.value + ' ' : ''}${j.transcript}`.trim(); toast('Transcribed. Edit it if needed, then send.'); }
        catch (e) { toast(e.message); } el.textContent = 'Speak'; };
      rec.start(); } catch { toast('The microphone is not available here'); rec = null; }
  },
  async regmuse() { await api('/tools', { method: 'POST', body: { name: 'muse-image', kind: 'image', transport: 'meta-image', target: { accepts: ['layout', 'prompt'] }, cost_model: { per_call: 1 } } }); toast('Muse Image registered at 1 credit a picture'); return 'refresh'; },
};
