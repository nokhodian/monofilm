// A second look at a finished clip. The video model's own measures (cuts, frozen tail) cannot see that one seed became three, that a bottle was closed while someone blew bubbles through it,
// or that the place changed shape. A few frames of the clip go to Muse Spark with what was asked, and it says what is physically wrong and how to ask again.
import { spark, outputText } from './meta.js';
import { parseJson } from './util.js';

const SYSTEM = 'You review a few frames of a short film clip, in order, against what was asked for. Be strict about real-life physics and continuity. Look for: an object whose number, size, shape or colour changes between frames (one seed that becomes several); something that appears or disappears; a tool or container used the wrong way (a bottle that is closed while someone blows through it, a can that is not held); hands or paws that do something unnatural (a body part that grows, merges or turns into a blob); the place, the background or the framing that jumps or reshapes between frames; a character that changes look; and the first and last frames not matching the described start and end. Output JSON {ok, seen, issues, advice}. ok is true only when none of these happen. seen is one sentence about what really happens across the frames. issues is a list of {kind (one of "count", "physics", "jump", "identity", "state", "other"), problem (one short sentence), frames (which frames, for example "3 to 5")}. advice is one or two plain sentences to ADD to the prompt so the next try avoids exactly these faults (say what must be true, for example "The bottle is open, with its cap off, the whole time"); empty when ok.';

export async function reviewFrames(env, { frames, asked }, f) {
  try {
    const imgs = (frames || []).slice(0, 8).filter((x) => typeof x === 'string' && x.length < 400000).map((b) => (b.startsWith('data:') ? b : `data:image/jpeg;base64,${b}`));
    if (imgs.length < 2) return { ok: true, skipped: true, issues: [], advice: '' };
    const content = [{ type: 'input_text', text: `What was asked for in this clip:\n${String(asked || '').slice(0, 3000)}\n\nThe ${imgs.length} frames follow, in time order.` }, ...imgs.map((u) => ({ type: 'input_image', image_url: u }))];
    const r = await spark(env, { instructions: `${SYSTEM}\nReply with one JSON object and nothing else.`, input: [{ type: 'message', role: 'user', content }] }, f);
    const m = /\{[\s\S]*\}/.exec(outputText(r)), j = m && parseJson(m[0], null);
    if (!j || typeof j.ok !== 'boolean') return { ok: true, skipped: true, issues: [], advice: '' };
    const issues = (Array.isArray(j.issues) ? j.issues : []).slice(0, 8).map((i) => ({ kind: ['count', 'physics', 'jump', 'identity', 'state', 'other'].includes(i && i.kind) ? i.kind : 'other', problem: String((i && i.problem) || '').slice(0, 240), frames: String((i && i.frames) || '').slice(0, 20) })).filter((i) => i.problem);
    return { ok: j.ok && !issues.length, seen: String(j.seen || '').slice(0, 300), issues, advice: j.ok ? '' : String(j.advice || '').slice(0, 400) };
  } catch (e) { return { ok: true, skipped: true, issues: [], advice: '' }; }
}
