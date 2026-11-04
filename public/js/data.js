// One snapshot of the production per render, plus the lookups every screen needs.
import { api, P, st, mediaSrc } from './core.js';
import { lineSeconds } from './checks.js';

const seenKey = () => `mf-seen-${st.pid}`;
export const seen = () => JSON.parse(localStorage.getItem(seenKey()) || 'null') || { ts: Date.now(), id: 0 };
export function markSeen() { const e = st.d.events; localStorage.setItem(seenKey(), JSON.stringify({ ts: Date.now(), id: e.length ? e[e.length - 1].id : 0 })); }

export async function load() {
  const [arts, comments, events] = await Promise.all([api(P('/artifacts?data=1&assets=1')), api(P('/comments')), api(P('/events?tail=1'))]);
  const by = Object.fromEntries(arts.map((a) => [a.ref, a]));
  if (!localStorage.getItem(seenKey())) { st.d = { events }; markSeen(); } // first visit: nothing counts as new
  st.d = { arts, by, comments, events, seen: seen() };
  return st.d;
}
const d = () => st.d;
export const get = (ref) => d().by[ref];
export const ofKind = (k) => d().arts.filter((a) => a.kind === k);
export const cuts = () => ofKind('cut').sort((a, b) => (b.data.recommended ? 1 : 0) - (a.data.recommended ? 1 : 0) || a.ref.localeCompare(b.ref));
export const shots = () => ofKind('shot').filter((a) => a.data.title);
export const lines = (shotId) => d().arts.filter((a) => a.kind === 'dialogue' && a.parent === `shot:${shotId}`).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
export const cutsWith = (shotId) => cuts().filter((c) => (c.data.order || []).some((o) => o.id === shotId));

// Images come from the keyframe; cast sheets are a fallback because the board's own stills read better as thumbnails.
export function images(shotId) {
  const kf = get(`keyframe:${shotId}`); if (!kf) return [];
  const byName = Object.fromEntries((kf.assets || []).map((x) => [x.uri.split('/').pop(), x.uri]));
  const ids = (kf.data.images || []).slice().sort((a, b) => (a.startsWith('cast-') ? 1 : 0) - (b.startsWith('cast-') ? 1 : 0));
  const made = (kf.assets || []).filter((x) => x.provenance && x.provenance.transport === 'meta-image').map((x) => mediaSrc(x.uri)).reverse(); // pictures Muse Image made come first, newest on top
  return [...made, ...ids.map((i) => byName[`img-${i}.jpg`]).filter(Boolean).map(mediaSrc)];
}
export const thumb = (shotId) => images(shotId)[0] || '';
export const clip = (shotId) => { const t = pickedTake(shotId); return t && t.assets && t.assets[0] ? mediaSrc(t.assets[0].uri) : ''; };

// ---- feedback and change tracking ----
export const threads = (ref) => d().comments.filter((c) => c.ref === ref);
export const openCount = (ref) => threads(ref).filter((c) => c.status === 'open').length;
export const mine = (a) => a.author === st.me.name;
export const isNew = (a) => a.updated > d().seen.ts && !mine(a);
const QUIET = ['attach_asset', 'budget_request', 'tool_failed']; // file attachments are plumbing, not news
export const unseenEvents = () => d().events.filter((e) => e.id > d().seen.id && e.actor !== st.me.name && !QUIET.includes(e.action));
export const awaiting = () => d().comments.filter((c) => c.status === 'addressed');

// ---- a human's own edits: saved as their version, approved at once, and whatever was built on them goes stale ----
export async function editArtifact(ref, fn, why = 'Edited in the studio') {
  const a = await api(P('/artifacts/' + encodeURIComponent(ref))), data = fn(JSON.parse(JSON.stringify(a.data)));
  await api(P('/propose'), { method: 'POST', body: { ref, data, parent: a.parent || undefined, deps: a.deps.filter((x) => x !== a.parent), auto_approve: true, rationale: why } });
}
export const createArtifact = (ref, data, { parent, deps = [], why = 'Added in the studio' } = {}) => api(P('/propose'), { method: 'POST', body: { ref, data, parent, deps, auto_approve: true, rationale: why } });
export const episodeRef = () => (ofKind('episode')[0] || {}).ref;
export const takesOf = (shotId) => d().arts.filter((a) => a.kind === 'take' && a.parent === `shot:${shotId}`).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
export const pickedTake = (shotId) => { const t = takesOf(shotId); return t.find((x) => x.data.picked) || t[0]; };
export const takeSrc = (t) => (t && t.assets && t.assets[0] ? mediaSrc(t.assets[0].uri) : '');
export const checkCtx = () => ({
  shot: (i) => (get(`shot:${i}`) || {}).data || null,
  lines: (i) => lines(i).map((l) => ({ ...l.data, seconds: l.data.seconds })),
  hasImage: (i) => images(i).length > 0, hasClip: (i) => !!takeSrc(pickedTake(i)),
  state: (i) => { const s = get(`shot:${i}`); return s ? { status: s.status, stale: s.stale } : null; },
  bible: (get('bible:main') || {}).data, style: (get('canon.style:look') || {}).data,
});
export { lineSeconds };
