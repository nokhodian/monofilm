// Accounts (only for the person who runs the studio): who asked for access, approve or decline, and the credits each account may use across all its productions.
// Someone who signs up without an invite code waits here; approving sends them an email.
import { $, esc, st, api, toast, ago } from './core.js';
import { registerPage } from './w-core.js';

const n1 = (x) => (Math.round(x * 10) / 10).toString();
const part = (L, title, body) => `<section class="part p${L}" aria-labelledby="wh${L}"><header class="ph"><span class="pn">${L}</span><h3 id="wh${L}">${title}</h3></header><div class="pb">${body}</div></section>`;

registerPage('accounts', {
  title: 'Accounts',
  async html() {
    if (!st.me || st.me.role !== 'admin') return '<div class="band"><span class="chapbadge">!</span><div class="bt1"><h1>Accounts</h1></div></div><div class="sheet"><div class="wpage"><p class="sm mute">Only the person who runs this studio can see accounts.</p></div></div>';
    const all = await api('/accounts'), wait = all.filter((u) => u.status === 'pending'), rest = all.filter((u) => u.status !== 'pending');
    const waiting = wait.length
      ? wait.map((u) => `<div class="arow"><b>${esc(u.email)}</b><div class="row"><span class="mute">asked ${ago(u.created)}</span><span class="sp"></span><button class="bt pri sm" data-act="wac-approve" data-id="${esc(u.id)}">Approve</button><button class="bt sm" data-act="wac-reject" data-id="${esc(u.id)}">Decline</button></div></div>`).join('') + '<p class="sm mute">Approving emails them that they can sign in.</p>'
      : '<p class="sm mute">Nobody is waiting.</p>';
    const accounts = rest.length
      ? `<table class="crtab">${rest.map((u) => `<tr><td>${esc(u.email)}${u.status === 'rejected' ? ' <span class="mute">(declined)</span>' : ''}</td><td class="mute">${u.productions} production${u.productions === 1 ? '' : 's'}</td><td>${n1(u.spent)} of ${n1(u.credits)}</td><td><span class="row"><input id="wac-add-${esc(u.id)}" type="number" min="0" placeholder="Add" aria-label="Credits to add for ${esc(u.email)}" style="width:80px"><button class="bt sm" data-act="wac-credits" data-id="${esc(u.id)}">Add credits</button>${u.status === 'rejected' ? `<button class="bt sm" data-act="wac-approve" data-id="${esc(u.id)}">Approve</button>` : ''}</span></td></tr>`).join('')}</table><p class="sm mute">Credits belong to the account. Each of its productions may use all of them, and together they never use more.</p>`
      : '<p class="sm mute">No accounts yet.</p>';
    return `<div class="band"><span class="chapbadge">@</span><div class="bt1"><div class="prog">The people who use this studio</div><h1>Accounts</h1></div></div>
    <div class="sheet"><div class="wpage">${part('A', `Waiting for approval${wait.length ? ` (${wait.length})` : ''}`, waiting)}${part('B', 'Accounts and their credits', accounts)}</div></div>`;
  },
  acts: {
    async 'wac-approve'(el) { await api(`/accounts/${el.dataset.id}`, { method: 'POST', body: { action: 'approve' } }); toast('Approved. They have been emailed.'); return 'refresh'; },
    async 'wac-reject'(el) { if (!confirm('Decline this request?')) return; await api(`/accounts/${el.dataset.id}`, { method: 'POST', body: { action: 'reject' } }); toast('Declined.'); return 'refresh'; },
    async 'wac-credits'(el) { const add = Number(($(`#wac-add-${el.dataset.id}`) || {}).value || 0); if (!(add > 0)) return toast('Type how many credits to add.'); await api(`/accounts/${el.dataset.id}`, { method: 'POST', body: { action: 'credits', add } }); toast(`Added ${add} credits.`); return 'refresh'; },
  },
});
