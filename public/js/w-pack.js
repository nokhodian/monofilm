// Step 6, sub-page Pack (one scene). The words, pictures and files one outside video generator needs for this scene, built by pack.js.
//   A  what the generator can take (target, longest clip) + bring a finished clip back (upload, then the first/last frame check)
//   B  what is missing, the files per clip (prompt read-only: it lives in the Brief), the scene .zip, and the takes that came back (reviewable, kind 'take')
// The clip split, the prompt text and the anchor-picture source are decided in the Brief; here they are shown read-only with a link.
// Also exports the helpers Ship uses (settings, filmOf, sceneInput, fetchBytes, saveBlob).
import { $, esc, st, api, P, toast, mediaSrc, copyText } from './core.js';
import { get, ofKind, threads } from './data.js';
import { R, TARGETS, MAX_CLIP, ANCHOR_MODES, REFS, clipPlan, composeClip, sceneReadiness, startOf, hasEnd, keyOf } from './wizard-model.js';
import { sceneEntries, buildZip, hashOf, similarity, sceneDir, tailHold, smoothness } from './pack.js';
import { head as sceneHead } from './w-stage.js';
import { registerSub } from './w-scenes.js';
import { registerFix } from './w-fix.js';
import { itemEl, chipOf, pill, nothing, lk, hrefOf, ownEdit, spine, refresh , hrefIn } from './w-core.js';

// ---------- the person's settings for this production (kept in the browser) ----------
const SKEY = () => `mf-pack-${st.pid}`;
export const settings = () => { let s = {}; try { s = JSON.parse(localStorage.getItem(SKEY()) || '{}'); } catch { /* ignore */ } return { target: 'both', max: MAX_CLIP, srt: true, review: false, staging: false, backup: false, ...s }; };
export const setSettings = (patch) => localStorage.setItem(SKEY(), JSON.stringify({ ...settings(), ...patch }));

// ---------- what the pack builder reads from the studio ----------
const assetUri = (ref, id) => { const a = get(ref), x = a && (a.assets || []).find((y) => y.id === id); return x ? x.uri : null; };
export function filmOf() {
  const prod = (st.prods || []).find((p) => p.id === st.pid) || {}, fmt = ((get(REFS.story) || {}).data || {}).format || {}, look = ((get(REFS.look) || {}).data) || {};
  const anchors = ofKind('canon.cast').map((a) => ({ id: keyOf(a.ref), name: a.data.name, uri: assetUri(a.ref, a.data.anchor) })).filter((a) => a.uri);
  const plates = ofKind('canon.world').map((a) => ({ id: keyOf(a.ref), name: a.data.name, uri: assetUri(a.ref, a.data.anchor || a.data.chosen) })).filter((a) => a.uri);
  const cast = Object.fromEntries(ofKind('canon.cast').map((a) => [a.ref, { name: a.data.name, desc: a.data.desc || '' }]));
  return { name: prod.name || 'film', look, speech: fmt.speech || '', captions: fmt.captions || [], anchors, plates, cast };
}
export const clipsOf = (sc, max = settings().max) => { const d = sc.data || {}; return d.clips && d.clips.length ? d.clips : clipPlan(d.seconds, max); };
export function sceneInput(sc, film = filmOf()) {
  const id = keyOf(sc.ref), d = sc.data, frames = {}, n = clipsOf(sc).length;
  for (let i = 1; i <= n; i++) for (const w of ['start', 'end']) { const f = get(R.frame(id, i, w)), u = f && f.data && f.data.chosen ? assetUri(f.ref, f.data.chosen) : null; if (u) frames[`${i}-${w}`] = u; }
  const stage = ((get(R.stage(id)) || {}).assets || []).filter((a) => a.provenance && a.provenance.role).map((a) => ({ role: a.provenance.role, uri: a.uri, shot: a.provenance.shot || null }));
  const anchors = (d.who || []).map((w) => film.anchors.find((a) => a.id === keyOf(w))).filter(Boolean);
  return { ref: sc.ref, data: d, frames, stage, anchors };
}
export const takesOf = (id) => ofKind('take').filter((t) => (t.data || {}).scene === id).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
export async function fetchBytes(uri) {
  const r = await fetch(mediaSrc(uri), { credentials: 'include', headers: { authorization: 'Bearer ' + st.key } });
  return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
}
export function saveBlob(name, bytes, type = 'application/zip') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
export const rctx = () => ({ get, assets: (ref) => (get(ref) || {}).assets || [] });

// ---------- the frame check: does the clip that came back start and end like the anchor pictures? ----------
const grab = (img, w = 64, h = 64) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h); return hashOf(x.getImageData(0, 0, w, h).data, w, h); };
const grey = (img, w = 32, h = 32) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h); const p = x.getImageData(0, 0, w, h).data, g = []; for (let i = 0; i < p.length; i += 4) g.push(0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]); return g; };
const loadImg = (uri) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = mediaSrc(uri); });
const seek = (v, t) => new Promise((res) => { const done = () => { v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); v.currentTime = t; setTimeout(done, 4000); });
async function frameCheck(file, startUri, endUri) {
  const url = URL.createObjectURL(file), v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('I could not open that video.')); });
    const out = { first: null, last: null, hold: null, smooth: null };
    if (startUri) { await seek(v, 0); out.first = similarity(grab(v), grab(await loadImg(startUri))); }
    if (endUri) { let d = v.duration; if (!isFinite(d)) { await seek(v, 1e6); d = v.currentTime; } await seek(v, Math.max(0, d - 0.05)); out.last = similarity(grab(v), grab(await loadImg(endUri))); }
    let d = v.duration; if (!isFinite(d)) { await seek(v, 1e6); d = v.currentTime; }
    if (d > 0.6) { // a small picture every 0.2 s, to see whether the clip jumps and whether it stands still at the end
      const all = []; for (let t = 0.1; t < d - 0.1; t += 0.2) { await seek(v, t); all.push({ t, g: grey(v) }); } await seek(v, d - 0.05); all.push({ t: d - 0.05, g: grey(v) });
      const step = (a, b) => a.g.reduce((s, x, i) => s + Math.abs(x - b.g[i]), 0) / a.g.length;
      out.smooth = smoothness(all.slice(1).map((s, i) => step(all[i], s)));
      out.hold = tailHold(all.filter((s) => s.t >= d - 4).reverse(), d);
    }
    return out;
  } finally { URL.revokeObjectURL(url); }
}
// Which anchor pictures does clip n have to match? Same rule as pack.js: only the first clip (or a cut) has a start picture, only the last clip an end picture.
export function anchorsFor(sc, n) {
  const id = keyOf(sc.ref), d = sc.data, from = startOf(d, n), uri = (f) => (f && f.data && f.data.chosen ? assetUri(f.ref, f.data.chosen) : null);
  const start = from === 'start' || from === 'own' ? uri(get(R.frame(id, n, 'start'))) : from === 'prev-end' ? uri(get(R.frame(id, n - 1, 'end'))) : null;
  return { start, end: hasEnd(d) ? uri(get(R.frame(id, n, 'end'))) : null };
}

// ---------- plain words for each file ----------
const WHAT = [[/prompt\.txt$/, 'The words for the generator.'], [/negative\.txt$/, 'What it must not show.'], [/clip\.json$/, 'Settings for this clip: length, shape, where it starts.'], [/\/start\./, 'Start picture. The clip begins here.'], [/\/end\./, 'End picture. The clip should arrive here.'],
  [/stage\/layout/, 'Stage control: where everyone stands.'], [/stage\/depth/, 'Stage control: how far away things are.'], [/stage\/ids/, 'Stage control: which shape is which person.'], [/stage\/pose/, 'Stage control: the poses.'], [/stage\/camera/, 'Stage control: the camera.'], [/stage\//, 'Stage control.'],
  [/refs\//, 'A picture of a person, so the generator keeps the face.'], [/brief\.md$/, 'Your brief, for reading.'], [/transcript\.json$/, 'Every spoken line, with who says it.'], [/transcript\.srt$/, 'Captions for this scene.']];
const what = (p) => (WHAT.find(([re]) => re.test(p)) || [0, ''])[1];
const startWords = { stage: 'the stage picture', chain: "the previous scene's last picture", own: 'your own picture', skip: 'no start picture' }, endWords = { stage: 'the stage picture', chain: 'the next scene', own: 'your own picture', skip: 'no end picture' };
const modeName = (m) => (ANCHOR_MODES.find((x) => x[0] === m) || [0, m])[1];
const F = { busy: '', missing: {}, msg: {} }; // missing files of the last scene zip, and the live line under each clip's file picker

function whatsMissing(sc, s) {
  const r = sceneReadiness(sc, rctx()), id = keyOf(sc.ref), out = [];
  const add = (ok, label, sub) => { if (!ok) out.push(lk(`${label}`, hrefOf('scenes', id, sub))); };
  add(r[0] === 2, 'The brief is not finished or approved', 'brief');
  if (s.target === 'both' || s.target === 'start' || s.target === 'refs') add(r[2] === 2, 'The start or end picture is not chosen', 'pictures');
  if (s.target !== 'text') add(r[1] > 0, 'No stage yet', 'stage');
  add(r[3] === 2, 'The spoken lines are not finished', 'sound');
  return out;
}

// ---------- the page ----------
function htmlPack(ctx) {
  const sc = get(R.scene(ctx.scene)); if (!sc) return spine(ctx, { A: nothing('This scene does not exist.'), B: nothing(), items: [], empty: true, gate: { ready: false, reason: 'Choose a scene in the contents.' } });
  const s = settings(), film = filmOf(), inp = sceneInput(sc, film), d = sc.data, id = ctx.scene, clips = clipsOf(sc), entries = sceneEntries(film, inp, { target: s.target, max: s.max }), takes = takesOf(id);
  const chip = (act, k, v, label, on) => `<span class="ch cl ${on ? 'on' : ''}" tabindex="0" role="button" data-act="${act}" data-v="${esc(v)}" aria-pressed="${on}">${esc(label)}</span>`;
  const plan = `${d.seconds} s, ${clips.length === 1 ? 'one clip' : `${clips.length} clips`} (${clips.map((c) => c.seconds + ' s').join(' + ')})`;
  const multi = clips.length > 1, cur = ctx.clip, up = clips.map((c, i) => { const n = i + 1, ts = takes.filter((t) => t.data.clip === n); if (multi && n !== cur) return ''; return `<div class="wzp-up" data-drop="${n}"><b>Clip ${n}</b><span class="sm mute">${c.seconds} s · ${ts.length ? `${ts.length} take${ts.length === 1 ? '' : 's'} back` : 'nothing back yet'}</span><span class="sp"></span><label class="bt sm filebtn">Choose the clip file<input type="file" accept="video/*" data-wp-file="${n}"></label><span class="sm wzp-msg" id="wp-msg-${n}" aria-live="polite">${esc(F.msg[`${id}-${n}`] || '')}</span></div>`; }).join('');
  const A = `<span class="lbl" style="margin-top:0">What can your generator take?</span>
  <p class="sm mute" style="margin:0 0 8px">This trims the pack to what it accepts, so you are never handed files it will refuse.</p>
  <div>${TARGETS.map(([k, l]) => chip('wp-target', 'target', k, l, s.target === k)).join('')}</div>
  <span class="lbl">Its longest clip</span>
  <div>${[5, 8, 10].map((m) => chip('wp-max', 'max', String(m), `${m} s`, s.max === m)).join('')}</div>
  <p class="sm mute" style="margin:2px 0 0">The split into clips is decided in the Brief, not here. This scene: ${esc(plan)}. Starts from ${esc(startWords[(d.start || {}).mode] || modeName((d.start || {}).mode))}, ends on ${esc(endWords[(d.end || {}).mode] || modeName((d.end || {}).mode))}. ${lk('Change in Brief', hrefOf('scenes', id, 'brief'))}</p>
  <span class="lbl">Bring the result back</span>
  <p class="sm mute" style="margin:0 0 8px">Make each clip in your generator from the files below. Then choose the file it made. I check that its first and last picture still match yours, and keep it as a take. Clips up to 25 MB.</p>
  <div class="wzp-ups">${up}</div>`;

  const miss = whatsMissing(sc, s), mf = F.missing[id] || [];
  const checklist = `<span class="lbl" style="margin-top:0">What is missing</span><div id="wp-checklist">${miss.length ? miss.map((m) => `<span class="ch wzp-miss">${m}</span>`).join('') : pill('Nothing is missing', 'ok')}${mf.length ? `<div class="sm wzp-bad">These files could not be read and are not in the zip: ${mf.map((x) => `<code>${esc(x)}</code>`).join(', ')}</div>` : ''}</div>`;

  const perClip = clips.map((c, i) => {
    if (multi && i + 1 !== cur) return `<div class="cd wzp-clip wzp-other"><h5>Clip ${i + 1} of ${clips.length} · ${c.seconds} s</h5><p class="sm mute" style="margin:0">${lk(`Open clip ${i + 1}`, hrefIn(ctx, 'pack', i + 1))}</p></div>`;
    const n = i + 1, pre = `${sceneDir(inp)}/clip-${String(n).padStart(2, '0')}/`, mine = entries.filter((e) => e.path.startsWith(pre)), p = mine.find((e) => e.path.endsWith('prompt.txt')), ng = mine.find((e) => e.path.endsWith('negative.txt')), cj = mine.find((e) => e.path.endsWith('clip.json'));
    return `<div class="cd wzp-clip"><h5>Clip ${n} of ${clips.length} · ${c.seconds} s${n > 1 ? ` · ${c.join === 'cut' ? 'a cut' : 'continues the clip before'}` : ''}</h5>
    <div class="man">${mine.map((e) => `<div class="dleader"><b>${esc(e.path.slice(pre.length))}</b><span class="mute">${esc(what(e.path))}</span></div>`).join('')}</div>
    <span class="lbl">The prompt</span><pre class="wzp-pre" id="wp-pr-${n}">${esc(p ? p.text : '')}</pre>
    <span class="lbl">Must not show</span><pre class="wzp-pre">${esc(ng && ng.text ? ng.text : 'Nothing special.')}</pre>
    <div class="row"><button class="bt sm" data-act="wp-copy" data-n="${n}">Copy prompt</button><button class="bt sm" data-act="wp-copyman" data-n="${n}">Copy clip.json</button><span class="sp"></span><span class="sm mute">The words live in the Brief.</span> ${lk('Change in Brief', hrefOf('scenes', id, 'brief'))}</div>
    <details class="wzp-det"><summary class="sm">clip.json</summary><pre class="wzp-pre">${esc(cj ? cj.text : '')}</pre></details></div>`;
  }).join('');
  const sceneFiles = entries.filter((e) => !/\/clip-\d\d\//.test(e.path)).map((e) => `<div class="dleader"><b>${esc(e.path.split('/').pop())}</b><span class="mute">${esc(what(e.path))}</span></div>`).join('');

  const open = (t) => threads(t.ref).filter((c) => c.status === 'open' && !c.parent && c.verdict === 'change');
  const tk = takes.filter((t) => !multi || t.data.clip === cur).map((t) => { const src = t.assets && t.assets[0] ? mediaSrc(t.assets[0].uri) : '', f = t.data.first, l = t.data.last;
    return itemEl(t.ref, `<div class="wzp-take"><video controls preload="metadata" playsinline src="${esc(src)}"></video><div class="ri"><b>Clip ${t.data.clip} · take ${esc(t.ref.slice(-1).toUpperCase())}</b> ${t.data.picked ? pill('in use', 'ok') : ''}
      <div class="sm">${f === null || f === undefined ? '<span class="mute">First frame: there is no start picture to compare.</span>' : `How much the first frame matches your start picture: <b>${f}%</b>`}</div>
      <div class="sm">${l === null || l === undefined ? '<span class="mute">Last frame: there is no end picture to compare.</span>' : `How much the last frame matches your end picture: <b>${l}%</b>`}</div>
      ${t.data.cuts ? `<div class="sm wzp-bad"><b>It has ${t.data.cuts} hard cut${t.data.cuts === 1 ? '' : 's'}.</b> It should be one continuous shot.</div>` : ''}${t.data.seed != null ? `<div class="sm mute">Seed ${t.data.seed}</div>` : ''}
      ${t.data.hold ? `<div class="sm wzp-bad"><b>It stands still for the last ${t.data.hold} s.</b> The end picture was reached early and then held. See "Suggested change" below.</div>` : ''}
      ${t.data.smooth && t.data.smooth.flag ? `<div class="sm wzp-bad"><b>It jumps at about ${t.data.smooth.at} s.</b> A cut or a morph: one step is ${t.data.smooth.max}, the clip's usual step is ${t.data.smooth.median}. See "Suggested change" below.</div>` : ''}
      <div class="row" style="margin-top:6px">${chipOf(t.ref)}${t.data.picked ? '' : `<button class="bt sm" data-act="wp-use" data-ref="${esc(t.ref)}">Use this take</button>`}</div></div></div>`, { kind: 'take', name: `Clip ${t.data.clip} take ${t.ref.slice(-1).toUpperCase()}`, cls: 'dn hc' }); }).join('');
  const sug = takes.flatMap((t) => open(t).map((c) => ({ t, c }))).map(({ t, c }) => { const p = (composeClip(sc, film, t.data.clip) || {}).prompt || ''; return `<div class="cd"><div class="sm"><b>Clip ${t.data.clip} · take ${esc(t.ref.slice(-1).toUpperCase())}</b> · ${esc(c.author)} asked for a change</div><pre class="wzp-pre">${esc(`${p}\nAlso: ${c.body || ''}`.trim())}</pre><div class="row"><button class="bt sm acc" data-act="wp-add" data-id="${esc(c.id)}" data-text="${esc(c.body || '')}">Add to the Brief notes</button><span class="sm mute">Adds "Also: ..." to What happens. Nothing is generated here.</span></div></div>`; }).join('');
  const holdSug = takes.filter((t) => t.data.hold).map((t) => { const text = `Last time the end picture was held still for about ${t.data.hold} s. Spread the action over the whole clip so it lands on the very last frame, with no pause.`; return `<div class="cd"><div class="sm"><b>Clip ${t.data.clip} · take ${esc(t.ref.slice(-1).toUpperCase())}</b> · it stands still for the last ${t.data.hold} s</div><pre class="wzp-pre">${esc(`${(composeClip(sc, film, t.data.clip) || {}).prompt || ''}\nAlso: ${text}`.trim())}</pre><div class="row"><button class="bt sm acc" data-act="wp-add" data-text="${esc(text)}">Add this to the Brief notes</button><span class="sm mute">Then make the clip again in your generator, or trim the end in your editor.</span></div></div>`; }).join('');
  const jumpSug = takes.filter((t) => t.data.smooth && t.data.smooth.flag).map((t) => { const text = `Last time the clip jumped at about ${t.data.smooth.at} s, like a cut or a morph. Make it one continuous shot: the same place, light and framing from the first frame to the last, with no cut and no new events.`; return `<div class="cd"><div class="sm"><b>Clip ${t.data.clip} · take ${esc(t.ref.slice(-1).toUpperCase())}</b> · it jumps at about ${t.data.smooth.at} s</div><pre class="wzp-pre">${esc(`${(composeClip(sc, film, t.data.clip) || {}).prompt || ''}\nAlso: ${text}`.trim())}</pre><div class="row"><button class="bt sm acc" data-act="wp-add" data-text="${esc(text)}">Add this to the Brief notes</button><span class="sm mute">Then make the clip again, ideally with a few seeds, and keep the smoothest.</span></div></div>`; }).join('');
  const B = `${checklist}<span class="lbl">The files for this scene</span><p class="sm mute" style="margin:0 0 6px">The pack holds the prompt, what must not show, pictures, stage controls, the spoken lines with captions, and a manifest. Meta has no video or voice generator, so the pack has no video and no audio.</p>
  <div class="man">${sceneFiles}</div>${perClip}
  <div class="row" style="margin:10px 0"><button class="bt sm acc" data-act="wp-zip">Download this scene · .zip</button><button class="bt sm" data-act="wp-copyall">Copy every prompt of this scene</button><span class="sm mute" id="wp-zipmsg">${F.busy === id ? 'Building the zip...' : ''}</span></div>
  <span class="lbl">Takes that came back${multi ? ` for clip ${cur}` : ''}${takes.length ? ` · ${takes.filter((t) => !multi || t.data.clip === cur).length}` : ''}</span>${tk || '<p class="nothing">Nothing to review yet. When your generator has made a clip, bring it back above.</p>'}
  ${sug || holdSug || jumpSug ? `<span class="lbl">Suggested change</span>${holdSug}${jumpSug}${sug}` : ''}`;
  return spine(ctx, { head: sceneHead(ctx), A, B, items: takes.map((t) => t.ref), noun: ['take', 'takes'], act: takes.length ? undefined : 'A', ai: 'Here is everything your generator needs for this scene. I cannot make the video or the voice myself. Bring the clip back and I will check it.',
    ...(takes.length ? {} : { gate: { ready: true, reason: 'Nothing to review yet. You can carry on.' } }) });
}

// ---------- doing things ----------
const curScene = () => decodeURIComponent(location.hash.split('/')[3] || '');
const promptOf = (sc, n) => composeClip(sc, filmOf(), n);
async function bringBack(id, n, file) {
  const sc = get(R.scene(id)), key = `${id}-${n}`, say = (t) => { F.msg[key] = t; const m = $(`#wp-msg-${n}`); if (m) m.textContent = t; };
  if (!sc || !file) return;
  if (file.size > 25 * 1024 * 1024) return say('That file is over 25 MB. Make it smaller and try again.');
  try {
    say('Checking the first and last picture, and the end...');
    const a = anchorsFor(sc, n), chk = await frameCheck(file, a.start, a.end).catch((e) => { toast(`I could not compare the pictures: ${e.message}`); return { first: null, last: null, hold: null, smooth: null }; });
    say('Uploading...');
    const ext = /\.webm$/i.test(file.name) ? 'webm' : 'mp4', name = `take-${id.slice(0, 40)}-c${n}-${Date.now().toString(36)}.${ext}`.replace(/[^A-Za-z0-9._-]/g, '-');
    const r = await fetch(`/api/p/${st.pid}/media/${name}`, { method: 'PUT', headers: { authorization: 'Bearer ' + st.key, 'content-type': file.type || 'video/mp4' }, body: file });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'upload failed');
    await api(P('/wizard/take'), { method: 'POST', body: { scene: id, clip: n, uri: `media/${st.pid}/${name}`, first: chk.first, last: chk.last, hold: chk.hold, smooth: chk.smooth, note: '' } });
    say('Saved as a take.'); toast(`Clip ${n} is back as a new take.`); refresh();
  } catch (e) { say(`It did not work: ${e.message}`); }
}
function bindPack(root, ctx) {
  root.querySelectorAll('[data-wp-file]').forEach((i) => i.addEventListener('change', () => { const f = i.files[0]; i.value = ''; bringBack(ctx.scene, +i.dataset.wpFile, f); }));
  root.querySelectorAll('[data-drop]').forEach((z) => {
    z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); }); z.addEventListener('dragleave', () => z.classList.remove('over'));
    z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) bringBack(ctx.scene, +z.dataset.drop, f); });
  });
}
const packActs = {
  'wp-target'(el) { setSettings({ target: el.dataset.v }); return 'render'; },
  'wp-max'(el) { setSettings({ max: +el.dataset.v }); return 'render'; },
  'wp-copy'(el) { const sc = get(R.scene(curScene())); return copyText(promptOf(sc, +el.dataset.n).prompt, 'Prompt copied.'); },
  'wp-copyman'(el) { const sc = get(R.scene(curScene())), n = +el.dataset.n, e = sceneEntries(filmOf(), sceneInput(sc), { target: settings().target, max: settings().max }).find((x) => x.path.endsWith(`clip-${String(n).padStart(2, '0')}/clip.json`)); return copyText(e ? e.text : '', 'clip.json copied.'); },
  'wp-copyall'() { const sc = get(R.scene(curScene())), f = filmOf(); return copyText(clipsOf(sc).map((c, i) => `Clip ${i + 1} of ${clipsOf(sc).length}\n${composeClip(sc, f, i + 1).prompt}\nMust not show: ${composeClip(sc, f, i + 1).negative || 'nothing special'}`).join('\n\n'), 'Prompts copied.'); },
  async 'wp-zip'() {
    const id = curScene(), sc = get(R.scene(id)); if (!sc || F.busy) return; F.busy = id; const m = $('#wp-zipmsg'); if (m) m.textContent = 'Building the zip...';
    try {
      const s = settings(), { bytes, missing } = await buildZip(sceneEntries(filmOf(), sceneInput(sc), { target: s.target, max: s.max }), fetchBytes);
      F.missing[id] = missing; saveBlob(`${sceneDir(sc)}.zip`, bytes); toast(missing.length ? `Downloaded. ${missing.length} file${missing.length === 1 ? '' : 's'} could not be read.` : 'Downloaded.');
    } catch (e) { toast(`I could not build the zip: ${e.message}`); }
    F.busy = ''; return 'render';
  },
  async 'wp-use'(el) {
    const t = get(el.dataset.ref); if (!t) return;
    for (const o of takesOf(t.data.scene).filter((x) => x.data.clip === t.data.clip)) { const want = o.ref === t.ref; if (!!o.data.picked !== want) await ownEdit(o.ref, (d) => ({ ...d, picked: want }), want ? 'Chosen as the take in use' : 'Another take was chosen'); }
    toast('This take is now the one in use.'); return 'refresh';
  },
  async 'wp-add'(el) {
    const id = curScene(), text = (el.dataset.text || '').trim(); if (!text) return;
    await ownEdit(R.scene(id), (d) => { const n = d.notes || {}, w = String(n.happens || '').trim(); return { ...d, notes: { ...n, happens: `${w}${w ? '\n' : ''}Also: ${text}` } }; }, 'Added from a take that needed a change');
    try { await api(P(`/comments/${el.dataset.id}`), { method: 'POST', body: { resolved: true } }); } catch { /* the note stays open */ }
    toast('Added to the Brief notes. Open the Brief to check it.'); return 'refresh';
  },
};
registerFix('take', { cost: 0, run: async () => 'Saved. See "Suggested change" on this page. Nothing is generated here: make the clip again in your generator.' });
registerSub('pack', { items: (ctx) => takesOf(ctx.scene).map((t) => t.ref), html: htmlPack, bind: bindPack, acts: packActs });
