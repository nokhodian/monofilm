// The feedback inbox: answers to confirm, what is still open with the AI, and what changed since you last looked.
import { esc, st, ago, toast, chip, isHuman } from './core.js';
import { get, awaiting, unseenEvents, markSeen } from './data.js';
import { threadHtml } from './feedback.js';
import { agentCard } from './v-meta.js';

const ACT = { propose: 'proposed', approve: 'approved', request_changes: 'sent back', reject: 'rejected', addressed: 'answered feedback in', lock: 'locked', unlock: 'unlocked', keep: 'kept', comment: 'commented on', reply: 'replied on', attach_asset: 'attached a file to', tool_failed: 'tool failed on', resolve: 'resolved a thread on', reopen: 'reopened a thread on' };

export function vInbox() {
  const aw = awaiting(), open = st.d.comments.filter((c) => c.status === 'open'), ev = unseenEvents().filter((e) => e.action !== 'budget_request').reverse();
  const block = (c) => { const a = get(c.ref), ready = a && a.status === 'proposed' && c.status === 'addressed' && isHuman(); // the revision that answers this thread is waiting for you
    return `<div class="card"><div class="row"><a class="ref" href="${link(c.ref)}">${esc(c.ref)}</a>${a ? chip(a) : ''}<span class="sp"></span>${ready ? `<button class="btn ok sm" data-act="decide" data-do="approve" data-ref="${esc(c.ref)}" data-v="${a.version}">Approve v${a.version}</button>` : ''}</div>${threadHtml(c)}</div>`; };
  return `<h1>Feedback</h1>${agentCard()}
  <h2>Answered by the AI — confirm <span class="mute">· ${aw.length}</span></h2>${aw.length ? aw.map(block).join('') : '<div class="empty">Nothing waiting for you to confirm.</div>'}
  <h2>Open — waiting for the AI <span class="mute">· ${open.length}</span></h2>${open.length ? open.map(block).join('') : '<div class="empty">No open feedback. Give some from any storyline, shot or cast member.</div>'}
  <h2>Changed since you last looked <span class="mute">· ${ev.length}</span></h2>
  ${ev.length ? `<div class="row"><button class="btn sm" data-act="markseen">Mark all as seen</button></div>${ev.slice(0, 60).map((e) => `<div class="card ev"><div class="row"><b>${esc(e.actor)}</b> ${esc(ACT[e.action] || e.action)} ${e.ref ? `<a class="ref" href="${link(e.ref)}">${esc(e.ref)}</a>` : ''}${e.version ? `<span class="mute">v${e.version}</span>` : ''}<span class="sp"></span><span class="mute">${ago(e.ts)}</span></div>${e.comment && e.action !== 'addressed' ? `<p class="why">${esc(e.comment)}</p>` : ''}${['propose', 'addressed'].includes(e.action) && e.version > 1 ? `<button class="btn sm" data-act="showdiff" data-ref="${esc(e.ref)}" data-v="${e.version}" data-into="ev-${e.id}">What changed</button><div id="ev-${e.id}"></div>` : ''}</div>`).join('')}` : '<div class="empty">Nothing new from the AI.</div>'}`;
}
export const link = (ref) => ref.startsWith('cut:') ? `#/cut/${ref.slice(4)}` : ref.startsWith('shot:') ? `#/shot/${ref.slice(5)}` : ref.startsWith('canon.cast:') ? '#/cast' : '#/approvals';
export const acts = { markseen: () => { markSeen(); toast('Marked as seen'); return 'render'; } };
