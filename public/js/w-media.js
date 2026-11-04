// Small helpers shared by the Look, People and Places steps: plain-words errors, picture/audio upload, a "propose, keep in review" edit, and a picture finder.
import { st, api, P, mediaSrc } from './core.js';
import { get } from './data.js';

// The API answers with a short English reason; say what to do about it.
export function errText(e) {
  const m = String((e && e.message) || e || '');
  if (/over budget|credits|402/i.test(m)) return 'This production has used up its credit budget. That is the spending limit set inside Monofilm, not your Meta balance. Ask the person who runs this studio to add credits (the \"+ Credits\" button at the top, if you see it), then try again.';
  if (/MODEL_API_KEY|Muse Image is off/i.test(m)) return 'The picture maker is switched off because MODEL_API_KEY is not set on the server. Ask whoever runs the studio to set it.';
  if (/approve the look/i.test(m)) return 'Approve the look first (step 3). Every picture is made from it.';
  if (/does not exist yet/i.test(m)) return 'This item is not there yet. Go back one step and let me read your story first.';
  if (/failed to fetch|network/i.test(m)) return 'I could not reach the studio. Check your connection and try again.';
  return `Something went wrong: ${m}`;
}

const shrink = (file) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { const s = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); c.toBlob(res, 'image/jpeg', 0.82); }; im.onerror = () => rej(new Error('that file is not a picture I can open')); im.src = URL.createObjectURL(file); });

// Store a file as R2 media and attach it to an artifact. Pictures are shrunk to 1600 px. Returns the new asset { id, uri }.
export async function attachFile(ref, file, prefix, who = {}) {
  const isImg = /^image\//.test(file.type), blob = isImg ? await shrink(file) : file, mime = isImg ? 'image/jpeg' : file.type || 'application/octet-stream';
  const ext = isImg ? 'jpg' : (file.name.split('.').pop() || 'bin').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'bin';
  const name = `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.${ext}`;
  const r = await fetch(`/api/p/${st.pid}/media/${name}`, { method: 'PUT', headers: { authorization: 'Bearer ' + st.key, 'content-type': mime }, body: blob });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'upload failed');
  return api(P('/assets'), { method: 'POST', body: { ref, uri: `media/${st.pid}/${name}`, mime, bytes: blob.size, provenance: { uploaded_by: (st.me || {}).name, ...who } } });
}

// Like ownEdit (w-core.js) but the result always waits for review. Used when the AI is answering the person's own note.
export async function reviseEdit(ref, fn, why) {
  const a = await api(P('/artifacts/' + encodeURIComponent(ref))), data = fn(JSON.parse(JSON.stringify(a.data)));
  await api(P('/propose'), { method: 'POST', body: { ref, data, parent: a.parent || undefined, deps: (a.deps || []).filter((x) => x !== a.parent), auto_approve: false, rationale: why } });
}

export const assetsOf = (ref) => ((get(ref) || {}).assets || []);
export const srcOf = (ref, id) => { const a = assetsOf(ref).find((x) => x.id === id); return a ? mediaSrc(a.uri) : ''; };
