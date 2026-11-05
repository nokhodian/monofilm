// Credits: what this production may still spend, who asked for more, and where it went. It replaces the old studio's Credits tab, in the wizard's own look.
// A credit is the studio's own spending limit for one production (one picture is one credit). It is separate from the Meta account balance.
import { $, esc, st, api, P, toast, canGrant, isHuman, ago, saveText } from './core.js';
import { registerPage } from './w-core.js';

const n1 = (x) => (Math.round(x * 10) / 10).toString();
const part = (L, title, body) => `<section class="part p${L}" aria-labelledby="wh${L}"><header class="ph"><span class="pn">${L}</span><h3 id="wh${L}">${title}</h3></header><div class="pb">${body}</div></section>`;

registerPage('credits', {
  title: 'Credits',
  async html() {
    const b = await api(P('/budget')), pct = b.budget ? Math.min(100, (100 * b.spent) / b.budget) : 0;
    const reqs = st.d.events.filter((e) => e.action === 'budget_request').slice(-5).reverse(), rows = Object.entries(b.by_scope);
    const standing = `<div class="crnum"><b>${n1(b.remaining)}</b> left <span class="mute">· ${n1(b.spent)} spent of ${n1(b.budget)}</span></div><div class="crbar" role="img" aria-label="${n1(pct)} percent spent"><i style="width:${pct}%"></i></div>
      <p class="sm mute">Each picture the AI draws costs 1 credit. ${b.shot_cap ? `One shot may use up to ${b.shot_cap}.` : ''} This is this studio's own limit for this production, separate from your Meta account.</p>`;
    const add = canGrant()
      ? `<div class="row"><input id="wcr-add" type="number" min="0" placeholder="Credits to add" aria-label="Credits to add" style="width:150px"><input id="wcr-cap" type="number" min="0" placeholder="Shot cap" aria-label="Most credits one shot may use" style="width:120px"><button class="bt pri" data-act="wcr-grant">Update credits</button></div><p class="sm mute">Leave the shot cap empty to keep it as it is.</p>`
      : '<p class="sm mute">Only the person who runs this studio can add credits. Ask them if you need more.</p>';
    const asked = reqs.length ? `<span class="lbl">Asked for by the AI</span>${reqs.map((e) => `<div class="arow"><b>${esc(e.actor)}</b><div>${esc(e.comment)} <span class="mute">· ${ago(e.ts)}</span></div></div>`).join('')}` : '';
    const spend = `${rows.length ? `<table class="crtab">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${n1(v)}</td></tr>`).join('')}</table>` : '<p class="sm mute">Nothing spent yet.</p>'}`;
    const backup = isHuman() ? '<span class="lbl">Backup</span><p class="sm mute">Everything in this production as one file: every item and version, comments, history and spend. Pictures stay in storage.</p><button class="bt sm" data-act="wcr-backup">Download backup</button>' : '';
    return `<div class="band"><span class="chapbadge">$</span><div class="bt1"><div class="prog">This production</div><h1>Credits</h1></div></div>
    <div class="sheet"><div class="wpage">${part('A', 'Where they stand', standing)}${part('B', 'Add credits', add)}${part('C', 'Where they went', asked + spend + backup)}</div></div>`;
  },
  acts: {
    async 'wcr-grant'() { const add = Number($('#wcr-add').value || 0), cap = $('#wcr-cap').value; if (!(add > 0) && !cap) return toast('Type how many credits to add.'); await api(P('/budget/grant'), { method: 'POST', body: { add, ...(cap ? { shot_cap: Number(cap) } : {}) } }); toast(add > 0 ? `Added ${add} credits.` : 'Updated.'); return 'refresh'; },
    async 'wcr-backup'() { const j = await api(P('/backup')); saveText(`${(st.prods.find((p) => p.id === st.pid) || {}).name || 'production'}-backup.json`.replace(/\s+/g, '-'), JSON.stringify(j, null, 1), 'application/json'); toast('Backup downloaded.'); },
  },
});
