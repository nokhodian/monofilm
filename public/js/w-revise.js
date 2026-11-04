// "Fix it" on the AI's text items: the story reading and its beats, a person or place on Understand, the look.
// The note is saved by the margin card; this asks the AI to rewrite just that item, and the new version waits for review.
import { api, P } from './core.js';
import { registerFix } from './w-fix.js';

const revise = async (i) => {
  const r = await api(P('/wizard/revise'), { method: 'POST', body: { ref: i.ref, part: i.part || '', instruction: i.instruction } });
  return `${r.note || 'I rewrote it.'} Please review the new version.`;
};
for (const kind of ['reading', 'ent', 'look']) registerFix(kind, { cost: 0, run: revise });
