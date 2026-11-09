// A second look at a finished clip. The video model's own measures (cuts, frozen tail) cannot see that one seed became three, that a bottle was closed while someone blew bubbles through it,
// or that the place changed shape. A few frames of the clip go to Muse Spark with what was asked, and it says what is physically wrong and how to ask again.
import { spark, outputText, dataUrl, sam, ownBoxes } from './meta.js';
import { sizeFaults, sizeIssues, goodUntil } from '../public/js/pack.js';
import { parseJson } from './util.js';

const SYSTEM = 'If the START and END pictures of the clip follow the frames, they are the ground truth for how every character and place looks: judge identity (clothes, colours, shapes) against them, never against the written words, and report a character who changes look between frames as "identity". You review a few frames of a short film clip, in order, against what was asked for. Be strict about real-life physics and continuity. Look for: an object whose number, size, shape or colour changes between frames (one seed that becomes several); something that appears or disappears; a tool or container used the wrong way (a bottle that is closed while someone blows through it, a can that is not held); hands or paws that do something unnatural (a body part that grows, merges or turns into a blob); the place, the background or the framing that jumps or reshapes between frames; a character that changes look; and the first and last frames not matching the described start and end. Output JSON {ok, seen, issues, advice, scores, answers}. scores is {quality, match, physics}, each a whole number from 1 (bad) to 5 (excellent): picture quality, how well it matches what was asked, and how physically believable it is. If a numbered list of yes/no questions is given, answer EVERY one in answers as a list of {n, yes (true or false), note}; a "no" means the clip has that fault. ok is true only when none of these happen. seen is one sentence about what really happens across the frames. issues is a list of {kind (one of "count", "physics", "jump", "identity", "state", "other"), problem (one short sentence), frames (which frames, for example "3 to 5")}. advice is one or two plain sentences to ADD to the prompt so the next try avoids exactly these faults (say what must be true, for example "The bottle is open, with its cap off, the whole time"); empty when ok.';

const toUrl = (b) => (b.startsWith('data:') ? b : `data:image/jpeg;base64,${b}`);
const evenly = (list, n) => (list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]));
const boxSize = (boxes) => { const b = (boxes || []).slice().sort((x, y) => (y.conf || 0) - (x.conf || 0))[0]; if (!b) return 0; const [x1, y1, x2, y2] = b.box; return Math.sqrt(Math.max(0, x2 - x1) * Math.max(0, y2 - y1)); };
// Measure how big each character is in every frame (SAM), a few calls at a time. measure = { concepts: [{ name, concept }], seconds, depth, push }.
export async function measureSizes(env, frames, measure, f) {
  const imgs = frames.slice(0, 12).filter((x) => typeof x === 'string' && x.length < 400000).map(toUrl), series = {}; for (const c of measure.concepts) series[c.name] = new Array(imgs.length).fill(0);
  for (let k = 0; k < imgs.length; k += 3) await Promise.all(imgs.slice(k, k + 3).map(async (image, d) => { try { // a frame at a time: every character's search runs, then each box goes to the character that found it with the most confidence (the search for "snail" also finds the beetle)
    const lists = await Promise.all(measure.concepts.map((c) => sam(env, { image, concept: c.concept }, f).catch(() => []))), own = ownBoxes(lists); measure.concepts.forEach((c, n) => { series[c.name][k + d] = boxSize(own[n]); });
  } catch (e) { /* a frame that cannot be measured is left at 0 and ignored */ } }));
  const faults = sizeFaults(series, { seconds: measure.seconds, depth: measure.depth, push: measure.push });
  return { series, faults, issues: sizeIssues(faults), good_until: goodUntil(faults) };
}
export async function reviewFrames(env, { frames, asked, pictures = [], checklist = [], measure = null }, f) {
  try {
    const all = (frames || []).filter((x) => typeof x === 'string' && x.length < 400000), imgs = evenly(all, 8).map(toUrl);
    if (imgs.length < 2) return { ok: true, skipped: true, issues: [], advice: '' };
    const sized = measure && measure.concepts && measure.concepts.length ? await measureSizes(env, all, measure, f) : null;
    const gt = []; for (const p of pictures.slice(0, 2)) { try { const o = await env.MEDIA.get(String(p.uri).replace(/^media\//, '')); if (o) gt.push({ type: 'input_text', text: `The ${p.what} picture of the clip (ground truth):` }, { type: 'input_image', image_url: dataUrl(await o.arrayBuffer(), (o.httpMetadata && o.httpMetadata.contentType) || 'image/png') }); } catch (e) { /* the pictures help, the review goes on without them */ } }
    const content = [{ type: 'input_text', text: `What was asked for in this clip:\n${String(asked || '').slice(0, 3000)}${checklist.length ? `\n\nAnswer these yes/no questions:\n${checklist.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : ''}\n\nThe ${imgs.length} frames follow, in time order.` }, ...imgs.map((u) => ({ type: 'input_image', image_url: u })), ...gt];
    const r = await spark(env, { instructions: `${SYSTEM}\nReply with one JSON object and nothing else.`, input: [{ type: 'message', role: 'user', content }] }, f);
    const m = /\{[\s\S]*\}/.exec(outputText(r)), j = m && parseJson(m[0], null);
    if (!j || typeof j.ok !== 'boolean') return { ok: true, skipped: true, issues: [], advice: '' };
    const issues = (Array.isArray(j.issues) ? j.issues : []).slice(0, 8).map((i) => ({ kind: ['count', 'physics', 'jump', 'identity', 'state', 'size', 'other'].includes(i && i.kind) ? i.kind : 'other', problem: String((i && i.problem) || '').slice(0, 240), frames: String((i && i.frames) || '').slice(0, 20) })).filter((i) => i.problem);
    const answers = (Array.isArray(j.answers) ? j.answers : []).filter((a) => a && Number.isInteger(a.n) && typeof a.yes === 'boolean').slice(0, 20).map((a) => ({ n: a.n, yes: a.yes, note: String(a.note || '').slice(0, 160) }));
    for (const a of answers) if (!a.yes && checklist[a.n - 1] && issues.length < 8) issues.push({ kind: /first frame|last frame/.test(checklist[a.n - 1]) ? 'state' : /exactly|nothing appears/.test(checklist[a.n - 1]) ? 'count' : /same size/.test(checklist[a.n - 1]) ? 'size' : /background|framing/.test(checklist[a.n - 1]) ? 'jump' : /look the same/.test(checklist[a.n - 1]) ? 'identity' : 'other', problem: `${checklist[a.n - 1].replace(/^Does |^Is /, '').slice(0, 150)} — no${a.note ? `: ${a.note}` : ''}`, frames: '' });
    const sc = j.scores && typeof j.scores === 'object' ? Object.fromEntries(['quality', 'match', 'physics'].map((k) => [k, Number.isInteger(j.scores[k]) && j.scores[k] >= 1 && j.scores[k] <= 5 ? j.scores[k] : null])) : null;
    if (sized) for (const i of sized.issues) if (issues.length < 8) issues.push(i);
    return { ok: j.ok && !issues.length, ...(sized ? { sizes: sized.series, size_faults: sized.faults, good_until: sized.good_until } : {}), scores: sc, answers, seen: String(j.seen || '').slice(0, 300), issues, advice: (j.ok && !(sized && sized.issues.length) ? '' : [String(j.advice || ''), ...(sized ? sized.issues.map((i) => `Keep every character the same size and the same proportion to the others (${i.problem}).`) : [])].filter(Boolean).join(' ').slice(0, 500)) };
  } catch (e) { return { ok: true, skipped: true, issues: [], advice: '' }; }
}

// Which of two takes of the same clip is better? A judge is closest to a person when it compares two items, not when it scores one (qa-p-010).
const PAIR = 'You compare two takes, A and B, of the same short film clip, using a few frames of each in time order, against what was asked for. Prefer the take that matches the request, keeps every character, place and object the same, has no jumps, no vanishing or multiplying objects and no impossible physics. Output JSON {winner, reason, a_problems, b_problems}: winner is "A", "B" or "tie"; reason is one sentence; the problem lists are short lists of faults.';
export async function reviewPair(env, { framesA, framesB, asked, pictures = [] }, f) {
  try {
    const pack = (fr) => (fr || []).slice(0, 8).filter((x) => typeof x === 'string' && x.length < 400000).map((b) => ({ type: 'input_image', image_url: b.startsWith('data:') ? b : `data:image/jpeg;base64,${b}` })), a = pack(framesA), b = pack(framesB);
    if (a.length < 2 || b.length < 2) return { winner: 'tie', reason: 'Not enough frames to compare.', skipped: true };
    const gt = []; for (const p of pictures.slice(0, 2)) { try { const o = await env.MEDIA.get(String(p.uri).replace(/^media\//, '')); if (o) gt.push({ type: 'input_text', text: `The ${p.what} picture of the clip (ground truth):` }, { type: 'input_image', image_url: dataUrl(await o.arrayBuffer(), (o.httpMetadata && o.httpMetadata.contentType) || 'image/png') }); } catch (e) { /* the pictures help, the comparison goes on without them */ } }
    const content = [{ type: 'input_text', text: `What was asked for:\n${String(asked || '').slice(0, 3000)}\n\nTake A frames:` }, ...a, { type: 'input_text', text: 'Take B frames:' }, ...b, ...gt];
    const r = await spark(env, { instructions: `${PAIR}\nReply with one JSON object and nothing else.`, input: [{ type: 'message', role: 'user', content }] }, f), m = /\{[\s\S]*\}/.exec(outputText(r)), j = m && parseJson(m[0], null);
    if (!j || !['A', 'B', 'tie'].includes(j.winner)) return { winner: 'tie', reason: 'The comparison could not be read.', skipped: true };
    const list = (x) => (Array.isArray(x) ? x : []).slice(0, 6).map((y) => String(y).slice(0, 160));
    return { winner: j.winner, reason: String(j.reason || '').slice(0, 240), a_problems: list(j.a_problems), b_problems: list(j.b_problems) };
  } catch (e) { return { winner: 'tie', reason: 'The comparison could not run.', skipped: true }; }
}
