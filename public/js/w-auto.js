// "Roll camera": one click and the AI does every step of the wizard and approves it, then the finished project can be exported.
// It runs on the server (src/autopilot.js), one move at a time, looking at the production's real state before each move (w-auto-pure.js), so it carries on when this page
// is closed. This file starts and stops it, asks first, and shows how far it got. The approvals are yours: they are recorded under your name as "Approved by Roll camera".
import { $, esc, st, api, toast } from './core.js';
import { load } from './data.js';
import { registerTocExtra, wzActs } from './w-core.js';
import { plan, estimate } from './w-auto-pure.js';
import { downloadFilm } from './w-ship.js';

export const AP = { status: 'idle', pid: '', done: 0, cur: null, log: [], err: '', spent0: 0, started: 0, finished: 0, page: '', left: 0 };
const now = () => Date.now();
const credits = () => (st.budget ? { spent: st.budget.spent, left: Math.max(0, st.budget.budget - st.budget.spent), total: st.budget.budget } : null);

// What the server says about this production's run. Asked every few seconds while the page is open.
let asking = false;
async function sync() {
  if (asking || !st.me || !st.pid) return; asking = true; const pid = st.pid, was = AP.pid === pid ? AP.status : 'idle';
  try {
    const s = await api(`/p/${pid}/autopilot`); if (pid !== st.pid) return;
    Object.assign(AP, { pid, status: s.status, done: s.done, cur: s.cur, log: s.log, err: s.err, spent0: s.spent0, started: s.started, finished: s.finished, left: s.left, page: s.cur ? s.cur.page || '' : '' });
    st.budget = await api(`/p/${pid}/budget`).catch(() => st.budget);
    if (was === 'running' && s.status === 'done') { await load().catch(() => {}); open(true); toast('Your film is ready. Export it from the Roll camera box, top left.'); document.dispatchEvent(new Event('mf-rerender')); }
    paint();
  } catch { /* offline: the box keeps what it last knew */ } finally { asking = false; }
}
setInterval(sync, 3500);

// ---- the box in the top bar ----
const ago = (t) => { const s = Math.round((now() - t) / 1000); return s < 5 ? 'just now' : s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`; };
let panelOpen = false;
const open = (v) => { panelOpen = v === undefined ? !panelOpen : v; paint(); };
function paint() {
  const wrap = $('#apwrap'); if (!wrap) return; if (st.pid && AP.pid !== st.pid) { Object.assign(AP, { status: 'idle', pid: st.pid, done: 0, cur: null, log: [], err: '', started: 0, finished: 0, page: '', left: 0 }); sync(); }
  const show = !!st.me && st.pid && AP.status !== 'idle' && AP.pid === st.pid; wrap.hidden = !show; if (!show) return;
  const total = AP.done + AP.left, pct = AP.status === 'done' ? 100 : total ? Math.min(99, Math.round(100 * AP.done / total)) : 0, c = credits(), used = c ? Math.max(0, c.spent - AP.spent0) : 0;
  const label = { running: AP.cur ? AP.cur.title : 'Working…', paused: 'Paused', error: 'Stopped', done: 'Your film is ready' }[AP.status];
  const chip = $('#apchip'); chip.className = `apchip ${AP.status}`; chip.innerHTML = `<span class="apdot" aria-hidden="true"></span><span class="aptxt"><b>Roll camera</b><small>${esc(label)}</small></span><span class="apbar" aria-hidden="true"><i style="width:${pct}%"></i></span>`;
  chip.title = AP.status === 'running' ? 'Show me the page the AI is filling in' : AP.status === 'done' ? 'Open the Ship page' : 'Show me where it stopped'; chip.setAttribute('aria-label', `Roll camera: ${label}. Press to open the page.`);
  const more = $('#apmore'); more.setAttribute('aria-expanded', String(panelOpen));
  const pn = $('#appanel'); pn.hidden = !panelOpen; if (!panelOpen) return;
  const head = { running: 'The AI is making your film', paused: 'Roll camera is paused', error: 'Roll camera stopped', done: 'Your film is ready' }[AP.status];
  const now1 = AP.cur ? `<div class="apnow"><b>${esc(AP.cur.title)}</b><span>${esc(AP.cur.sub || '')}</span></div>` : '';
  const warn = AP.err ? `<p class="aperr" role="alert">${esc(AP.err)}</p>` : '';
  const btns = AP.status === 'running' ? '<button class="apb" data-act="ap-pause">Pause</button>' : AP.status === 'done' ? '<button class="apb pri" data-act="ap-export">Download the project (.zip)</button><a class="apb" href="#/w/ship">Open Ship</a>' : '<button class="apb pri" data-act="ap-resume">Resume</button>';
  pn.innerHTML = `<div class="aph"><b>${head}</b><button class="apx" data-act="ap-close" aria-label="Close">×</button></div><div class="approg" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
  <p class="apmeta">${AP.done} step${AP.done === 1 ? '' : 's'} done${AP.status === 'running' && AP.left ? `, about ${AP.left} to go` : ''} · ${used} credit${used === 1 ? '' : 's'} used${c ? ` · ${c.left} left` : ''}</p>${now1}${warn}
  <div class="apacts">${btns}${AP.page && AP.status !== 'done' ? `<a class="apb" href="${esc(AP.page)}">Show me the page</a>` : ''}</div>
  <h6>What I have done</h6><ol class="aplog">${AP.log.slice(0, 9).map((l) => `<li><i aria-hidden="true">✓</i><span>${esc(l.text)}</span><time>${ago(l.t)}</time></li>`).join('') || '<li class="mute">Nothing yet.</li>'}</ol>
  <p class="apfoot">${AP.status === 'running' ? 'I keep working on our servers, even if you close this page. ' : ''}You can change or redo anything afterwards.</p>`;
}
document.addEventListener('click', (e) => {
  if (e.target.closest('#apchip')) { if (AP.page) location.hash = AP.status === 'done' ? '#/w/ship' : AP.page; }
  else if (e.target.closest('#apmore')) open();
});
setInterval(paint, 1500);
for (const ev of ['mf-rerender', 'mf-refresh']) document.addEventListener(ev, () => setTimeout(paint, 0));
document.addEventListener('mf-refresh', () => setTimeout(sync, 0));

// ---- the button, the question, and what the button does ----
const goHtml = () => { const running = AP.pid === st.pid && AP.status === 'running'; return `<div class="aprow"><button class="bt apgo" data-act="ap-start" ${running ? 'disabled' : ''}><span aria-hidden="true">✦</span> ${running ? 'Rolling…' : AP.pid === st.pid && AP.status === 'done' ? 'Roll camera again' : 'Roll camera'}</button><p class="sm">The AI does every step and approves it for you.</p></div>`; };
registerTocExtra(goHtml);
function ask() {
  const e = estimate(st.d), c = credits(), short = c && e.credits > c.left, after = AP.pid === st.pid && AP.status !== 'idle' && AP.status !== 'done';
  const m = document.createElement('div'); m.className = 'apmodal'; m.id = 'apmodal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'apm-t');
  m.innerHTML = `<div class="apbox"><h2 id="apm-t">${after ? 'Carry on with Roll camera?' : 'Roll camera'}</h2><p>The AI will do every step for you, and <b>approve each one on your behalf</b>: read your story, make faces and places, write the scenes, set up each stage and make the pictures.</p>
  <ul><li>It will use ${e.rough ? 'about' : 'about'} <b>${e.credits} credit${e.credits === 1 ? '' : 's'}</b>${c ? ` (you have ${c.left})` : ''}. It makes one face, one plate and one picture each time; you can ask for more on any page.</li>${short ? `<li class="warn">That is more than the credits left. It will do what the credits allow, and stop with a message.</li>` : ''}
  <li>You can change or redo anything afterwards, and every approval is recorded as "Approved by Roll camera".</li><li>It keeps working on our servers, so you can close this page or go to other pages. The box at the top left shows what it is doing, whenever you come back.</li></ul>
  <div class="apacts"><button class="apb pri" data-act="ap-go">Roll camera</button><button class="apb" data-act="ap-no">Not now</button></div></div>`;
  document.body.appendChild(m); const f = $('[data-act="ap-go"]', m); if (f) f.focus();
  m.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') m.remove(); }); m.addEventListener('click', (ev) => { if (ev.target === m) m.remove(); });
}
const begin = async () => { const r = await api(`/p/${st.pid}/autopilot/start`, { method: 'POST', body: {} }); Object.assign(AP, { pid: st.pid, status: r.status, done: r.done, cur: r.cur, log: r.log, err: r.err, spent0: r.spent0, started: r.started, finished: 0, left: r.left }); open(true); paint(); sync(); };
Object.assign(wzActs, {
  async 'ap-start'() {
    if (!st.pid) return toast('Create a production first.');
    if (AP.pid === st.pid && AP.status === 'running') { open(true); return; }
    try { const { flushStory } = await import('./w-start.js'); await flushStory(); await load(); } catch { /* the page may not be the Start page: the story is already saved */ }
    st.budget = await api(`/p/${st.pid}/budget`).catch(() => st.budget);
    if (plan(st.d).type === 'blocked') return toast('Write your story first, then press Roll camera.');
    ask();
  },
  'ap-no'() { const m = $('#apmodal'); if (m) m.remove(); },
  async 'ap-go'() { const m = $('#apmodal'); if (m) m.remove(); try { await begin(); } catch (e) { toast(e.message); } },
  async 'ap-pause'() { AP.err = 'Pausing after this step…'; paint(); await api(`/p/${st.pid}/autopilot/stop`, { method: 'POST', body: {} }).catch((e) => toast(e.message)); sync(); },
  async 'ap-resume'() { try { await begin(); } catch (e) { toast(e.message); } },
  'ap-close'() { open(false); },
  async 'ap-export'() { try { const missing = await downloadFilm(); toast(missing.length ? `Downloaded. ${missing.length} file${missing.length === 1 ? '' : 's'} could not be read; they are listed in MISSING.txt.` : 'Downloaded. The whole project is in the zip.'); } catch (e) { toast(`I could not build the download: ${e.message}`); } },
});
