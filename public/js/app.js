// Monofilm, the human side: watch what the AI made, react to it, change it, approve it.
import { $, esc, st, api, KEY, toast, P, ago, lightbox, isHuman, canGrant } from './core.js';
import { load, awaiting, unseenEvents } from './data.js';
import { acts as fbActs } from './feedback.js';
import { vCuts, vCut, bind, acts as cutActs } from './v-cuts.js';
import { vShots, vShot, acts as shotActs } from './v-shots.js';
import { vInbox, acts as inboxActs } from './v-inbox.js';
import { vApprovals, vLedger, vTools, acts as adminActs } from './v-admin.js';
import { vOverview } from './v-overview.js';
import { vBoard, acts as boardActs } from './v-board.js';
import { vStory, vLook, vVoices, acts as canonActs } from './v-canon.js';
import { vCast, acts as castActs } from './v-cast.js';
import { acts as markupActs } from './markup.js';
import { vStaging, vStage, bindStage, stageDirty, stageLeave, acts as stageActs } from './stage.js';
import { vScript, acts as scriptActs } from './v-script.js';
import { vSound, vCaptions, acts as soundActs } from './v-sound.js';
import { loadMeta, acts as metaActs } from './v-meta.js';
import { vWizard, bindWizard, wzActs } from './w-core.js';
import './w-index.js'; // the wizard's steps register themselves here

const TABS = [['w', 'Wizard'], ['overview', 'Overview'], ['story', 'Story'], ['script', 'Script'], ['look', 'Look and world'], ['cast', 'Cast'], ['voices', 'Voices'], ['staging', 'Staging'], ['cuts', 'Storylines'], ['shots', 'Shots'], ['board', 'Board'], ['sound', 'Sound'], ['captions', 'Captions'], ['feedback', 'Feedback'], ['approvals', 'Approvals'], ['credits', 'Credits'], ['tools', 'Tools']];
const ACTS = { ...fbActs, ...cutActs, ...shotActs, ...inboxActs, ...adminActs, ...boardActs, ...canonActs, ...castActs, ...markupActs, ...stageActs, ...scriptActs, ...soundActs, ...metaActs, ...wzActs };
const route = () => { const [, v = 'w', arg = ''] = location.hash.split('/'); return [v || 'w', decodeURIComponent(arg)]; };

let seq = 0; // only the newest render may touch the page
async function render(reload = true) {
  if (!st.me) return login();
  if (!st.pid) { $('#view').innerHTML = '<div class="empty">Create a production to begin.</div>'; return; }
  const my = ++seq, [v, arg] = route();
  let html;
  try {
    if (reload || !st.d) { await load(); st.budget = await api(P('/budget')).catch(() => null); st.lastEvent = st.d.events.length ? st.d.events[st.d.events.length - 1].id : 0; }
    document.body.classList.toggle('wzmode', v === 'w');
    html = await ({ w: vWizard, overview: vOverview, story: vStory, look: vLook, voices: vVoices, staging: vStaging, stage: () => vStage(arg), script: () => vScript(arg), sound: vSound, captions: () => vCaptions(arg), board: vBoard, cuts: vCuts, cut: () => vCut(arg), shots: vShots, shot: () => vShot(arg), cast: vCast, feedback: vInbox, approvals: vApprovals, credits: vLedger, ledger: vLedger, tools: vTools }[v] || vOverview)();
  } catch (e) { html = `<div class="empty">${esc(e.message)}</div>`; }
  if (my !== seq) return;
  const open = st.d ? st.d.arts.filter((a) => a.status === 'proposed' || a.stale).length : 0, fb = st.d ? awaiting().length + unseenEvents().length : 0;
  const cur = v === 'cut' ? 'cuts' : v === 'shot' ? 'shots' : v === 'stage' ? 'staging' : v === 'ledger' ? 'credits' : v, badge = { feedback: fb, approvals: open };
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<a href="#/${k}" aria-current="${cur === k}">${l}${badge[k] ? `<span class="n">${badge[k] > 99 ? '99+' : badge[k]}</span>` : ''}</a>`).join('');
  $('#view').innerHTML = html;
  const bc = $('#credchip'); if (bc && st.budget) { bc.textContent = `Credits ${st.budget.spent.toFixed(0)} / ${st.budget.budget}`; bc.hidden = false; }
  const ac = $('#addcred'); if (ac) ac.hidden = !(st.budget && canGrant());
  if (v === 'w') bindWizard($('#view .wz'));
  if (v === 'cut') bind(arg);
  if (v === 'stage') bindStage();
  if (st.flash) { // bring the comment you just made into view and light it up
    const el = document.getElementById(`th-${st.flash}`); st.flash = null;
    if (el) { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { if (n.hidden) n.hidden = false; if (n.tagName === 'DETAILS') n.open = true; } el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 4500); }
    else toast('Saved. You will find it under Feedback.');
  }
}

const AUTH = { mode: 'login', email: '', err: '', busy: false };
function login() {
  document.body.classList.remove('wzmode');
  $('#tabs').innerHTML = ''; $('#logout').hidden = true; $('#who').textContent = ''; $('#prod').hidden = true; $('#newprod').hidden = true; $('#addcred').hidden = true; $('#credchip').hidden = true;
  const m = AUTH.mode, tab = (k, l) => `<button type="button" class="vd" data-act="auth-mode" data-m="${k}" aria-pressed="${m === k}">${l}</button>`;
  const err = AUTH.err ? `<p class="autherr" role="alert">${esc(AUTH.err)}</p>` : '';
  const form = m === 'key'
    ? `<form data-auth="key"><label class="k" for="a-key">Access key</label><input id="a-key" name="key" type="password" autocomplete="off" required>${err}<p><button class="btn pri" ${AUTH.busy ? 'disabled' : ''}>Sign in with a key</button></p></form>`
    : `<form data-auth="${m}"><label class="k" for="a-email">Email</label><input id="a-email" name="email" type="email" autocomplete="${m === 'login' ? 'username' : 'email'}" value="${esc(AUTH.email)}" required>
       <label class="k" for="a-pw">Password${m === 'signup' ? ' <span class="mute">(at least 10 characters)</span>' : ''}</label><input id="a-pw" name="password" type="password" autocomplete="${m === 'login' ? 'current-password' : 'new-password'}" ${m === 'signup' ? 'minlength="10"' : ''} required>
       ${m === 'signup' ? '<label class="k" for="a-code">Invite code</label><input id="a-code" name="code" type="text" autocomplete="off" required><p class="mute small">Sign-up needs an invite code from the person who runs this studio.</p>' : ''}${err}
       <p><button class="btn pri" ${AUTH.busy ? 'disabled' : ''}>${m === 'login' ? 'Sign in' : 'Create my account'}</button></p></form>`;
  $('#view').innerHTML = `<div class="login authbox"><h1>Monofilm</h1><p class="mute">The AI proposes. You direct.</p><div class="row" style="justify-content:center">${tab('login', 'Sign in')}${tab('signup', 'Create an account')}</div>${form}<p class="mute small">${m === 'key' ? '<button class="lk" data-act="auth-mode" data-m="login">Use email and password instead</button>' : 'Have an access key? <button class="lk" data-act="auth-mode" data-m="key">Use a key</button>'}</p></div>`;
  const first = $(m === 'key' ? '#a-key' : AUTH.email ? '#a-pw' : '#a-email'); if (first) first.focus();
}
// One form for all three ways in. An account sets a cookie; a key is kept in this browser as before.
async function authSubmit(f) {
  const mode = f.dataset.auth, v = (n) => (f.elements[n] ? f.elements[n].value : ''); AUTH.err = ''; AUTH.busy = true; AUTH.email = v('email') || AUTH.email;
  try {
    if (mode === 'key') { st.key = v('key').trim(); localStorage.setItem(KEY, st.key); AUTH.busy = false; return boot(); }
    const r = await fetch('/api/auth/' + mode, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mf': '1' }, body: JSON.stringify({ email: v('email'), password: v('password'), code: v('code') }) }), j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Something went wrong (${r.status}).`);
    st.key = ''; localStorage.removeItem(KEY); AUTH.busy = false; return boot();
  } catch (e) { AUTH.err = e.message; AUTH.busy = false; login(); }
}
async function signout() {
  try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-mf': '1' } }); if (st.key) await fetch('/api/session', { method: 'DELETE', headers: { 'x-mf': '1', authorization: 'Bearer ' + st.key } }); } catch { /* offline: the browser still forgets the key */ }
  st.key = ''; st.me = null; st.d = null; localStorage.removeItem(KEY); AUTH.err = ''; login();
}

async function loadProds(select) {
  st.prods = await api('/p');
  if (select) st.pid = select; else if (!st.prods.some((p) => p.id === st.pid)) st.pid = st.prods[0]?.id || '';
  localStorage.setItem('mf-pid', st.pid);
  $('#prod').innerHTML = st.prods.map((p) => `<option value="${esc(p.id)}"${p.id === st.pid ? ' selected' : ''}>${esc(p.name)} (${esc(p.format)})</option>`).join('');
}
async function boot() {
  // Who is signed in? (a cookie from an email sign-in, or the access key kept in this browser). A first visit simply gets nobody.
  let me = null; try { me = (await (await fetch('/api/auth/me', { headers: st.key ? { authorization: 'Bearer ' + st.key } : {} })).json()).me; } catch { /* offline */ }
  if (!me) { if (st.key) { AUTH.mode = 'key'; AUTH.err = 'That key did not work.'; st.key = ''; localStorage.removeItem(KEY); } return login(); }
  st.me = me; if (st.key) await api('/session', { method: 'POST' }).catch(() => {});
  $('#who').textContent = `${st.me.name} · ${st.me.role}`; ['#logout', '#prod', '#newprod', '#live'].forEach((s) => { $(s).hidden = false; });
  await loadMeta(); await loadProds(); render();
}

const BASE = {
  zoom: (el) => lightbox(el.dataset.src, el.dataset.cap, el.dataset.ref ? { ref: el.dataset.ref, context: el.dataset.ctx } : {}),
  'auth-mode'(el) { AUTH.mode = el.dataset.m; AUTH.err = ''; login(); },
  logout: signout,
  // The credit budget is the studio's own spending limit per production (separate from the Meta account balance). A human raises it here.
  async addcred() { const n = Number(prompt('How many credits do you want to add to this production? Each picture costs 1.', '40')); if (!Number.isFinite(n) || n <= 0) return; await api(P('/budget/grant'), { method: 'POST', body: { add: n } }); toast(`Added ${n} credits.`); return 'refresh'; },
  async newprod() { const name = prompt('Production name'); if (!name) return; const format = confirm('OK = series, Cancel = movie') ? 'series' : 'movie'; const r = await api('/p', { method: 'POST', body: { name, format, budget: 40 } }); await loadProds(r.id); return 'refresh'; },
};
async function act(el) {
  const fn = BASE[el.dataset.act] || ACTS[el.dataset.act];
  if (!fn) return;
  const r = await fn(el);
  if (r === 'refresh') await render(true); else if (r === 'render') await render(false);
}
document.addEventListener('submit', (e) => { const f = e.target.closest('form[data-auth]'); if (f) { e.preventDefault(); authSubmit(f); } });
document.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (el) act(el).catch((x) => toast(x.message)); });
document.addEventListener('mf-signout', signout);
document.addEventListener('mf-rerender', () => render(false));
document.addEventListener('mf-refresh', () => render(true));
window.addEventListener('hashchange', () => { $('#drawer').hidden = true; stageLeave(); render(true); });
$('#prod').addEventListener('change', (e) => { st.pid = e.target.value; localStorage.setItem('mf-pid', st.pid); st.draft = null; st.d = null; render(true); });
document.addEventListener('input', (e) => { if (e.target.id === 'shotq') { st.shotQ = e.target.value; render(false).then(() => { const i = $('#shotq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); } });
document.addEventListener('change', (e) => { if (e.target.id === 'shoton') { st.shotOnly = e.target.checked; render(false); } });
// Every few seconds: tell the studio we are here, see who else is, and reload when anything changed, but never while you are writing or editing.
const busy = () => [...document.querySelectorAll('textarea,input')].some((x) => x.value && x.id !== 'key' && x.type !== 'checkbox' && x.type !== 'range') || st.draft || st.shotEdit || stageDirty() || document.querySelector('#mkmodal') || document.querySelector('.lb');
async function pulse() {
  if (document.hidden || !st.me || !st.pid) return;
  try {
    const p = await api(P('/pulse')); $('#live').textContent = `Live · ${p.here.length} here${p.last_ts ? ` · last change by ${p.last_actor} ${ago(p.last_ts)}` : ''}`;
    if (st.lastEvent !== undefined && p.last_event > st.lastEvent && !busy()) render(true);
  } catch { $('#live').textContent = 'Offline, retrying'; }
}
setInterval(pulse, 6000);
boot();
