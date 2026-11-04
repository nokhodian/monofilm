// Pure checks on a cut, shared by the page and the MCP server (check_cut) so the human and the AI see the same warnings.
// ctx: { shot(id) -> data|null, lines(id) -> [{role,speaker,de,seconds}], hasImage(id), hasClip(id), state(id) -> {status,stale}|null, bible, style }
const WPS = 2.5; // words per second when a line has no measured audio

export const lineSeconds = (l) => (l.seconds > 0 ? l.seconds : String(l.de || '').trim().split(/\s+/).filter(Boolean).length / WPS);

export function checkCut(cut, ctx) {
  const out = [], add = (lvl, txt) => out.push({ lvl, txt });
  const order = cut.order || [];
  if (!order.length) { add('bad', 'This cut has no shots.'); return out; }
  const ids = order.map((o) => o.id), shots = ids.map((i) => ({ id: i, d: ctx.shot(i) || {}, o: order.find((o) => o.id === i) }));
  const total = order.reduce((a, o) => a + (Number(o.seconds) || 0), 0), target = cut.target_seconds;
  if (target) add(Math.abs(total - target) <= target * 0.1 ? 'ok' : 'warn', `Runtime ${Math.round(total * 10) / 10}s against a ${target}s target.`);
  const first = shots[0].d, last = shots[shots.length - 1].d, cards = shots.flatMap((s) => ctx.lines(s.id).filter((l) => l.role === 'CARD'));
  add(first.slot === 'hook' || (shots[0].id || '').startsWith('H') ? 'ok' : 'warn', first.slot === 'hook' || (shots[0].id || '').startsWith('H') ? 'Opens on a hook.' : 'The first shot is not a hook. The first 3 seconds decide whether anyone stays.');
  add(cards.length && (last.slot === 'title' || ctx.lines(shots[shots.length - 1].id).some((l) => l.role === 'CARD')) ? 'ok' : 'warn', cards.length ? 'Ends with a title card.' : 'No title card. The teaser has no name on screen.');
  const re = ctx.bible && ctx.bible.fiction_label && ctx.bible.fiction_label.regex;
  if (re) add(cards.some((l) => new RegExp(re, 'i').test(l.de || '')) ? 'ok' : 'warn', cards.some((l) => new RegExp(re, 'i').test(l.de || '')) ? 'A fiction label is on screen.' : `No fiction label in a title card. ${ctx.bible.fiction_label.hint || ''}`.trim());
  const spoil = Math.max(0, ...shots.map((s) => Number(s.d.spoiler_level) || 0));
  add(spoil >= 3 ? 'bad' : spoil === 2 ? 'warn' : 'ok', spoil >= 3 ? `Contains an ending-level spoiler (${shots.find((s) => s.d.spoiler_level >= 3).id}).` : spoil === 2 ? `Contains a plot-twist reveal (${shots.filter((s) => s.d.spoiler_level === 2).map((s) => s.id).join(', ')}). Needs group approval.` : 'No plot spoilers beyond level 1.');
  const tight = shots.filter((s) => ctx.lines(s.id).filter((l) => l.role !== 'CARD').reduce((a, l) => a + lineSeconds(l), 0) > (Number(s.o.seconds) || 0) + 0.2);
  add(tight.length ? 'warn' : 'ok', tight.length ? `Speech may overrun its shot: ${tight.map((s) => `${s.id} (${Math.round(ctx.lines(s.id).filter((l) => l.role !== 'CARD').reduce((a, l) => a + lineSeconds(l), 0) * 10) / 10}s of speech in ${s.o.seconds}s)`).join('; ')}.` : 'Spoken lines fit their shots.');
  const noImg = shots.filter((s) => !ctx.hasImage(s.id)), noClip = shots.filter((s) => !ctx.hasClip(s.id));
  if (noImg.length) add('bad', `No image for: ${noImg.map((s) => s.id).join(', ')}.`);
  if (noClip.length) add('warn', `No clip yet for: ${noClip.map((s) => s.id).join(', ')}.`);
  const range = shots.filter((s) => (s.d.dur_min && s.o.seconds < s.d.dur_min) || (s.d.dur_max && s.o.seconds > s.d.dur_max));
  if (range.length) add('warn', `Outside the length the shot was made for: ${range.map((s) => `${s.id} (${s.o.seconds}s, made for ${s.d.dur_min}-${s.d.dur_max}s)`).join('; ')}.`);
  const nw = shots.filter((s) => s.d.is_new);
  add(nw.length ? 'warn' : 'ok', nw.length ? `${nw.length} shot${nw.length > 1 ? 's' : ''} with new lines still to write and voice (${nw.map((s) => s.id).join(', ')}).` : 'No new lines to write.');
  shots.filter((s) => s.d.risk).forEach((s) => add('warn', `${s.id}: ${s.d.risk}`));
  const bad = shots.filter((s) => { const st = ctx.state(s.id); return st && (st.stale || !['approved', 'locked'].includes(st.status)); });
  if (bad.length) add('warn', `Not settled (stale or awaiting approval): ${bad.map((s) => s.id).join(', ')}.`);
  const who = [...new Set(shots.flatMap((s) => ctx.lines(s.id).filter((l) => l.role !== 'CARD').map((l) => l.speaker || l.role)))];
  add('ok', who.length ? `Voices needed: ${who.join(', ')}.` : 'No spoken lines.');
  return out;
}
