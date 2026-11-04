// Where the production stands: what exists, what is settled, and exactly what is waiting for a human.
import { esc, st, api, P, ago } from './core.js';
import { ofKind, awaiting, cuts, checkCtx, get } from './data.js';
import { checkCut } from './checks.js';

const STAGES = [
  ['Story', ['logline', 'bible', 'reference']], ['Canon', ['canon.style', 'canon.world', 'canon.cast', 'canon.voice']], ['Plan', ['episode', 'scene', 'shot']],
  ['Pictures', ['keyframe', 'take']], ['Sound', ['dialogue', 'sfx', 'music']], ['Post', ['cut', 'grade', 'captions', 'export']],
];
const LINK = { logline: '#/story', bible: '#/story', reference: '#/story', 'canon.style': '#/look', 'canon.world': '#/look', 'canon.cast': '#/cast', 'canon.voice': '#/voices', shot: '#/shots', scene: '#/shots', keyframe: '#/board', take: '#/board', dialogue: '#/shots', cut: '#/cuts', grade: '#/cuts' };

export async function vOverview() {
  const arts = st.d.arts, by = {}; arts.forEach((a) => (by[a.kind] ||= []).push(a));
  const b = await api(P('/budget')), pr = st.prods.find((p) => p.id === st.pid) || {};
  const cell = (k) => { const l = by[k] || []; if (!l.length) return `<div class="ovk"><span class="mute">${k.replace('canon.', '')}</span><b>0</b></div>`; const ok = l.filter((a) => ['approved', 'locked'].includes(a.status) && !a.stale).length, stale = l.filter((a) => a.stale).length, wait = l.filter((a) => a.status === 'proposed').length;
    return `<a class="ovk" href="${LINK[k] || '#/approvals'}"><span>${k.replace('canon.', '')}</span><b>${ok}<span class="mute">/${l.length}</span></b><div class="seg"><i class="g" style="flex:${ok}"></i><i class="a" style="flex:${wait}"></i><i class="w" style="flex:${stale}"></i></div></a>`; };
  const proposed = arts.filter((a) => a.status === 'proposed').length, stale = arts.filter((a) => a.stale).length, open = st.d.comments.filter((c) => c.status === 'open').length, aw = awaiting().length;
  const reqs = st.d.events.filter((e) => e.action === 'budget_request').slice(-1)[0];
  const rec = cuts()[0], checks = rec ? checkCut(rec.data, checkCtx()) : [], bad = checks.filter((c) => c.lvl === 'bad'), warn = checks.filter((c) => c.lvl === 'warn');
  const todo = [[aw, 'answers from the AI to confirm', '#/feedback'], [proposed, 'proposals to approve', '#/approvals'], [stale, 'items gone stale after a change', '#/approvals'], [open, 'feedback threads the AI has not answered', '#/feedback']].filter((x) => x[0]);
  return `<h1>${esc(pr.name || 'Production')} <span class="mute">· ${esc(pr.format || '')}</span></h1>
  <div class="ovgrid">${STAGES.map(([n, ks]) => `<section class="card"><h2 style="margin:0 0 8px;color:var(--ink)">${n}</h2><div class="ovrow">${ks.map(cell).join('')}</div></section>`).join('')}</div>
  <div class="two"><section class="card"><h2 style="margin-top:0">Waiting for you</h2>${todo.length ? todo.map(([n, t, h]) => `<a class="todo" href="${h}"><b>${n}</b> ${t}</a>`).join('') : '<p class="mute">Nothing. The AI has what it needs.</p>'}${reqs ? `<a class="todo" href="#/credits"><b>!</b> The AI asked for credits: ${esc(reqs.comment)}</a>` : ''}</section>
  <section class="card"><h2 style="margin-top:0">${rec ? esc(rec.data.name) : 'Storyline'} checks</h2>${rec ? `<p>${bad.length ? `<b style="color:var(--bad)">${bad.length} to fix</b> · ` : ''}<b style="color:var(--warn)">${warn.length} warnings</b> · ${checks.length - bad.length - warn.length} fine</p>${[...bad, ...warn].slice(0, 4).map((c) => `<div class="small ${c.lvl === 'bad' ? 'del' : 'mute'}">${esc(c.txt)}</div>`).join('')}<a href="#/cut/${esc(rec.ref.slice(4))}">Open the storyline →</a>` : '<p class="mute">No storyline yet.</p>'}</section></div>
  <section class="card"><div class="row"><b>Credits</b> ${b.spent.toFixed(1)} spent of ${b.budget} · ${b.remaining.toFixed(1)} left<span class="sp"></span><a href="#/credits">Manage</a></div><div class="bar2"><i style="width:${b.budget ? Math.min(100, 100 * b.spent / b.budget) : 0}%"></i></div></section>`;
}
