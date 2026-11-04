// Shared state and helpers for every screen.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const KEY = 'mf-auth';
export const st = { key: localStorage.getItem(KEY) || '', me: null, pid: localStorage.getItem('mf-pid') || '', prods: [], d: null, draft: null, play: null };

let tt;
export function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2800); }
export async function api(path, o = {}) {
  const r = await fetch('/api' + path, { method: o.method || 'GET', headers: { 'x-mf': '1', ...(st.key ? { authorization: 'Bearer ' + st.key } : {}), ...(o.body ? { 'content-type': 'application/json' } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  const t = await r.text(), j = t ? JSON.parse(t) : null;
  if (r.status === 401) { document.dispatchEvent(new Event('mf-signout')); throw new Error('signed out'); }
  if (!r.ok) throw new Error(j?.error || r.status);
  return j;
}
export const P = (s) => `/p/${st.pid}${s}`;
export const isHuman = () => !!st.me && st.me.kind === 'human' && ['admin', 'approver', 'member'].includes(st.me.role);
export const canGrant = () => !!st.me && ['admin', 'approver'].includes(st.me.role); // only they may add credits

// Media is read with the sign-in cookie, so plain <img>/<video>/<audio> tags work and clips can stream and seek.
export function mediaSrc(u) {
  if (!u) return '';
  if (u.startsWith('media/')) { const [, pid, ...n] = u.split('/'); return `/api/p/${pid}/media/${n.join('/')}`; }
  return u.startsWith('audio/') ? '/' + u : u;
}
export const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
export const secs = (n) => `${Math.round(n * 10) / 10}s`;
export const go = (h) => { location.hash = h; };

export const chip = (a) => `<span class="st s-${a.status}">${esc(a.status.replace('_', ' '))}</span>${a.stale ? '<span class="st s-stale" title="something it was built on changed">stale</span>' : ''}`;
export const tag = (t, cls = '') => `<span class="tag ${cls}">${esc(t)}</span>`;

// Opens the shared picture viewer (zoom.js). opts.ref lets a human draw on the picture; app.js listens for mf-markup so core stays free of the drawing tool.
export function lightbox(src, caption = '', opts = {}) {
  const ok = st.me && st.me.role !== 'viewer';
  document.dispatchEvent(new CustomEvent('mf-view', { detail: { index: 0, items: [{ src, caption, card: null, ...(opts.ref && ok ? { ref: opts.ref, context: opts.context } : {}) }] } }));
}

// Text from the board carries <b> tags; keep those and escape everything else.
export const miniHtml = (s) => esc(s).replace(/&lt;(\/?)b&gt;/g, '<$1b>');
export function saveText(name, text, mime = 'text/plain') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
export async function copyText(t, msg = 'Copied') { try { await navigator.clipboard.writeText(t); toast(msg); } catch { toast('Copy is blocked here. Select the text and copy it.'); } }
