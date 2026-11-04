// "Roll camera": one click and the AI does every step of the wizard and approves it, then the finished project can be exported.
// It runs here in the page, one move at a time, looking at the studio's real state before each move (see w-auto-pure.js), so you can open other pages while it works,
// and if the tab is closed it can carry on from where the work really is. The approvals are yours: they are recorded under your name as "Approved by Roll camera".
import { $, esc, st, api, toast } from './core.js';
import { load, get, createArtifact } from './data.js';
import { registerTocExtra, wzActs, ownEdit, rerender } from './w-core.js';
import { R } from './wizard-model.js';
import { starterStage } from './w-stage-pure.js';
import { plan, remaining, estimate, describe, pageOf } from './w-auto-pure.js';
import { errText } from './w-media.js';
import { downloadFilm } from './w-ship.js';

export const AP = { status: 'idle', pid: '', done: 0, cur: null, log: [], err: '', cancel: false, spent0: 0, started: 0, finished: 0, page: '', left: 0, running: false };
const key = (pid) => `mf-ap-${pid}`, now = () => Date.now();
const save = () => { try { localStorage.setItem(key(AP.pid), JSON.stringify({ status: AP.status, done: AP.done, log: AP.log.slice(0, 40), started: AP.started, finished: AP.finished, spent0: AP.spent0, err: AP.err })); } catch { /* storage full or blocked: the run still works */ } };
const note = (text) => { AP.log.unshift({ t: now(), text }); AP.log = AP.log.slice(0, 60); };
const credits = () => (st.budget ? { spent: st.budget.spent, left: Math.max(0, st.budget.budget - st.budget.spent), total: st.budget.budget } : null);

// ---- the moves ----
async function exec(a) {
  const p = (s) => `/p/${AP.pid}${s}`, post = (s, body) => api(p(s), { method: 'POST', body }), retry = async (f) => { try { return await f(); } catch (e) { if (/^(5\d\d|Failed to fetch|NetworkError)/.test(String(e.message))) { await new Promise((r) => setTimeout(r, 1500)); return f(); } throw e; } };
  switch (a.type) {
    case 'read': return retry(() => post('/wizard/read', {}));
    case 'approve': { let ok = 0, last; for (const ref of a.refs) { try { await post('/decide', { ref, action: 'approve', comment: 'Approved by Roll camera' }); ok++; } catch (e) { last = e; } } if (!ok) throw last; return; }
    case 'face': return retry(() => post('/wizard/face', { id: a.id, variant: 0 }));
    case 'anchor': return ownEdit(a.ref, (d) => ({ ...d, anchor: a.assetId }), 'Main face chosen by Roll camera');
    case 'plate': return retry(() => post('/wizard/plate', { id: a.id }));
    case 'scenes': return retry(() => post('/wizard/scenes', {}));
    case 'stage': { const sc = get(R.scene(a.scene)); return createArtifact(R.stage(a.scene), starterStage(a.scene, sc.data, (r) => (get(r) || {}).data, (r) => (r && get(r) || {}).data || null), { parent: R.scene(a.scene), why: 'A first layout made by Roll camera' }); }
    case 'frame': return retry(() => post('/wizard/frame', { scene: a.scene, clip: a.clip, which: a.which }));
    case 'pick': return ownEdit(a.ref, (d) => ({ ...d, chosen: a.assetId }), 'Picture put in use by Roll camera');
    default: throw new Error(`I do not know how to do "${a.type}".`);
  }
}

async function run() {
  if (AP.running) return; AP.running = true; AP.status = 'running'; AP.cancel = false; AP.err = ''; AP.started ||= now(); paint(); let last = '', guard = 0;
  try {
    while (!AP.cancel) {
      if (st.pid !== AP.pid) { pause('You opened another production, so I paused here. Open this one and press Resume.'); return; }
      await load(); st.budget = await api(`/p/${AP.pid}/budget`).catch(() => st.budget);
      const a = plan(st.d); AP.left = remaining(st.d);
      if (a.type === 'done') { finish(); return; }
      if (a.type === 'blocked') throw new Error(a.why);
      const sig = JSON.stringify(a); if (sig === last || ++guard > 250) throw new Error(`I got stuck on "${describe(a).title}": it did not change anything. Look at that page, then press Resume.`);
      last = sig; AP.cur = { ...describe(a), page: pageOf(a), cost: a.cost || 0 }; AP.page = AP.cur.page; paint();
      if (a.cost && credits() && credits().left < a.cost) { const e = new Error('No credits left'); e.credits = true; throw e; }
      await exec(a); AP.done++; note(AP.cur.title); save(); paint(); soft();
    }
    pause('Paused. Press Resume to carry on.');
  } catch (e) {
    const out = e.credits || /budget|credit/i.test(e.message);
    AP.status = out ? 'paused' : 'error'; AP.err = out ? 'The credits for this production are used up. Ask the person who runs this studio to add credits, then press Resume. Everything made so far is kept.' : errText(e); AP.running = false; save(); paint(); soft();
  }
}
function pause(why) { AP.status = 'paused'; AP.err = why; AP.running = false; save(); paint(); }
async function finish() {
  await load(); AP.status = 'done'; AP.finished = now(); AP.running = false; AP.cur = { ...describe({ type: 'done' }), page: '#/w/ship' }; AP.page = '#/w/ship'; note('All done. Everything is made and approved.'); save(); paint(); soft(); open(true);
  toast('Your film is ready. Export it from the Roll camera box, top left.');
}
// Refresh the page being looked at, but never while someone is typing in it.
const soft = () => { const t = document.activeElement && document.activeElement.tagName; if (!/^(INPUT|TEXTAREA|SELECT)$/.test(t || '')) rerender(); };

// ---- the box in the top bar ----
const ago = (t) => { const s = Math.round((now() - t) / 1000); return s < 5 ? 'just now' : s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`; };
function restore() { // a run from before the page was opened: it cannot still be running, so it is shown as paused
  if (AP.pid === st.pid) return; Object.assign(AP, { status: 'idle', pid: st.pid, done: 0, cur: null, log: [], err: '', cancel: false, running: false, started: 0, finished: 0, page: '', left: 0 });
  try { const s = JSON.parse(localStorage.getItem(key(st.pid)) || 'null'); if (s && s.status !== 'idle') Object.assign(AP, { status: s.status === 'running' ? 'paused' : s.status, done: s.done || 0, log: s.log || [], started: s.started || 0, finished: s.finished || 0, spent0: s.spent0 || 0, err: s.status === 'running' ? 'This page was closed while I was working. Press Resume to carry on.' : s.err || '' }); } catch { /* ignore a damaged saved run */ }
}
let panelOpen = false;
const open = (v) => { panelOpen = v === undefined ? !panelOpen : v; paint(); };
function paint() {
  const wrap = $('#apwrap'); if (!wrap) return; restore();
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
  <p class="apfoot">${AP.status === 'running' ? 'Keep this tab open. You can look at any page while I work. ' : ''}You can change or redo anything afterwards.</p>`;
}
document.addEventListener('click', (e) => {
  if (e.target.closest('#apchip')) { if (AP.page) location.hash = AP.status === 'done' ? '#/w/ship' : AP.page; }
  else if (e.target.closest('#apmore')) open();
});
setInterval(paint, 1500);
for (const ev of ['mf-rerender', 'mf-refresh']) document.addEventListener(ev, () => setTimeout(paint, 0));

// ---- the button, the question, and what the button does ----
const goHtml = () => { const running = AP.pid === st.pid && AP.status === 'running'; return `<div class="aprow"><button class="bt apgo" data-act="ap-start" ${running ? 'disabled' : ''}><span aria-hidden="true">✦</span> ${running ? 'Rolling…' : AP.pid === st.pid && AP.status === 'done' ? 'Roll camera again' : 'Roll camera'}</button><p class="sm">The AI does every step and approves it for you.</p></div>`; };
registerTocExtra(goHtml);
function ask() {
  const e = estimate(st.d), c = credits(), short = c && e.credits > c.left, after = AP.pid === st.pid && AP.status !== 'idle' && AP.status !== 'done';
  const m = document.createElement('div'); m.className = 'apmodal'; m.id = 'apmodal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'apm-t');
  m.innerHTML = `<div class="apbox"><h2 id="apm-t">${after ? 'Carry on with Roll camera?' : 'Roll camera'}</h2><p>The AI will do every step for you, and <b>approve each one on your behalf</b>: read your story, make faces and places, write the scenes, set up each stage and make the pictures.</p>
  <ul><li>It will use ${e.rough ? 'about' : 'about'} <b>${e.credits} credit${e.credits === 1 ? '' : 's'}</b>${c ? ` (you have ${c.left})` : ''}. It makes one face, one plate and one picture each time; you can ask for more on any page.</li>${short ? `<li class="warn">That is more than the credits left. It will do what the credits allow, and stop with a message.</li>` : ''}
  <li>You can change or redo anything afterwards, and every approval is recorded as "Approved by Roll camera".</li><li>Keep this tab open. You can go to other pages while it works; the box at the top left shows what it is doing.</li></ul>
  <div class="apacts"><button class="apb pri" data-act="ap-go">Roll camera</button><button class="apb" data-act="ap-no">Not now</button></div></div>`;
  document.body.appendChild(m); const f = $('[data-act="ap-go"]', m); if (f) f.focus();
  m.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') m.remove(); }); m.addEventListener('click', (ev) => { if (ev.target === m) m.remove(); });
}
Object.assign(wzActs, {
  async 'ap-start'() {
    if (!st.pid) return toast('Create a production first.');
    if (AP.running) { open(true); return; }
    try { const { flushStory } = await import('./w-start.js'); await flushStory(); await load(); } catch { /* the page may not be the Start page: the story is already saved */ }
    st.budget = await api(`/p/${st.pid}/budget`).catch(() => st.budget);
    if (plan(st.d).type === 'blocked') return toast('Write your story first, then press Roll camera.');
    ask();
  },
  'ap-no'() { const m = $('#apmodal'); if (m) m.remove(); },
  'ap-go'() {
    const m = $('#apmodal'); if (m) m.remove();
    if (AP.pid !== st.pid) { Object.assign(AP, { pid: st.pid, done: 0, log: [], cur: null, finished: 0, started: 0 }); }
    AP.spent0 = credits() ? credits().spent : 0; if (AP.status === 'done') { AP.done = 0; AP.log = []; AP.started = 0; } AP.status = 'running'; note('Started. Rolling camera.'); open(true); run();
  },
  'ap-pause'() { AP.cancel = true; AP.err = 'Pausing after this step…'; paint(); },
  'ap-resume'() { run(); },
  'ap-close'() { open(false); },
  async 'ap-export'() { try { const missing = await downloadFilm(); toast(missing.length ? `Downloaded. ${missing.length} file${missing.length === 1 ? '' : 's'} could not be read; they are listed in MISSING.txt.` : 'Downloaded. The whole project is in the zip.'); } catch (e) { toast(`I could not build the download: ${e.message}`); } },
});
