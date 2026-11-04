// The control screens: approvals (and canon), credits, tools, and version history.
import { $, esc, st, api, P, toast, chip, isHuman, mediaSrc, ago, saveText } from './core.js';
import { diffHtml } from './feedback.js';

const PIPE = ['logline', 'bible', 'canon.style', 'canon.world', 'canon.cast', 'canon.voice', 'episode', 'scene', 'shot', 'keyframe', 'take', 'dialogue', 'cut'];
const json = (d) => `<pre>${esc(JSON.stringify(d, null, 2))}</pre>`;
function media(a) {
  const u = mediaSrc(a.uri), m = a.mime || '';
  if (a.uri.startsWith('mock://')) return `<div class="mock">mock asset <small>${esc(a.uri)}</small></div>`;
  if (m.startsWith('image/')) return `<img class="media" src="${esc(u)}" alt="" loading="lazy">`;
  if (m.startsWith('video/')) return `<video class="media" controls preload="none" src="${esc(u)}"></video>`;
  if (m.startsWith('audio/')) return `<audio controls preload="none" src="${esc(u)}"></audio>`;
  return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(a.uri)}</a>`;
}
function decision(a) {
  if (!isHuman()) return '';
  const id = esc(a.ref);
  if (a.status === 'proposed') return `<textarea data-c="${id}" placeholder="Comment (required to send back or reject)"></textarea><div class="row"><button class="btn ok" data-act="decide" data-do="approve" data-ref="${id}" data-v="${a.version}">Approve</button><button class="btn" data-act="decide" data-do="request_changes" data-ref="${id}" data-v="${a.version}">Request changes</button><button class="btn no" data-act="decide" data-do="reject" data-ref="${id}" data-v="${a.version}">Reject</button></div>`;
  if (a.stale) return `<p class="why">Something it was built on changed. Keep it as is, or leave it for the AI to redo.</p><button class="btn" data-act="decide" data-do="keep" data-ref="${id}">Keep as is</button>`;
  if (a.status === 'approved') return `<button class="btn sm" data-act="lock" data-ref="${id}" data-lock="1">Lock</button>`;
  if (a.status === 'locked') return `<button class="btn sm" data-act="lock" data-ref="${id}" data-lock="0">Unlock</button>`;
  return '';
}
const card = (a) => `<article class="card"><header class="row"><button class="ref" data-act="history" data-ref="${esc(a.ref)}">${esc(a.ref)}</button>${chip(a)}<span class="mute">v${a.version} · ${esc(a.author)}${a.cost ? ` · ${a.cost} credits` : ''}</span></header>${a.rationale ? `<p class="why">${esc(a.rationale)}</p>` : ''}${json(a.data)}${(a.assets || []).slice(0, 4).map((x) => `<div style="margin:8px 0">${media(x)}</div>`).join('')}${decision(a)}</article>`;

export function vApprovals() {
  const items = st.d.arts.filter((a) => a.status === 'proposed' || a.stale || a.status === 'changes_requested').sort((a, b) => b.stale - a.stale || PIPE.indexOf(a.kind) - PIPE.indexOf(b.kind));
  const groups = {}; items.forEach((a) => (groups[a.kind] ||= []).push(a));
  const html = Object.values(groups).map((g) => (g.length < 6 ? g.map(card).join('') : `<details class="card"><summary><b>${esc(g[0].kind)}</b> · ${g.length} waiting</summary>${isHuman() ? `<p class="row">${g.some((a) => a.status === 'proposed') ? `<button class="btn ok" data-act="approveall" data-refs="${esc(g.filter((a) => a.status === 'proposed').map((a) => a.ref).join(','))}">Approve all ${g.filter((a) => a.status === 'proposed').length}</button>` : ''}${g.some((a) => a.stale) ? `<button class="btn" data-act="keepall" data-refs="${esc(g.filter((a) => a.stale).map((a) => a.ref).join(','))}">Keep all ${g.filter((a) => a.stale).length} stale as they are</button>` : ''}</p>` : ''}${g.map(card).join('')}</details>`)).join('');
  return `<h1>Approvals</h1><p class="mute">What the AI proposed or what went stale. Approving a revision also closes the feedback it answered. ${items.length} item${items.length === 1 ? '' : 's'}.</p>${html || '<div class="empty">Nothing to approve.</div>'}`;
}
export async function vLedger() {
  const b = await api(P('/budget')), pct = b.budget ? Math.min(100, (100 * b.spent) / b.budget) : 0, reqs = st.d.events.filter((e) => e.action === 'budget_request').slice(-5).reverse();
  return `<h1>Credits</h1><div class="card"><div class="row"><b>${b.spent.toFixed(1)}</b> spent of <b>${b.budget}</b> · ${b.remaining.toFixed(1)} left · per-shot cap ${b.shot_cap || 'none'}</div><div class="bar2"><i style="width:${pct}%"></i></div>
  ${isHuman() ? '<div class="row"><input id="add" type="number" min="0" placeholder="Add credits" style="width:140px"><input id="cap" type="number" min="0" placeholder="Shot cap" style="width:120px"><button class="btn pri sm" data-act="grant">Update budget</button></div>' : ''}</div>
  ${reqs.length ? `<h2>Requests from the AI</h2>${reqs.map((e) => `<div class="card">${esc(e.comment)} <span class="mute">· ${esc(e.actor)} · ${ago(e.ts)}</span></div>`).join('')}` : ''}
  <h2>Spend per shot</h2><table>${Object.entries(b.by_scope).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.toFixed(1)}</td></tr>`).join('') || '<tr><td class="mute">No spend yet</td></tr>'}</table>`;
}
export async function vTools() {
  const t = await api('/tools');
  return `<h1>Generation tools</h1><p class="mute">Reached over http, mcp or mock. The AI runs them through <code>call_tool</code>; the budget is checked first.</p><table><tr><th>Name</th><th>Kind</th><th>Transport</th><th>Cost</th></tr>${t.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.kind)}</td><td>${esc(x.transport)}</td><td class="mute">${esc(JSON.stringify(x.cost_model))}</td></tr>`).join('')}</table>
  ${st.me.role === 'admin' && !t.some((x) => x.name === 'muse-image') ? '<div class="card"><b>Meta Muse Image</b><p class="mute small">Registers Muse Image as a generator that takes the stage layout and anchor faces as reference images. 1 credit a picture.</p><button class="btn pri sm" data-act="regmuse">Register Muse Image</button></div>' : ''}
  ${isHuman() ? '<h2>Backup</h2><p class="mute">Everything in this production as one JSON file: artifacts and every version, comments, files list, history, spend. Media stays in storage.</p><button class="btn" data-act="backup">Download backup</button><h2>Restore</h2><p class="mute">Load a backup file into a new production. The original is not touched. Pictures and clips stay where they are and keep working.</p><div class="row"><input type="file" id="rsfile" accept="application/json,.json" style="max-width:300px"><button class="btn" data-act="restore">Restore into a new production</button></div>' : ''}
  ${st.me.role === 'admin' ? '<h2>Register a tool</h2><textarea id="toolj" placeholder=\'{"name":"kling","kind":"video","transport":"http","target":{"url":"https://…","auth_env":"KLING_KEY"},"cost_model":{"per_second":2}}\'></textarea><button class="btn pri sm" data-act="regtool">Save tool</button>' : ''}`;
}

export const acts = {
  async decide(el) { const d = el.dataset, c = ($(`[data-c="${CSS.escape(d.ref)}"]`) || {}).value || ''; await api(P('/decide'), { method: 'POST', body: { ref: d.ref, action: d.do, comment: c, version: d.v ? Number(d.v) : undefined } }); toast(`${d.do.replace('_', ' ')}: ${d.ref}`); return 'refresh'; },
  async lock(el) { await api(P('/lock'), { method: 'POST', body: { ref: el.dataset.ref, lock: el.dataset.lock === '1' } }); return 'refresh'; },
  async approveall(el) {
    const refs = el.dataset.refs.split(',').filter(Boolean);
    if (!refs.length || !confirm(`Approve ${refs.length} items without reading each one?`)) return;
    for (const ref of refs) await api(P('/decide'), { method: 'POST', body: { ref, action: 'approve' } });
    toast(`Approved ${refs.length}`); return 'refresh';
  },
  async keepall(el) {
    const refs = el.dataset.refs.split(',').filter(Boolean);
    if (!refs.length || !confirm(`Keep ${refs.length} stale items as they are? Only do this if the change they were built on does not affect them.`)) return;
    for (const ref of refs) await api(P('/decide'), { method: 'POST', body: { ref, action: 'keep', comment: 'Kept as is after a change upstream' } });
    toast(`Kept ${refs.length}`); return 'refresh';
  },
  async grant() { await api(P('/budget/grant'), { method: 'POST', body: { add: Number($('#add').value || 0), ...($('#cap').value ? { shot_cap: Number($('#cap').value) } : {}) } }); toast('Budget updated'); return 'refresh'; },
  async regtool() { await api('/tools', { method: 'POST', body: JSON.parse($('#toolj').value) }); toast('Tool saved'); return 'refresh'; },
  async history(el) {
    const a = await api(P('/artifacts/' + encodeURIComponent(el.dataset.ref))), d = $('#drawer'); d.hidden = false;
    d.innerHTML = `<div class="row"><b>${esc(a.ref)}</b><span class="sp"></span><button class="btn sm" data-act="closedrawer">Close</button></div><p>${chip(a)} <span class="mute">v${a.version} · ${esc(a.author)}</span></p>
    <h2>History</h2>${a.versions.map((v, i) => `<div class="card"><div class="row"><b>v${v.version}</b><span class="mute">${esc(v.author)} · ${ago(v.ts)}</span></div>${v.rationale ? `<p class="why">${esc(v.rationale)}</p>` : ''}${a.versions[i + 1] ? diffHtml(a.versions[i + 1].data, v.data) : '<p class="mute">First version.</p>'}</div>`).join('')}
    <h2>Built on</h2><div class="row">${a.deps.map((x) => `<span class="tag">${esc(x)}</span>`).join('') || '<span class="mute">nothing</span>'}</div><h2>Feeds</h2><div class="row">${a.dependents.map((x) => `<span class="tag">${esc(x)}</span>`).join('') || '<span class="mute">nothing</span>'}</div>`;
  },
  async backup() { const j = await api(P('/backup')); saveText(`${(st.prods.find((p) => p.id === st.pid) || {}).name || 'production'}-backup.json`.replace(/\s+/g, '-'), JSON.stringify(j, null, 1), 'application/json'); toast('Backup downloaded'); },
  async restore() { const f = $('#rsfile').files[0]; if (!f) return toast('Choose a backup file first'); if (!confirm('Create a new production from this backup?')) return; const r = await api('/restore', { method: 'POST', body: JSON.parse(await f.text()) }); toast(`Restored ${r.artifacts} artifacts as a new production`); st.pid = r.id; localStorage.setItem('mf-pid', r.id); setTimeout(() => location.reload(), 900); },
  closedrawer: () => { $('#drawer').hidden = true; },
};
