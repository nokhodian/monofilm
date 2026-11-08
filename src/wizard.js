// The wizard's actions. A human starts each one; the AI (Muse Spark, Muse Image) makes the proposals, the human reviews them.
// Structure (episode, clips) is created by the human's own request and approved at once; creative work is proposed by the AI and waits for review.
import { HttpError, bad, parseJson } from './util.js';
import * as S from './store.js';
import { spark, outputText, metaConfigured } from './meta.js';
import { AGENT } from './agent.js';
import { checkPicture } from './picturecheck.js';
import { registerTool, callTool } from './tools.js';
import { REFS, R, slug, keyOf, mediumOf, beingOf, clipStates, clipPlan, clipBeats, clipSpans, composeClip, NOTE_KEYS, FORMAT_DEFAULT, MAX_CLIP, sceneBounds, clampScene } from '../public/js/wizard-model.js';

const row = (db, pid, ref) => db.prepare('SELECT * FROM artifacts WHERE production=? AND ref=?').bind(pid, ref).first();
const dataOf = (r) => (r ? parseJson(r.data) : null);
const must = async (db, pid, ref, what) => { const r = await row(db, pid, ref); if (!r) throw new HttpError(409, `${what || ref} does not exist yet`); return r; };
const human = (actor) => { if (actor.kind !== 'human') throw new HttpError(403, 'only a human starts this'); };
const text = (v, n = 600) => String(v ?? '').slice(0, n);

// ---- asking Muse Spark for structured work ----
export async function askJson(env, system, user, f) {
  const r = await spark(env, { instructions: `${system}\nReply with one JSON object and nothing else. Plain, simple English in every field except dialogue.`, input: user }, f);
  const t = outputText(r), m = /\{[\s\S]*\}/.exec(t), o = m && parseJson(m[0], null);
  if (!o || typeof o !== 'object') throw new HttpError(502, 'the AI did not answer in the expected form. Try again.');
  return o;
}
export const splitSentences = (t) => String(t).replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-ZÀ-Þ"“])/).filter(Boolean).slice(0, 200).map((x, i) => ({ id: `s${i + 1}`, text: x, mark: null }));

// ---- reading without a key: names and sentences only, so the wizard still works offline ----
export function localRead(story) {
  const names = [...new Set((story.match(/\b[A-ZÀ-Þ][a-zà-ÿ]{2,}\b/g) || []).filter((w) => !/^(The|She|He|They|When|Nobody|And|But|Then|This|That|It|Her|His)$/.test(w)))].slice(0, 5);
  const sents = splitSentences(story);
  return { title: text(sents[0] ? sents[0].text : 'Untitled', 60), summary: text(story, 400), tone: ['tense'], period: '', language: 'English',
    people: names.map((n) => ({ name: n, role: 'in the story', desc: '' })), places: [{ name: 'Main place', desc: '', time: 'day' }], beats: sents.slice(0, 5).map((s, i) => ({ id: `b${i + 1}`, text: s.text })),
    questions: [], invented: [], looks: [{ name: 'Muted film', sub: 'soft light, fine grain', desc: 'Muted film, fine grain, natural light' }, { name: 'Hard noir', sub: 'high contrast', desc: 'Hard noir, high contrast, deep shadows' }, { name: 'Warm fresco', sub: 'painted warmth', desc: 'Warm fresco, painted colours' }], forbidden: [] };
}
const READ_SYSTEM = `You read a story for a film studio and set it up for a human to review. Output JSON with: title, summary (2 sentences), tone (list of short words), period (string), language (spoken language),
people (list of {name, role, desc (ONE sentence, with identity in the body (kind of being, main colour, one big shape such as long floppy ears) and NO clothes or accessories unless the story needs them, and then only one garment in one colour; a picture maker can draw the same way every time: what kind of being or animal it is, the silhouette and size, the main colours and markings, and one feature that makes it unmistakable; for a person also age and clothes. Only what is always true: never an action, a pose or a moment, such as a tongue shooting out or a character crying), voice (how they sound), invented (true if the story never names them)}), places (list of {name, desc, time}), beats (list of {text}, 4 to 8 short story beats),
questions (up to 3 {q, options (2 to 3 short answers)} about things the story does not settle), invented (list of things you had to make up), looks (exactly 3 {name, sub, desc}: different visual styles that suit the period AND the style the story asks for: if the story says cartoon, all three are cartoon styles, and if it asks for real people, all three are photographic; desc always names the medium, for example "soft 3D cartoon" or "photograph"), forbidden (list of things that must never be on screen for this period).`;

async function ensure(db, actor, pid, ref, data, extra = {}) {
  const cur = await row(db, pid, ref); if (cur) return cur;
  await S.propose(db, actor, pid, { ref, data, auto_approve: true, rationale: 'Set up by the wizard', ...extra });
  return row(db, pid, ref);
}
const keep = (cur, data) => (cur && ['locked'].includes(cur.status) ? null : data); // a locked item is never rewritten by a re-read

// ---- 1 and 2: read the story ----
export async function readStory(env, db, actor, pid, f) {
  human(actor);
  const st = await must(db, pid, REFS.story, 'your story'), sd = dataOf(st), body = String(sd.text || '').trim();
  if (!body) throw bad('Write or paste your story first.');
  const mats = (await S.listArtifacts(db, pid, { kind: 'reference' })).filter((r) => r.data.category === 'material' && !r.data.removed).map((r) => r.data.name);
  const fmt = { ...FORMAT_DEFAULT, ...(sd.format || {}) };
  const o = metaConfigured(env) ? await askJson(env, READ_SYSTEM, `Story:\n${body.slice(0, 12000)}\n\nFormat: ${fmt.length}, ${fmt.seconds} seconds, ${fmt.aspect}. Spoken language: ${fmt.speech}.${mats.length ? `\nAlso attached: ${mats.join(', ')}.` : ''}`, f) : localRead(body);
  await ensure(db, actor, pid, REFS.episode, { title: text(o.title, 80) || 'Episode' });
  const sentences = splitSentences(body), prev = dataOf(await row(db, pid, REFS.reading));
  if (prev && Array.isArray(prev.sentences)) for (const s of sentences) { const p = prev.sentences.find((x) => x.text === s.text); if (p) s.mark = p.mark || null; } // the person's marks survive a re-read
  const questions = (o.questions || []).slice(0, 3).map((q, i) => ({ id: `q${i + 1}`, q: text(q.q, 200), options: (q.options || []).slice(0, 3).map((x) => text(x, 60)), answer: ((prev && prev.questions || []).find((x) => x.q === q.q) || {}).answer ?? null }));
  const made = [];
  const put = async (ref, data, why, extra) => { const cur = await row(db, pid, ref); if (keep(cur, data) === null) return; await S.propose(db, AGENT, pid, { ref, data: keep(cur, data), rationale: why, ...extra }); made.push(ref); };
  await put(REFS.reading, { title: text(o.title, 80), summary: text(o.summary, 600), tone: (o.tone || []).slice(0, 5).map((x) => text(x, 30)), period: text(o.period, 80), language: text(o.language || fmt.speech, 40), beats: (o.beats || []).slice(0, 10).map((b, i) => ({ id: `b${i + 1}`, text: text(b.text || b, 240) })), sentences, questions, invented: (o.invented || []).slice(0, 8).map((x) => text(x, 160)) }, 'My reading of your story. Please correct anything I got wrong.');
  for (const p of (o.people || []).slice(0, 8)) {
    const id = slug(p.name), cur = dataOf(await row(db, pid, R.cast(id))) || {};
    await put(R.cast(id), { ...cur, name: text(p.name, 60), role: text(p.role, 120), desc: text(p.desc, 400), invented: !!p.invented, candidates: cur.candidates || [], anchor: cur.anchor || null }, `A person I found in your story${p.invented ? '. The story does not name them, so I made them up.' : '.'}`);
    await put(R.voice(id), { ...(dataOf(await row(db, pid, R.voice(id))) || {}), name: text(p.name, 60), desc: text(p.voice || '', 200), speed: 50, energy: 40 }, `How ${text(p.name, 40)} might sound.`);
  }
  for (const pl of (o.places || []).slice(0, 8)) {
    const id = slug(pl.name), cur = dataOf(await row(db, pid, R.place(id))) || {};
    await put(R.place(id), { ...cur, name: text(pl.name, 60), desc: text(pl.desc, 400), time: text(pl.time, 20), source: cur.source || 'none', must_keep: cur.must_keep || [] }, 'A place in your story.');
  }
  if (!(await row(db, pid, REFS.look))) {
    const looks = (o.looks || []).slice(0, 3).map((l, i) => ({ id: `l${i + 1}`, name: text(l.name, 40), sub: text(l.sub, 60), desc: text(l.desc, 300) }));
    await put(REFS.look, { aspect: fmt.aspect, shot_seconds: MAX_CLIP, fps: 24, lens: 35, look: looks[0] ? looks[0].desc : '', period: text(o.period, 80), forbidden: (o.forbidden || []).map((x) => text(x, 40)), rules: '', options: looks, chosen: looks[0] ? looks[0].id : null }, 'Three looks that suit your story. The first is my pick.');
  }
  await S.logEvent(db, pid, REFS.reading, 'wizard_read', actor, `${made.length} items proposed`);
  return { made, via: metaConfigured(env) ? 'muse-spark' : 'local' };
}

// ---- 6: scenes ----
const SCENES_SYSTEM = `You turn a story into scenes for a short film that will be made clip by clip with a video generator. Output JSON {scenes: [...]} with 3 to 8 scenes. Each scene: name, tag (one word for its job: hook, crash, price, title...), seconds (a whole number between the shortest and longest scene length given; all scenes add up to the film length),
place (the name of one of the places given), time (dawn, day, dusk, night or none), who (names from the people given; may be empty), transcript (list of {who (UPPERCASE name or NARRATOR), text (in the spoken language), en (English meaning), sec}; may be empty),
notes {happens (2 to 4 sentences: who is where, what moves, what is seen), mood (mood and pace), cam (ONE continuous camera move for the whole scene, such as "slow push-in" or "static wide"; never a list of shots, and never the words then, cut or shots), sound (sound in the picture), never (what must not happen), cont (how it connects to the scene before and after)},
props (the things in this scene that change or that must look the same every time, such as a seed, a plant, a carrot, a watering can: a list of {name, look (colour, shape and size compared with a character, for example "a carrot as long as Mimi's arm"; use the SAME words for the same thing in every scene), count (how many there are; one seed is 1, and it stays 1)}),
moves (a list with one entry for each clip: HOW it moves, in one or two plain sentences of real physics: which hand or limb does what, in what order, and what the things do ("she scoops soil sideways with both front paws, small crumbs fall beside the hole and a low pile grows"). Every action must already be physically possible at that moment: a bottle is opened before anyone blows through it, a thing is in a hand before it is dropped, a tool is held before it is used),
states (a list of N+1 sentences for a scene of N clips: states[0] is how the scene looks at its first frame, states[k] is how it looks at the last frame of clip k. Each sentence is at most 250 characters (sizes belong in props, not in every state) and is a frozen picture of only what the camera can SEE: something buried, hidden or not there yet is simply left out and NEVER named, not even as "no seed visible" or "no plant yet" (a picture maker draws whatever it is told about, on top of the soil). Say who stands where, what each prop looks like right then and how big it is, the light and time of day. A thing can only be in a stage it has reached: a plant cannot be there before the seed is planted, growth goes through every stage in order and never jumps, and the last state of a scene is the first state of the next scene unless the film cuts to a new place),
RULES OF REAL LIFE for everything above: a prop is named in a state only if it is used in this scene (a watering can that is used two scenes later is not in the hands of anyone before that, or a picture maker will have it poured); choose simple, large, clearly visible actions that a camera can show in one continuous shot, and avoid fiddly hand work on tiny objects and anything a video model draws badly unless the story needs it (water, fire, smoke and other fluids: if needed, show them in the simplest way); an object never changes number, size or shape, and never appears or vanishes without a visible reason; the place, the camera framing and the background stay the same inside a clip; nothing impossible happens.
beats (a list with ONE short action line for each clip of the scene, in order: a scene of up to 8 seconds has 1 line, 9 to 16 seconds has 2, 17 to 24 seconds has 3, and so on. Each line says only what happens in that clip; no event appears in two lines, and each clip ends where the next one begins).`;
const castOf = async (db, pid) => (await S.listArtifacts(db, pid, { kind: 'canon.cast' }));
const placesOf = async (db, pid) => (await S.listArtifacts(db, pid, { kind: 'canon.world' })).filter((a) => a.ref.startsWith('canon.world:place-'));
const localScenes = (bible, fmt) => { const beats = (bible.beats || []).slice(0, 5), per = clampScene(fmt.seconds / Math.max(1, beats.length), fmt); return beats.map((b, i) => ({ name: `Scene ${i + 1}`, tag: '', seconds: per, place: '', time: 'day', who: [], transcript: [], notes: { happens: b.text, mood: '', cam: '', sound: '', never: '', cont: '' } })); };

function sceneFrom(o, i, people, places, fmt) {
  const pl = places.find((p) => p.data.name.toLowerCase() === String(o.place || '').toLowerCase()), who = (o.who || []).map((w) => people.find((p) => p.data.name.toLowerCase() === String(w).toLowerCase())).filter(Boolean).map((p) => p.ref);
  const seconds = clampScene(o.seconds || 10, fmt);
  return { n: i + 1, name: text(o.name, 60) || `Scene ${i + 1}`, tag: text(o.tag, 20), seconds, place: pl ? pl.ref : null, time: text(o.time, 20), who, overrides: {},
    transcript: (o.transcript || []).slice(0, 20).map((l, k) => ({ id: `l${k + 1}`, who: text(l.who, 40).toUpperCase(), text: text(l.text, 400), en: text(l.en, 400), sec: Number(l.sec) || 0 })),
    notes: Object.fromEntries(NOTE_KEYS.map(([k]) => [k, text((o.notes || {})[k], 700)])), start: { mode: 'stage' }, end: { mode: 'stage' }, clips: clipPlan(seconds), moves: ((m, n) => (Array.isArray(m) && m.length === n && m.every((x) => String(x || '').trim()) ? m.map((x) => text(x, 300)) : []))(o.moves, clipPlan(seconds).length), states: ((b, n) => (Array.isArray(b) && b.length === n + 1 && b.every((x) => String(x || '').trim()) ? b.map((x) => text(x, 500)) : []))(o.states, clipPlan(seconds).length), props: (Array.isArray(o.props) ? o.props : []).slice(0, 8).map((p) => ({ name: text(p && p.name, 40), look: text(p && p.look, 200), ...(Number.isInteger(p && p.count) && p.count > 0 && p.count < 100 ? { count: p.count } : {}) })).filter((p) => p.name && p.look), beats: ((b, n) => (Array.isArray(b) && b.length === n && b.every((x) => String(x || '').trim()) ? b.map((x) => text(x, 400)) : []))(o.beats, clipPlan(seconds).length) }; // one line per clip, or none (the page then shares the scene's action out itself)
}
// A second look at the whole scene list with fresh eyes, as a director would before shooting: does every thing exist before it is used, does it grow through its stages in order,
// does it keep one size and colour, does each scene start where the one before ended, and does each clip hold ONE event? The model returns corrected states for the scenes that fail.
const CONTINUITY_SYSTEM = `You are the continuity supervisor of a short film. You get every scene in order, each with its props and states (states[0] is the first frame, states[k] the last frame of clip k). First list every change between two consecutive states (a bottle closed then open, an empty can then a full one, something held then dropped) and check that the move of that clip shows the action that causes it, in the right order (the cap is twisted off BEFORE the bubble is blown); if the move is missing it, add it to a corrected moves list. Then find continuity errors: a thing used before it exists or before it was introduced (a plant before its seed is planted), a stage skipped (a seed that becomes a huge plant in one clip), a prop that changes size or colour, a scene whose first state does not follow the last state of the scene before, a state that shows two events at once, an action whose precondition is not met (blowing bubbles through a closed bottle, planting a seed that is not in her hand, watering with a can she does not hold), a number that changes (one seed becoming several), an action a camera could not show in one continuous shot, or light and time of day that jump without a reason. Output JSON {issues: [{scene (number), problem}], fixes: [{scene (number), states (the full corrected list, the same length as before), moves (optional: the full corrected list of how each clip moves), props (optional corrected list)}]}. Fix only scenes with a problem, change as little as possible, and keep every sentence a frozen picture of only what can be seen, and never name a thing that is hidden or not there yet. If there are no errors output {issues: [], fixes: []}.`;
export async function reviewContinuity(env, scenes, f) {
  const usable = scenes.filter((s) => Array.isArray(s.states) && s.states.length);
  if (!metaConfigured(env) || usable.length < 2) return { issues: [], fixed: 0 };
  try {
    const o = await askJson(env, CONTINUITY_SYSTEM, scenes.map((s) => JSON.stringify({ scene: s.n, name: s.name, time: s.time, props: s.props, states: s.states, moves: s.moves, happens: (s.notes || {}).happens })).join('\n'), f);
    let fixed = 0;
    for (const x of Array.isArray(o.fixes) ? o.fixes : []) {
      const s = scenes.find((y) => y.n === Number(x.scene)); if (!s || !Array.isArray(x.states) || x.states.length !== s.states.length) continue;
      const st = x.states.map((v) => text(v, 400).trim()); if (!st.every(Boolean)) continue;
      s.states = st; if (Array.isArray(x.moves) && s.moves && x.moves.length === s.moves.length && x.moves.every((v) => String(v || '').trim())) s.moves = x.moves.map((v) => text(v, 300)); if (Array.isArray(x.props)) { const pr = x.props.slice(0, 8).map((p) => ({ name: text(p && p.name, 40), look: text(p && p.look, 200) })).filter((p) => p.name && p.look); if (pr.length) s.props = pr; } fixed++;
    }
    return { issues: (Array.isArray(o.issues) ? o.issues : []).slice(0, 12).map((i) => ({ scene: Number(i.scene) || 0, problem: text(i.problem, 240) })), fixed };
  } catch (e) { return { issues: [], fixed: 0 }; }
}
export async function draftScenes(env, db, actor, pid, f) {
  human(actor);
  const bible = await must(db, pid, REFS.reading, 'the reading of your story'), bd = dataOf(bible), sd = dataOf(await row(db, pid, REFS.story)) || {}, fmt = { ...FORMAT_DEFAULT, ...(sd.format || {}) };
  await must(db, pid, REFS.episode, 'the episode');
  const [people, places] = await Promise.all([castOf(db, pid), placesOf(db, pid)]);
  const prompt = `Story:\n${text(sd.text, 8000)}\n\nBeats: ${(bd.beats || []).map((b) => b.text).join(' | ')}\nPeople: ${people.map((p) => `${p.data.name} (${p.data.role})`).join('; ')}\nPlaces: ${places.map((p) => p.data.name).join('; ')}\nFilm length: ${fmt.seconds} seconds. Every scene is between ${sceneBounds(fmt)[0]} and ${sceneBounds(fmt)[1]} seconds long. Spoken language: ${fmt.speech}. Each scene ends up as clips of at most ${MAX_CLIP} seconds.`;
  const o = metaConfigured(env) ? await askJson(env, SCENES_SYSTEM, prompt, f) : { scenes: localScenes(bd, fmt) };
  const list = (o.scenes || []).slice(0, 12); if (!list.length) throw new HttpError(502, 'the AI made no scenes. Try again.');
  const drafted = list.map((s, i) => sceneFrom(s, i, people, places, fmt)), review = await reviewContinuity(env, drafted, f), made = [], used = new Set();
  for (const [i, s] of list.entries()) {
    let id = slug(s.name) || `scene-${i + 1}`; while (used.has(id)) id += '-2'; used.add(id);
    const cur = await row(db, pid, R.scene(id)); if (cur && cur.status === 'locked') continue;
    await S.propose(db, AGENT, pid, { ref: R.scene(id), parent: REFS.episode, data: drafted[i], rationale: `A scene drafted from your story. Please review its brief.${(review.issues.find((x) => x.scene === i + 1) || {}).problem ? ` Continuity fixed: ${review.issues.find((x) => x.scene === i + 1).problem}` : ''}` }); made.push(R.scene(id));
  }
  await S.logEvent(db, pid, REFS.episode, 'wizard_scenes', actor, `${made.length} scenes proposed`);
  return { made, via: metaConfigured(env) ? 'muse-spark' : 'local', continuity: review };
}
// Redo one scene's brief, taking any open feedback on it into account.
export async function draftBrief(env, db, actor, pid, { scene, instruction = '' }, f) {
  human(actor);
  const cur = await must(db, pid, R.scene(scene), `scene ${scene}`), d = dataOf(cur), fmt = { ...FORMAT_DEFAULT, ...((dataOf(await row(db, pid, REFS.story)) || {}).format || {}) };
  const open = (await S.listComments(db, pid, { ref: cur.ref, status: 'open' })).map((c) => c.body).filter(Boolean);
  const [people, places] = await Promise.all([castOf(db, pid), placesOf(db, pid)]);
  if (!metaConfigured(env)) throw new HttpError(503, 'MODEL_API_KEY is not set, so the AI cannot rewrite this brief.');
  const o = await askJson(env, SCENES_SYSTEM.replace('Output JSON {scenes: [...]} with 3 to 8 scenes.', 'Output JSON {scenes: [one scene]} with exactly this one scene, rewritten.'), `Rewrite this scene, keeping what is good.\nCurrent: ${JSON.stringify({ name: d.name, seconds: d.seconds, notes: d.notes, transcript: d.transcript })}\nFeedback: ${[instruction, ...open].filter(Boolean).join(' | ') || 'none'}\nPeople: ${people.map((p) => p.data.name).join('; ')}. Places: ${places.map((p) => p.data.name).join('; ')}.`, f);
  const s = sceneFrom((o.scenes || [])[0] || {}, d.n - 1, people, places, fmt);
  const ids = (await S.listComments(db, pid, { ref: cur.ref, status: 'open' })).map((c) => c.id);
  await S.propose(db, AGENT, pid, { ref: cur.ref, parent: REFS.episode, data: { ...d, name: s.name || d.name, tag: s.tag || d.tag, notes: s.notes, transcript: s.transcript.length ? s.transcript : d.transcript, states: s.states.length ? s.states : d.states, props: s.props.length ? s.props : d.props, moves: s.moves.length ? s.moves : d.moves }, rationale: `Rewrote the brief${instruction ? `: ${text(instruction, 120)}` : ''}.`, addresses: ids });
  return { ref: cur.ref };
}

// Write one action line for each clip of a scene, so no clip is asked to do the whole scene. Proposed for the person to review, like any other brief change.
const BEATS_SYSTEM = 'You split ONE film scene into its clips. You get the scene, the number of clips and each clip\'s length. Output JSON {beats: [...]} with exactly one string per clip, in order. Each string is ONE short present-tense sentence of the action that happens only in that clip. Together they cover everything in "what happens", in order, with nothing repeated in two clips and nothing invented. Do not mention cuts, camera or sound.';
export async function draftBeats(env, db, actor, pid, { scene }, f) {
  human(actor);
  const cur = await must(db, pid, R.scene(scene), `scene ${scene}`), d = dataOf(cur), spans = clipSpans(d);
  if (spans.length < 2) throw bad('This scene is one clip, so it has nothing to split.');
  if (cur.status === 'locked') throw new HttpError(409, `${cur.ref} is locked. Unlock it first.`);
  if (!String((d.notes || {}).happens || '').trim()) throw bad('Write what happens in the scene first.');
  let beats = clipBeats(d), via = 'shared';
  if (metaConfigured(env)) {
    const o = await askJson(env, BEATS_SYSTEM, `Scene: ${d.name}\nWhat happens: ${d.notes.happens}\nClips: ${spans.map((c) => `${c.n} (${c.seconds} s)`).join(', ')}`, f), b = Array.isArray(o.beats) ? o.beats.map((x) => text(x, 400).trim()) : [];
    if (b.length === spans.length && b.every(Boolean)) { beats = b; via = 'muse-spark'; }
  }
  if (!beats.every((x) => String(x).trim())) throw new HttpError(502, 'I could not split this scene into one action for each clip. Write them yourself, or add more to What happens.');
  await S.propose(db, AGENT, pid, { ref: cur.ref, parent: REFS.episode, data: { ...d, beats }, rationale: 'One action for each clip, written from What happens.' });
  return { ref: cur.ref, beats, via };
}

// ---- revising one item after feedback: the AI rewrites only the text fields a person may complain about, never ids, marks or answers ----
const EDITABLE = { bible: ['summary', 'tone', 'period', 'beats', 'invented'], 'canon.cast': ['role', 'desc'], 'canon.world': ['desc', 'time'], 'canon.voice': ['desc'], 'canon.style': ['look', 'period', 'forbidden', 'rules'] };
const REVISE_SYSTEM = `You revise ONE item of a film's setup after a human gave feedback. You get the item's current fields and the feedback. Output JSON {data, note}: data holds ONLY the fields you changed, with the same shape as given (strings stay strings, lists stay lists; a list of beats is a list of {text}); note is one short sentence saying what you changed. Change only what the feedback asks for, and make it concrete, not vaguer. Never add fields.`;
const tidy = (k, v, old) => {
  if (Array.isArray(old) !== Array.isArray(v)) return undefined;
  if (k === 'beats') return v.slice(0, 12).map((b, i) => ({ id: (old[i] && old[i].id) || `b${i + 1}`, text: text(b && b.text !== undefined ? b.text : b, 240) })).filter((b) => b.text);
  if (Array.isArray(v)) return v.slice(0, 12).map((x) => text(x && x.text !== undefined ? x.text : x, 200)).filter(Boolean);
  return typeof v === 'string' ? text(v, 700) : undefined;
};
export async function reviseItem(env, db, actor, pid, { ref, part = '', instruction = '' }, f) {
  human(actor);
  const cur = await must(db, pid, ref, ref), fields = EDITABLE[cur.kind];
  if (!fields) throw bad('This kind of item cannot be rewritten here.');
  if (cur.status === 'locked') throw new HttpError(409, `${ref} is locked. Unlock it first.`);
  if (!metaConfigured(env)) throw new HttpError(503, 'MODEL_API_KEY is not set, so the AI cannot rewrite this.');
  const d = dataOf(cur), open = await S.listComments(db, pid, { ref, status: 'open' }), story = dataOf(await row(db, pid, REFS.story)) || {};
  const subset = Object.fromEntries(fields.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));
  const o = await askJson(env, REVISE_SYSTEM, `Item: ${ref}${part ? ` (the person pointed at: ${part})` : ''}\nCurrent: ${JSON.stringify(subset)}\nFeedback: ${[instruction, ...open.map((c) => c.body)].filter(Boolean).join(' | ') || 'none'}\nThe film's story: ${text(story.text, 1500)}`, f);
  const out = o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? o.data : {}, next = { ...d }; let changed = 0;
  for (const k of fields) { if (out[k] === undefined || d[k] === undefined) continue; const v = tidy(k, out[k], d[k]); if (v !== undefined && JSON.stringify(v) !== JSON.stringify(d[k])) { next[k] = v; changed++; } }
  if (!changed) throw new HttpError(502, 'The AI did not change anything. Say more about what is wrong and try again.');
  await S.propose(db, AGENT, pid, { ref, data: next, rationale: text(o.note, 300) || 'Revised after your feedback.', addresses: open.map((c) => c.id) });
  return { ref, changed, note: text(o.note, 300) };
}

// ---- clips: one shot per clip, one keyframe shell per clip start and end ----
export async function ensureClips(db, actor, pid, sceneId) {
  const sc = await must(db, pid, R.scene(sceneId), `scene ${sceneId}`), d = dataOf(sc), clips = d.clips && d.clips.length ? d.clips : clipPlan(d.seconds);
  const look = await must(db, pid, REFS.look, 'the look');
  if (!['approved', 'locked'].includes(look.status)) throw new HttpError(409, 'Approve the look (step 3) first. Every picture is made from it.');
  if (!['approved', 'locked'].includes(sc.status)) throw new HttpError(409, 'Approve the scene brief first, so the pictures are made from something you have checked.');
  const out = [];
  for (const [i, c] of clips.entries()) {
    const n = i + 1, shot = R.shot(sceneId, n);
    await ensure(db, actor, pid, shot, { title: `${d.name} · clip ${n}`, seconds: c.seconds, clip: n }, { parent: R.scene(sceneId), deps: [REFS.look] });
    for (const which of ['start', 'end']) await ensure(db, actor, pid, R.frame(sceneId, n, which), { role: which, scene: sceneId, clip: n, chosen: null }, { parent: shot, deps: [REFS.look] });
    out.push(shot);
  }
  return out;
}

// ---- pictures: faces, place plates, anchor frames ----
async function ensureMuse(db) {
  if (!(await db.prepare("SELECT 1 x FROM tools WHERE name='muse-image'").first())) await registerTool(db, { name: 'muse-image', kind: 'image', transport: 'meta-image', target: { accepts: ['layout', 'prompt'] }, cost_model: { per_call: 1 } });
}
const lookText = async (db, pid) => { const l = dataOf(await row(db, pid, REFS.look)) || {}; return [l.look, l.period && `Period: ${l.period}`, (() => { const f = [].concat(l.forbidden || []).filter((x) => !/\b(guns?|weapons?|knife|knives|blood|war|violence|nude|naked|drugs?)\b/i.test(String(x))); return f.length ? `Never show: ${f.join(', ')}` : ''; })()].filter(Boolean).join('. '); };
const VARIANT = ['', 'A slightly different person: different face shape.', 'A third, clearly different person: different age and features.'];
// Draw, look at the result, and draw once more with the correction if it is not what was asked for. The last picture is kept either way, with what the check saw.
async function drawChecked(env, db, actor, pid, ref, input, expect, f) {
  const refs = (input.anchors || []).filter((a) => a.role !== 'base' && a.name).map((a) => ({ name: a.name, uri: a.uri }));
  let r = await paint(env, db, actor, pid, ref, input, f), check = await checkPicture(env, r.asset.uri, expect, f, refs), redrew = false;
  for (let i = 0; i < 2 && !check.ok && !check.skipped; i++) { redrew = true; const again = await paint(env, db, actor, pid, ref, { ...input, prompt: `${input.prompt} Correction: ${check.problem || 'it was not what was asked for'}. It must show: ${expect}` }, f).catch(() => null); if (!again) break; r = again; check = await checkPicture(env, r.asset.uri, expect, f, refs); } // up to two more tries, each told what was wrong
  return { r, check: { ok: check.ok, major: !!check.major, seen: check.seen || '', problem: check.problem || '', redrew, skipped: !!check.skipped } };
}
async function paint(env, db, actor, pid, ref, input, f) {
  if (!metaConfigured(env)) throw new HttpError(503, 'MODEL_API_KEY is not set, so Muse Image is off.');
  await ensureMuse(db);
  try { return await callTool(db, env, actor, pid, { tool: 'muse-image', ref, input }, f); }
  catch (e) { // Meta's content filter sometimes refuses an innocent prompt. Try again without the "never show" clause, then with every sentence cut at its first comma.
    if (!/content management policy|filtered/i.test(String(e.message))) throw e;
    const plain = String(input.prompt).replace(/\s*Never show: [^.]*\.?/, '');
    try { return await callTool(db, env, actor, pid, { tool: 'muse-image', ref, input: { ...input, prompt: plain } }, f); }
    catch (e2) { if (!/content management policy|filtered/i.test(String(e2.message))) throw e2; return callTool(db, env, actor, pid, { tool: 'muse-image', ref, input: { ...input, prompt: plain.split(/(?<=\.)\s+/).map((s) => s.split(', ')[0].replace(/\.?$/, '.')).join(' ') } }, f); }
  }
}
// Several pictures for one item are made at once; each reads the item, adds its own and writes the next version. A clash is retried on fresh data, never lost.
async function merge(db, pid, ref, build, why) {
  for (let i = 0; ; i++) {
    const cur = await row(db, pid, ref), fresh = dataOf(cur);
    try { await S.propose(db, AGENT, pid, { ref, data: build(fresh), rationale: why, base_version: cur.version }); return; } catch (e) { if (e.status !== 409 || !/changed while/.test(e.message) || i >= 10) throw e; await new Promise((r) => setTimeout(r, 20 + Math.random() * 60)); }
  }
}
const asProposal = async (db, pid, ref, parent, deps, data, why) => { await S.propose(db, AGENT, pid, { ref, parent: parent || undefined, deps, data, rationale: why }); };

export async function makeFace(env, db, actor, pid, { id, variant = 0, instruction = '' }, f) {
  human(actor);
  const cur = await must(db, pid, R.cast(id), `person ${id}`), d = dataOf(cur), letter = 'ABC'[variant % 3];
  const look = dataOf(await row(db, pid, REFS.look)) || {}, medium = mediumOf(look), thing = beingOf(d.desc || d.role) === 'person' ? 'person' : 'character';
  const prompt = [`Portrait ${medium} of one ${thing} for a film. ${thing === 'person' ? 'Head and shoulders' : 'Head and upper body'}, plain neutral background, ${thing === 'person' ? 'looking slightly off camera' : 'facing slightly off camera'}, no text.`, thing === 'character' ? 'Draw the character itself, not a person holding or dressed as it, and not a toy.' : '', d.desc || d.role, await lookText(db, pid), thing === 'person' ? VARIANT[variant % 3] : ['', 'A slightly different design of the same kind of character.', 'A third, clearly different design of the same kind of character.'][variant % 3], instruction].filter(Boolean).join(' ');
  const expect = `Medium: ${medium}. Exactly one ${thing === 'person' ? 'person' : 'character'}: ${d.desc || d.role}. Nothing else in the picture: no other people, and no person holding, wearing or posing with the character.`;
  const { r, check } = await drawChecked(env, db, actor, pid, cur.ref, { prompt, aspect: [3, 4], tag: `face:${letter}`, medium }, expect, f);
  await merge(db, pid, cur.ref, (fresh) => ({ ...fresh, candidates: [...(fresh.candidates || []).filter((c) => c.letter !== letter), { id: r.asset.id, letter, check }] }), `Made face ${letter}.`);
  return { asset: r.asset, letter, check };
}
export async function makePlate(env, db, actor, pid, { id, instruction = '' }, f) {
  human(actor);
  const cur = await must(db, pid, R.place(id), `place ${id}`), d = dataOf(cur);
  const medium = mediumOf(dataOf(await row(db, pid, REFS.look)) || {}), prompt = [`${medium === 'photograph' ? 'Photograph' : 'Illustration'} of a film location, no people or characters, wide establishing view.`, d.name, d.desc, d.time && `Time of day: ${d.time}.`, (d.must_keep || []).length && `It must clearly show: ${d.must_keep.join(', ')}.`, await lookText(db, pid), instruction].filter(Boolean).join(' ');
  const { r, check } = await drawChecked(env, db, actor, pid, cur.ref, { prompt, aspect: [16, 9], tag: 'plate', medium }, `Medium: ${medium}. A place with no people and no characters: ${d.name}. ${d.desc || ''}`, f);
  await merge(db, pid, cur.ref, (fresh) => ({ ...fresh, source: fresh.source === 'photo' ? 'photo' : 'made', plates: [...(fresh.plates || []), { id: r.asset.id, check }] }), 'Made a place plate.');
  return { asset: r.asset, check };
}
// A start or end picture. Built from the stage layout when the scene has one with a camera for this clip, and always from the film's anchor faces.
export async function makeFrame(env, db, actor, pid, { scene, clip = 1, which, instruction = '' }, f) {
  human(actor);
  if (!['start', 'end'].includes(which)) throw bad('which must be start or end');
  const shots = await ensureClips(db, actor, pid, scene), shot = shots[clip - 1]; if (!shot) throw bad(`scene ${scene} has no clip ${clip}`);
  const sd = dataOf(await row(db, pid, R.scene(scene))), fr = R.frame(scene, clip, which), c = composeClip({ data: sd }, {}, clip);
  const anchors = [], chars = [];
  if (which === 'end') { const prevRef = clip === 1 ? R.frame(scene, 1, 'start') : R.frame(scene, clip - 1, 'end'), kf = dataOf(await row(db, pid, prevRef)), a = kf && kf.chosen && await db.prepare('SELECT uri FROM assets WHERE production=? AND id=?').bind(pid, kf.chosen).first(); if (a) anchors.push({ id: 'previous-frame', role: 'base', uri: a.uri }); } // an end picture is made FROM the picture before it, so the place and the framing cannot jump for (const w of sd.who || []) { const p = dataOf(await row(db, pid, w)); if (p && p.desc) chars.push(`${p.name}: ${p.desc}`); const cand = p && (p.candidates || []).find((x) => x.id === p.anchor); if (cand) { const a = await db.prepare('SELECT uri FROM assets WHERE production=? AND id=?').bind(pid, cand.id).first(); if (a) anchors.push({ id: keyOf(w), name: p.name, uri: a.uri }); } }
  const stageRef = R.stage(scene), st = await row(db, pid, stageRef), stageData = dataOf(st), staged = st && ['approved', 'locked'].includes(st.status) && stageData && (stageData.shots || {})[shot];
  const place = sd.place && dataOf(await row(db, pid, sd.place)), lookRow = dataOf(await row(db, pid, REFS.look)) || {};
  // The first picture of a scene follows the previous scene's last picture: it goes in as a reference, so the light, colours and time of day carry across the cut.
  let prevNote = '';
  if (which === 'start' && clip === 1 && (sd.start || {}).mode !== 'chain') {
    const prev = (await S.listArtifacts(db, pid, { kind: 'scene' })).find((a) => (a.data || {}).n === sd.n - 1);
    if (prev) { const k = (prev.data.clips && prev.data.clips.length ? prev.data.clips : clipPlan(prev.data.seconds)).length, kf = dataOf(await row(db, pid, R.frame(keyOf(prev.ref), k, 'end')));
      const a = kf && kf.chosen && await db.prepare('SELECT uri FROM assets WHERE production=? AND id=?').bind(pid, kf.chosen).first(); if (a) { anchors.push({ id: 'previous-scene', uri: a.uri }); prevNote = "Match the light, colours and time of day of the previous scene's last picture."; } }
  }
  const sts = clipStates(sd), state = sts ? (which === 'start' ? sts[clip - 1] : sts[clip]) : '', prompt = [`${which === 'start' ? 'The first frame' : 'The last frame'} of a ${c.seconds} second film clip.`, state || c.prompt.split('\n')[0], chars.length && `Only these appear, exactly as in their reference pictures: ${chars.join(' ')}`, mediumOf(lookRow) === 'illustration' && 'Drawn in the film\'s own style, not a photograph, and no people unless listed.', place && place.desc && `Place: ${place.name}. ${place.desc}`, await lookText(db, pid), prevNote, instruction].filter(Boolean).join(' ');
  const shape = String(((dataOf(await row(db, pid, REFS.look)) || {}).aspect) || '9:16').split(':').map(Number), aspect = shape.length === 2 && shape.every((n) => n > 0 && n < 100) ? shape : [9, 16]; // the pictures follow the film's shape, not always portrait
  const expect = `${state ? `This exact moment: ${state} ` : ''}Medium: ${mediumOf(lookRow)}. ${chars.length ? `Only these characters appear, and each is exactly the kind of being described: ${chars.join(' ')} Nobody else appears.` : 'No people or characters.'}${place && place.desc ? ` Place: ${place.desc}` : ''}`;
  const { r, check } = await drawChecked(env, db, actor, pid, fr, { prompt, aspect, anchors, tag: `${which}`, medium: mediumOf(lookRow), ...(staged ? { stage: { ref: stageRef, shot } } : {}) }, expect, f);
  return { asset: r.asset, ref: fr, staged: !!staged, check };
}

// ---- takes: what the outside generator made, brought back ----
// A human's take is approved at once. A video model working through MCP (an AI agent) proposes the take and the human reviews it; `studio` then sets up the empty clip shells.
export async function addTake(db, actor, pid, { scene, clip = 1, uri, first = null, last = null, hold = null, smooth = null, seed = null, cuts = null, review = null, note = '' }, studio = null) {
  const isHuman = actor.kind === 'human'; if (!isHuman && !(actor.role === 'agent' && studio)) throw new HttpError(403, 'only a human or a connected video agent brings a clip back');
  const shots = await ensureClips(db, isHuman ? actor : studio, pid, scene), shot = shots[clip - 1]; if (!shot) throw bad(`scene ${scene} has no clip ${clip}`);
  if (typeof uri !== 'string' || !/^media\//.test(uri)) throw bad('upload the clip first, then pass its media/ uri');
  const n = (await S.listArtifacts(db, pid, { kind: 'take', parent: shot })).length + 1, ref = R.take(scene, clip, 'abcdefghij'[n - 1] || n);
  const kf = R.frame(scene, clip, 'start');
  await S.propose(db, actor, pid, { ref, parent: shot, deps: [kf, REFS.look], data: { scene, clip, first, last, hold: typeof hold === 'number' && hold >= 0 && hold < 600 ? Math.round(hold * 10) / 10 : null, smooth: smooth && [smooth.median, smooth.max, smooth.at].every((x) => typeof x === 'number' && x >= 0 && x < 1e5) ? { median: smooth.median, max: smooth.max, at: smooth.at, flag: !!smooth.flag } : null, seed: Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32 ? seed : null, cuts: Number.isInteger(cuts) && cuts >= 0 && cuts < 100 ? cuts : null, review: review && typeof review.ok === 'boolean' ? { ok: review.ok, seen: text(review.seen, 300), advice: text(review.advice, 400), issues: (Array.isArray(review.issues) ? review.issues : []).slice(0, 8).map((i) => ({ kind: text(i && i.kind, 12), problem: text(i && i.problem, 240), frames: text(i && i.frames, 20) })) } : null, note: text(note, 300), picked: false }, rationale: isHuman ? 'Clip brought back from the video generator.' : `Clip made by ${actor.name} and sent through MCP.${note ? ' ' + text(note, 200) : ''}`, auto_approve: isHuman });
  await S.attachAsset(db, actor, pid, { ref, uri, mime: 'video/mp4', provenance: { tool: 'external-generator', ...(isHuman ? {} : { generator: actor.name }) } });
  return { ref };
}
