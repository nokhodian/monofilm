// How the wizard's seven steps are stored as studio artifacts. Shared by the page, the Worker and the tests, so there is one definition.
// Whole film (steps 1 to 5): logline:main, bible:main, canon.style:look, canon.cast:<id>, canon.voice:<id>, canon.world:place-<id>.
// Each scene (step 6): scene:<id> holds the brief, stage:<id> the 3D layout, shot:<id>-c<n> each clip, keyframe:<id>-c<n>-start|end the anchor pictures, take:<id>-c<n>-<k> what a generator made.

export const STEPS = [
  { n: 1, key: 'start', label: 'Start', group: 'film', title: 'Start with your story' },
  { n: 2, key: 'understand', label: 'Understand', group: 'film', title: 'Here is what I understood' },
  { n: 3, key: 'look', label: 'Look', group: 'film', title: 'Choose how it should look' },
  { n: 4, key: 'people', label: 'People', group: 'film', title: 'Choose a face and a voice for each person' },
  { n: 5, key: 'places', label: 'Places', group: 'film', title: 'Where does it happen' },
  { n: 6, key: 'scenes', label: 'Scenes', group: 'scene', title: 'Turn the story into scenes' },
  { n: 7, key: 'ship', label: 'Ship', group: 'finish', title: 'Cut it and send it' },
];
export const SUBS = [['brief', 'Brief'], ['stage', 'Stage'], ['pictures', 'Pictures'], ['sound', 'Sound'], ['pack', 'Pack']];
export const CLIP_SUBS = ['stage', 'pictures', 'sound', 'pack']; // the pages that work one clip at a time (the Brief is the whole scene)
export const NOTE_KEYS = [['happens', 'What happens'], ['mood', 'Mood and pace'], ['cam', 'Camera and motion'], ['sound', 'Sound in the picture'], ['never', 'Must not happen'], ['cont', 'Continuity']];
export const ANCHOR_MODES = [['stage', 'From the stage'], ['chain', 'Previous scene\'s end'], ['own', 'My own picture'], ['skip', 'Skip it']];
export const JOINS = [['cont', 'Continue from the last picture of the clip before'], ['cut', 'New view, a cut']];
export const TARGETS = [['both', 'Start + end frame'], ['start', 'Start frame only'], ['refs', 'Reference images'], ['text', 'Text only']];
export const FORMAT_DEFAULT = { length: 'Teaser', seconds: 60, aspect: '9:16', speech: 'English', captions: ['English'], faithful: 30, sceneMin: 4, sceneMax: 20 };
// The shortest and longest a scene may be, in whole seconds, fixed on the Start page. Always 1 <= min <= max <= 600.
export const sceneBounds = (f = {}) => { const lo = Math.max(1, Math.min(600, Math.round(Number(f.sceneMin) || FORMAT_DEFAULT.sceneMin))), hi = Math.max(lo, Math.min(600, Math.round(Number(f.sceneMax) || FORMAT_DEFAULT.sceneMax))); return [lo, hi]; };
export const clampScene = (s, f) => { const [lo, hi] = sceneBounds(f); return Math.max(lo, Math.min(hi, Math.round(Number(s) || lo))); };
export const MAX_CLIP = 8; // seconds a generator is assumed to make in one go; the person can change it in the Pack

export const REFS = { story: 'logline:main', reading: 'bible:main', look: 'canon.style:look', episode: 'episode:main' };
export const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'x';
export const keyOf = (ref) => ref.slice(ref.indexOf(':') + 1);
export const kindOf = (ref) => ref.slice(0, ref.indexOf(':'));
export const R = {
  cast: (id) => `canon.cast:${id}`, voice: (id) => `canon.voice:${id}`, place: (id) => `canon.world:place-${id}`,
  scene: (id) => `scene:${id}`, stage: (id) => `stage:${id}`,
  shot: (id, n) => `shot:${id}-c${n}`, frame: (id, n, which) => `keyframe:${id}-c${n}-${which}`, take: (id, n, k) => `take:${id}-c${n}-${k}`,
  material: (id) => `reference:m-${id}`,
};

// A scene is split into clips no longer than `max` seconds, as evenly as possible. Each clip after the first says how it begins.
export function clipPlan(seconds, max = MAX_CLIP, joins = []) {
  const total = Math.max(1, Math.round(Number(seconds) || 1)), n = Math.max(1, Math.ceil(total / max)), base = Math.floor(total / n), extra = total - base * n;
  return Array.from({ length: n }, (_, i) => ({ seconds: base + (i < extra ? 1 : 0), join: i === 0 ? null : joins[i] || 'cont' }));
}
export const emptyNotes = () => Object.fromEntries(NOTE_KEYS.map(([k]) => [k, '']));

// What the page shows on an item: To review (the AI made it), Approved, or Needs a change (a human sent it back).
export function review(a) {
  if (!a) return { state: 'none', label: 'Not made yet' };
  if (a.status === 'changes_requested' || a.status === 'rejected') return { state: 'change', label: 'Needs a change' };
  if (a.status === 'approved' || a.status === 'locked') return a.stale ? { state: 'review', label: 'Check again' } : { state: 'approved', label: 'Approved' };
  return { state: 'review', label: 'To review' };
}
export const counts = (list) => { const c = { review: 0, approved: 0, change: 0, none: 0 }; for (const a of list) c[review(a).state]++; return { ...c, total: list.length, open: c.review + c.change }; };

// 0 not started, 1 in progress, 2 ready. Used by the scene list and by the Pack's checklist.
export function sceneReadiness(scene, ctx) {
  const d = (scene && scene.data) || {}, id = keyOf(scene.ref), notes = d.notes || {}, filled = NOTE_KEYS.filter(([k]) => String(notes[k] || '').trim()).length;
  const done = (a) => a && ['approved', 'locked'].includes(a.status) && !a.stale;
  const brief = !filled ? 0 : filled === NOTE_KEYS.length && done(scene) ? 2 : 1;
  const stage = ctx.get(R.stage(id)) ? (done(ctx.get(R.stage(id))) ? 2 : 1) : 0;
  const frames = slotsOf(id, d).filter((x) => x.mode !== 'skip' && x.mode !== 'chain').map((x) => ctx.get(x.ref));
  const chosen = (f) => f && f.data && f.data.chosen;
  const pictures = !frames.length ? (d.start || d.end ? 2 : 0) : frames.every(chosen) ? 2 : frames.some((f) => f && (ctx.assets(f.ref) || []).length) ? 1 : 0;
  const sound = !(d.transcript || []).length ? (brief ? 2 : 0) : (d.transcript || []).every((l) => (l.text || '').trim()) ? 2 : 1;
  const pack = brief === 2 && stage > 0 && pictures === 2 && sound === 2 ? 2 : brief || stage || pictures || sound ? 1 : 0;
  return [brief, stage, pictures, sound, pack];
}

// ---- clips: which seconds of the scene each clip covers, and which lines and sounds fall in it ----
const clipList = (d) => (d.clips && d.clips.length ? d.clips : clipPlan(d.seconds));
export function clipSpans(d) { let t = 0; return clipList(d).map((c, i) => { const from = t; t += c.seconds; return { n: i + 1, from, to: t, seconds: c.seconds, join: c.join }; }); }
const clipAt = (spans, t) => { const s = spans.find((x) => t >= x.from && t < x.to); return s ? s.n : t < 0 ? 1 : spans.length; };
// Each line starts where the line before it ended (a line with no length counts as 2 s, as in the subtitles). A line belongs to the clip it starts in.
export function linesOfClip(d, n) {
  const spans = clipSpans(d); let t = 0; const out = [];
  (d.transcript || []).forEach((l, index) => { const len = Math.max(1, Number(l.sec) || 2), at = t; t += len; if ((l.text || '').trim() && clipAt(spans, at) === n) out.push({ ...l, index, at: Math.round((at - (spans[n - 1] || { from: 0 }).from) * 10) / 10 }); });
  return out;
}
export const cuesOfClip = (d, n) => { const spans = clipSpans(d); return (d.cues || []).map((c, index) => ({ ...c, index })).filter((c) => clipAt(spans, Number(c.at) || 0) === n); };

// What happens in each clip, so no clip is asked to do the whole scene. Written beats win (one per clip). Otherwise the scene's "What happens" is cut into sentences and each
// sentence goes to the clip its share of the time falls in. Returns one string per clip (empty when a clip has nothing of its own).
export function clipBeats(d) {
  const spans = clipSpans(d), n = spans.length, mine = Array.isArray(d.beats) && d.beats.length === n && d.beats.some((x) => String(x || '').trim()) ? d.beats.map((x) => String(x || '').trim()) : null;
  if (mine && mine.every(Boolean)) return mine;
  const happens = String((d.notes || {}).happens || '').replace(/\s+/g, ' ').trim(), pick = (shared) => shared.map((x, i) => (mine && mine[i]) || x); // a line the person wrote stays; a blank one is filled from the shared split
  if (!happens) return pick(spans.map(() => ''));
  if (n === 1) return [happens];
  const sent = happens.split(/(?<=[.!?])\s+/).filter(Boolean), out = spans.map(() => []);
  sent.forEach((x, i) => out[Math.min(n - 1, Math.floor((i * n) / sent.length))].push(x)); // an even share of the sentences for each clip, in order
  return pick(out.map((x) => x.join(' ')));
}
// What the picture looks like at each boundary of a scene, so a picture is drawn from a STATE and not from an action: states[0] is the start of clip 1, states[k] the end of clip k.
// One sentence each: who is where, what every tracked thing looks like and how big it is, the light. Written by the scene draft; empty until then.
export function clipStates(d) { const n = clipSpans(d).length, s = Array.isArray(d.states) ? d.states.map((x) => String(x || '').trim()) : []; return s.length === n + 1 && s.every(Boolean) ? s : null; }
// The things the scene tracks (a seed, a plant, a watering can) with one fixed look each, so they do not change colour or size between clips.
export const propsOf = (d) => (Array.isArray(d.props) ? d.props : []).filter((p) => p && p.name && p.look);
// Only the things really in view at the start or the end of a clip. Naming a thing that is not there yet makes a generator draw it.
export function propsInClip(d, k) {
  const st = clipStates(d); if (!st) return propsOf(d);
  const here = (p, text) => { const w = String(p.name).trim().split(/\s+/).pop().replace(/[^a-z0-9-]/gi, ''); if (!w) return false; const re = new RegExp(`\\b${w}s?\\b`, 'i'), neg = new RegExp(`\\b(no|not|without)\\b[^.,;]{0,40}\\b${w}s?\\b`, 'i'); return re.test(text) && !neg.test(text); };
  return propsOf(d).filter((p) => here(p, st[k - 1]) || here(p, st[k]));
}
// How each clip really moves, one natural, physically possible description per clip (the beats say WHAT happens, this says HOW a body, a hand or a thing moves while it does).
export function movesOf(d) { const n = clipSpans(d).length, m = Array.isArray(d.moves) ? d.moves.map((x) => String(x || '').trim()) : []; return m.length === n && m.every(Boolean) ? m : []; }
export const PHYSICS = 'Physics: everything behaves exactly as in real life. Nothing appears, vanishes, multiplies or changes shape or size. Every object keeps its number (one seed stays one seed, one bottle stays one bottle). Characters touch and carry things the way real animals do. The place, the framing and the background stay the same for the whole clip.';
// A clip has an end picture unless the scene's end pictures are skipped. The last clip ends on the scene's end picture; a clip in the middle ends on a picture of its own, and the next clip starts from it.
export const hasEnd = (d) => (d.end || {}).mode !== 'skip';
// Clips in the middle only get an end picture of their own when the scene asks for every clip (the default). With d.ends === 'last' only the scene's last clip has one, which costs fewer credits.
export const midEnds = (d) => hasEnd(d) && d.ends !== 'last';
// Every spoken line must fall in exactly one clip. Returns plain-words problems, empty when it is right.
export function clipLineCheck(d, { late = false } = {}) { // late: also report lines that start after the scene has ended (they would be cut off)
  const n = clipSpans(d).length, seen = {}, out = [];
  for (let k = 1; k <= n; k++) for (const l of linesOfClip(d, k)) (seen[l.index] = seen[l.index] || []).push(k);
  const total = clipSpans(d).reduce((a, c) => a + c.seconds, 0); let t = 0;
  (d.transcript || []).forEach((l, i) => { const start = t; t += Math.max(1, Number(l.sec) || 2); if (!(l.text || '').trim()) return; const at = seen[i] || []; if (at.length !== 1) out.push(at.length ? `line ${i + 1} is in clips ${at.join(' and ')}` : `line ${i + 1} is in no clip`); else if (late && start >= total) out.push(`line ${i + 1} starts at ${start} s, after the scene ends at ${total} s`); });
  return out;
}
// Where a clip begins: the scene's start picture, a picture of its own (after a cut), or the end picture of the clip before.
export function startOf(d, n) {
  const c = clipSpans(d)[n - 1] || {};
  if (n === 1) return (d.start || {}).mode !== 'skip' ? 'start' : null;
  if (c.join === 'cut') return 'own';
  return midEnds(d) ? 'prev-end' : 'prev-frame';
}
// The pictures a scene needs: [{ which, clip, ref, mode, label }]. Start of clip 1, the start of a clip that follows a cut, and the end of every clip.
export function slotsOf(id, d) {
  const spans = clipSpans(d), out = [], multi = spans.length > 1;
  spans.forEach((c) => {
    const n = c.n, last = n === spans.length;
    if (n === 1) out.push({ which: 'start', clip: 1, ref: R.frame(id, 1, 'start'), mode: (d.start || {}).mode || 'stage', label: 'Start picture' });
    else if (c.join === 'cut') out.push({ which: 'start', clip: n, ref: R.frame(id, n, 'start'), mode: 'stage', label: `Start of clip ${n} (a cut)` });
    if (last) out.push({ which: 'end', clip: n, ref: R.frame(id, n, 'end'), mode: (d.end || {}).mode || 'stage', label: multi ? `End of clip ${n} (the scene's end)` : 'End picture' });
    else out.push({ which: 'end', clip: n, ref: R.frame(id, n, 'end'), mode: midEnds(d) ? 'stage' : 'skip', label: `End of clip ${n}` });
  });
  return out;
}
// Sound policy for a clip, so a silent clip is asked for as silent (generators invent speech and music otherwise).
export function audioPolicy(d, n) { return linesOfClip(d, n).length ? 'dialogue' : String((d.notes || {}).sound || '').trim() ? 'ambient' : 'silent'; }
const AUDIO_TEXT = { dialogue: 'Audio: only the spoken lines above, over quiet room sound.', ambient: 'Audio: only the ambient sound described above. Every character keeps their mouth closed.', silent: 'Audio: only quiet room tone. Every character keeps their mouth closed.' }; // concrete sound and a closed mouth, not a list of bans (a ban names the thing and generators add it)

// A generator cuts when the camera line lists several shots ("close on hands, then her face"). A clip gets only the first move.
export const oneMove = (cam) => String(cam || '').split(/[,;.]?\s+(?:and then|then|followed by|cut to|next|after that|before)\s+/i)[0].replace(/\bshots\b/i, 'shot').trim();
// What a video generator can take. A clip's words are adapted to it; an unknown generator gets the plain prompt.
// What a video generator can take, from the knowledge base (docs/knowledge/models/*.md, ids in brackets there). A clip's words are fitted to it; an unknown generator gets the plain prompt.
//   negative_mode: 'field' = a separate negative field that wants plain nouns; 'prompt' = no field, so the words are added as "Do not show"; 'none' = negation can backfire, so leave it out.
//   max_chars: the longest prompt it takes (null = unknown); max_refs: the most reference pictures; end_picture: whether a last frame can be given; rewrites_prompt: it has its own prompt rewriter.
export const GENERATORS = {
  'minimax-h3': { name: 'MiniMax H3 (local, ComfyUI)', negative_mode: 'prompt', max_chars: 2000, max_refs: 1, end_picture: true, native_audio: true, max_seconds: 8, rewrites_prompt: false, notes: 'No negative prompt input (it is added to the prompt as "Do not show"). Cuts when the prompt lists several shots. Natural walking and consistent voices across clips are weak. Draws poured water as a flat blue disc, adds floating bubbles and sparkles when the words mention bubbles, and cannot show a tiny object being picked up.' },
  'veo-3.1': { name: 'Google Veo 3.1', negative_mode: 'field', max_chars: null, max_refs: 3, end_picture: true, native_audio: true, max_seconds: 8, rewrites_prompt: false, notes: 'Negative field takes nouns, not "no X". The last frame is only a guide, looser on 8 s than on 4 s. Audio goes in its own sentences. The Gemini API preview models were shut down on 2026-10-22; check which model your account still has. [pm-001, pm-017, phy-023]' },
  'kling-2.5': { name: 'Kling 2.5', negative_mode: 'field', max_chars: null, ideal_words: [50, 100], max_refs: 4, end_picture: true, native_audio: false, max_seconds: 10, rewrites_prompt: false, notes: 'One hero subject and one action; name the camera move exactly. Over-describing a character\'s appearance makes identity drift. End image does not combine with multi-prompt. [pm-008, pm-028, scn]' },
  'runway-gen-4.5': { name: 'Runway Gen-4.5', negative_mode: 'none', max_chars: 1000, max_refs: null, end_picture: false, native_audio: false, max_seconds: 10, rewrites_prompt: false, notes: 'Image-to-video: describe only the change, subject motion and camera separately, and say what stays still. Negation can backfire: use positive wording. A fixed seed is similar, not identical. [cin-002, cin-005, pm-029]' },
  'wan-2.2': { name: 'Wan 2.2 (open weights)', negative_mode: 'field', max_chars: null, ideal_words: [80, 120], max_refs: 1, end_picture: true, native_audio: false, max_seconds: 5, rewrites_prompt: false, notes: 'Subject, scene, movement, then style; overloaded or conflicting prompts hurt. Last-frame conditioning on the hosted version. [pm-004, pm-024]' },
  'ltx-video': { name: 'LTX Video / LTX-2', grid: 'sizes divisible by 32, frame counts of 8k+1', negative_mode: 'none', max_chars: null, ideal_words: [60, 200], max_refs: null, end_picture: true, native_audio: false, max_seconds: 10, rewrites_prompt: false, notes: 'One flowing paragraph in the present tense; say the camera, the speed and the lens; flicker and exposure shifts are known weaknesses; emotion labels do not work. Negative support was not confirmed in the sources. [pm-005, pm-026]' },
  'minimax-hailuo': { name: 'MiniMax Hailuo (cloud 2.x)', camera_style: 'bracket', negative_mode: 'none', max_chars: 2000, max_refs: 1, end_picture: true, native_audio: false, max_seconds: 10, rewrites_prompt: true, notes: 'Camera first, then subject, one action, setting and light. Its prompt optimiser is on by default; turn it off for exact prompts. Stacked emotions and stunts fail. [pm-011, pm-012]' },
  generic: { name: 'Any generator', negative_mode: 'field', max_chars: null, max_refs: null, end_picture: true, native_audio: true, max_seconds: 8, rewrites_prompt: false, notes: '' },
};
// The lines of a prompt that go first when it is too long, least important first.
const DROP_FIRST = [/^Physics:/, /^Things in this scene/, /^Characters/, /^Look:/, /^Sound:/, /^Mood and pace:/, /^The clip before ended on:/, /^Motion feel:/, /^Timing:/, /^Audio:/];
export function compactPrompt(prompt, max) {
  if (!max || prompt.length <= max) return { prompt, compacted: false };
  const lines = prompt.split('\n');
  for (const re of DROP_FIRST) { if (lines.join('\n').length <= max) break; const at = lines.findIndex((l, i) => i > 0 && re.test(l)); if (at > 0) lines.splice(at, 1); }
  let out = lines.join('\n'); if (out.length > max) { out = out.slice(0, max); const cut = Math.max(out.lastIndexOf('. '), out.lastIndexOf('\n')); out = cut > max * 0.6 ? out.slice(0, cut + 1) : out; }
  return { prompt: out, compacted: true };
}
const nouns = (s) => String(s || '').split(/[.;,]/).map((x) => x.trim().replace(/^(no|not|never)\s+/i, '')).filter(Boolean).join(', ');
export function forGenerator(clip, id) {
  const k = Object.hasOwn(GENERATORS, id) ? id : 'generic', g = GENERATORS[k], mode = g.negative_mode, neg = clip.negative || '';
  let text = mode === 'prompt' && neg ? `${clip.prompt}\nDo not show: ${neg}.` : clip.prompt;
  if (g.camera_style === 'bracket') text = text.replace(/^Camera: (.*?), one continuous shot$/m, (m, c) => { const cmd = cameraCommand(c); return cmd ? `Camera: [${cmd}]` : m; });
  const fitted = compactPrompt(text, g.max_chars), hints = [];
  if (g.rewrites_prompt) hints.push('This generator rewrites prompts. Turn its prompt optimiser off when you need the exact words.');
  if (g.grid) hints.push(`Size and length must fit its grid: ${g.grid}.`);
  return { ...clip, generator: { id: k, ...g }, prompt: fitted.prompt, compacted: fitted.compacted, hints, negative: mode === 'field' ? nouns(neg) : '' };
}
// The words a generator receives for one clip, built only from approved film canon and this scene's brief. Pure, so the page, the pack and the Worker agree.
// film = { look, speech, cast: { '<canon.cast ref>': { name, desc } } }
export function composeClip(scene, film, clipIndex = 1) {
  const d = scene.data || {}, n = d.notes || {}, spans = clipSpans(d), c = spans[clipIndex - 1] || spans[0], k = c.n;
  const look = film.look || {}, never = [...new Set([...(String(n.never || '').split(/[.;\n]/).map((s) => s.trim()).filter(Boolean)), ...(Array.isArray(look.forbidden) ? look.forbidden : String(look.forbidden || '').split(',').map((s) => s.trim()).filter(Boolean)).map((t) => `no ${t}`)])];
  const lines = linesOfClip(d, k), beats = clipBeats(d), endPic = k === spans.length ? hasEnd(d) : midEnds(d), policy = audioPolicy(d, k), cast = film.cast || {};
  const who = (d.who || []).map((r) => cast[r]).filter((p) => p && p.desc);
  const parts = [beats[k - 1] || (spans.length > 1 ? 'Carry on calmly from the clip before.' : n.happens), movesOf(d)[k - 1] && `How it moves: ${movesOf(d)[k - 1]}`, k > 1 && beats[k - 2] ? `The clip before ended on: ${beats[k - 2]} Do not repeat it.` : '', n.mood && `Mood and pace: ${n.mood}`, n.cam && `Camera: ${normalizeCamera(n.cam)}, one continuous shot`, n.sound && `Sound: ${n.sound}`,
    PHYSICS,
    who.length ? (film.pictures ? `Characters: ${who.map((p) => p.name).join(' and ')} look exactly as in the start picture, with the same clothes, colours and shapes in every frame.` : `Characters (keep each one exactly as in its reference picture): ${who.map((p) => `${p.name}: ${p.desc}`).join(' ')}`) : '', // with a start picture the words never describe a character again: a word that disagrees with the picture makes the generator flip between the two
    isHandmade(look) ? 'Motion feel: stepped, like stop-motion animation shot at about 12 frames per second, with small handmade imperfections.' : isDrawn(look) ? 'Motion feel: soft squash and stretch, gentle exaggeration, smooth arcs.' : '',
    `Look: ${look.look || look.base || 'as in the film'}. ${look.aspect || '9:16'}, ${look.fps || 24} fps, ${c.seconds} seconds. The medium, colours, exposure and time of day stay exactly the same for the whole clip. No scene change, no cuts, no text on screen.`];
  if (lines.length) parts.push(`Dialogue: ${lines.map((l) => `${l.who || 'NARRATOR'} says${film.speech ? `, in ${film.speech},` : ''} "${l.text}"${l.en && String(l.en).trim().toLowerCase() !== String(l.text).trim().toLowerCase() ? ` (${l.en})` : ''}`).join(' ')}`);
  if (k > 1) parts.push(c.join === 'cut' ? 'This clip is a cut to a new view. It has its own start picture.' : endPic ? 'It begins from the end picture of the clip before.' : 'Continue from the last picture of the previous clip.');
  parts.push(AUDIO_TEXT[policy], timingLine(c.seconds, endPic));
  const st = clipStates(d), pr = propsInClip(d, k);
  if (st) parts.splice(parts.findIndex((x) => /^Look: /.test(x || '')), 0, `It begins like this: ${st[k - 1]}\nIt ends like this, and nothing further happens: ${st[k]}`);
  if (pr.length) parts.splice(parts.findIndex((x) => /^Look: /.test(x || '')), 0, `Things in this scene (always look exactly like this, never bigger or smaller, never a different colour): ${pr.map((p) => `${p.name}: ${p.look}${p.count ? ` (exactly ${p.count})` : ''}`).join('; ')}`);
  return { prompt: parts.filter(Boolean).join('\n'), negative: never.join('. '), seconds: c.seconds, join: c.join, clips: spans.length, beat: beats[k - 1] || '', audio: policy, timing: timingLine(c.seconds, endPic) };
}
// Generators tend to reach the end picture early and then hold it still, or to pile on extra events. This asks for the whole length to be used, with the end picture reached on the last frame.
export const timingLine = (seconds, endPicture) => (endPicture
  ? `Timing: use the full ${seconds} seconds with slow, steady movement the whole time, and reach the end picture on the very last frame, not before. Do not add events that are not listed.`
  : `Timing: move gently for the full ${seconds} seconds. Do not add new events, stay in the same place and light, and do not freeze at the end.`);

export const emptyScene = (n, o = {}) => ({ n, name: o.name || `Scene ${n}`, tag: o.tag || '', seconds: o.seconds || 10, place: o.place || null, time: o.time || '', who: o.who || [], transcript: o.transcript || [], notes: { ...emptyNotes(), ...(o.notes || {}) }, start: { mode: 'stage' }, end: { mode: 'stage' }, clips: clipPlan(o.seconds || 10), overrides: {}, states: [], props: [], moves: [] });

// How many pictures the studio still has to draw for a scene (one credit each).
export const pictureCount = (id, d) => slotsOf(id, d).filter((x) => x.mode === 'stage').length;

// ---- what kind of picture and what kind of being, so a cartoon penguin is not drawn as a photographed man ----
const DRAWN = /cartoon|animat|\b3d\b|\b2d\b|illustrat|drawn|painted|pixar|anime|claymation|clay|plasticine|felt|paper|cut-?out|puppet|stop[- ]?motion|storybook|stylis|toon|picture book|vector|flat colou?r|watercolou?r|gouache|crayon|pencil|sketch|comic|manga|woodcut/i;
const lookText = (look) => { const pick = look && Array.isArray(look.options) ? look.options.find((o) => o.id === look.chosen) : null; return [look && look.look, look && look.name, look && look.period, pick && pick.name, pick && pick.sub, pick && pick.desc].filter(Boolean).join(' '); };
export const isDrawn = (look) => DRAWN.test(lookText(look));
// A handmade stop-motion look (clay, felt, paper, puppets): it moves in steps, like animation shot on twos.
export const isHandmade = (look) => /stop[- ]?motion|clay|plasticine|felt|paper|cut-?out|puppet/i.test(lookText(look));
export const mediumOf = (look) => (isDrawn(look) ? 'illustration' : 'photograph');
const STRONG = /\b(man|woman|boy|girl|person|human|lady|gentleman|grandfather|grandmother|mother|father|teenager|\d+[- ]year[- ]old)\b/i, BEAST = /\b(penguin|bear|seal|cub|cat|kitten|dog|puppy|bird|animal|creature|robot|dragon|fox|rabbit|bunny|elephant|horse|pony|monkey|owl|mouse|duck|duckling|fish|lion|tiger|monster|alien|toy|doll|frog|toad|tortoise|turtle|hedgehog|pig|piglet|cow|calf|sheep|lamb|goat|deer|fawn|snake|lizard|bee|butterfly|ladybug|squirrel|panda|koala|kangaroo|giraffe|zebra|hippo|whale|dolphin|octopus|crab|chick|chicken|hen|bat|hamster|otter|beaver|wolf|raccoon|mole|snail|caterpillar|dinosaur|unicorn|ghost|puppet|beetle|ant|bug|insect|ladybird|ladybug|spider|worm|dragonfly|cricket|firefly|moth|slug|starfish|jellyfish|shark|seahorse|swan|goose|parrot|penguin|robin|sparrow)s?\b/i;
// 'person' unless the description names an animal or creature before it names a human.
export function beingOf(desc) { const t = String(desc || ''), a = t.search(BEAST), p = t.search(STRONG); return a >= 0 && (p < 0 || a < p) ? 'creature' : 'person'; }

// ---- camera words (cin-p-004, cin-p-005, pm-p-013) ----
const SPEED = /\b(slow|slowly|steady|steadily|gentle|gently|fast|quick|quickly|rapid|swift|smooth|smoothly|gradual|gradually)\b/i;
// A move always gets a speed word, and a still camera is said in positive words.
export function normalizeCamera(cam) {
  const c = oneMove(cam); if (!c) return '';
  if (/\b(static|still|locked|fixed|no movement)\b/i.test(c)) return /\bholds?\b/i.test(c) ? c : `${c}, the camera holds still`;
  return SPEED.test(c) ? c : `${c}, slowly`;
}
// Hailuo takes bracketed camera commands; one is a move, several in one bracket would be simultaneous.
const CAMERA_COMMANDS = [[/pan left/i, 'Pan left'], [/pan right/i, 'Pan right'], [/tilt up/i, 'Tilt up'], [/tilt down/i, 'Tilt down'], [/truck left|track(?:ing)? left|slide left/i, 'Truck left'], [/truck right|track(?:ing)? right|slide right/i, 'Truck right'], [/pedestal up|crane up|rising|\brise\b/i, 'Pedestal up'], [/pedestal down|crane down|descend/i, 'Pedestal down'], [/zoom in/i, 'Zoom in'], [/zoom out/i, 'Zoom out'], [/pull|dolly out|back(?:ward)?/i, 'Pull out'], [/push|dolly in|move in|closer/i, 'Push in'], [/shake|handheld/i, 'Shake'], [/follow|tracking|orbit|arc|around/i, 'Tracking shot'], [/static|still|hold/i, 'Static shot']];
export const cameraCommand = (cam) => { const hit = CAMERA_COMMANDS.find(([re]) => re.test(String(cam || ''))); return hit ? hit[1] : ''; };

// ---- how risky a clip is, and so how many tries it deserves (wf-p-006) ----
const RISKY = /\b(hand|hands|paw|paws|pour|pours|water|liquid|pick|picks|throw|throws|catch|catches|dig|digs|walk|walks|run|runs|jump|jumps|dance|dances|fight|crowd|fire|smoke|bubble|bubbles|cloth|rain)\b/gi;
export function clipRisk(d, k) {
  const text = [clipBeats(d)[k - 1], movesOf(d)[k - 1], (clipStates(d) || [])[k]].join(' '); let score = linesOfClip(d, k).length ? 2 : 0;
  score += (d.who || []).length >= 2 ? 1 : 0; score += Math.min(3, new Set((text.match(RISKY) || []).map((x) => x.toLowerCase())).size);
  return score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';
}
export const attemptBudget = (risk) => ({ low: 2, medium: 3, high: 4 })[risk] || 3;

// ---- speech that fits the clip (aud-p-002, aud-p-012) ----
export function dialogueLoad(d, k) {
  const lines = linesOfClip(d, k), words = lines.reduce((a, l) => a + String(l.text).trim().split(/\s+/).filter(Boolean).length, 0), speakers = [...new Set(lines.map((l) => l.who || 'NARRATOR'))], seconds = (clipSpans(d)[k - 1] || {}).seconds || 0, warnings = [];
  if (seconds && words > Math.ceil(seconds * 2.5)) warnings.push(`${words} words in ${seconds} s is too fast to speak; cut it to about ${Math.floor(seconds * 2.5)} words`);
  if (speakers.length > 2) warnings.push(`${speakers.length} speakers in one clip; generators handle two at most`);
  return { words, speakers, warnings };
}

// ---- the yes/no questions a reviewer answers about a finished clip (qa-p-001) ----
export function clipChecklist(d, k) {
  const st = clipStates(d), q = [], mv = movesOf(d)[k - 1];
  if (st) q.push(`Does the first frame match this: ${st[k - 1]}`, `Does the last frame match this: ${st[k]}`);
  for (const p of propsInClip(d, k)) if (p.count) q.push(`Is there exactly ${p.count} ${p.name} in every frame where it is visible?`);
  q.push('Do the place, the background and the framing stay the same in every frame?', 'Does every character look the same in every frame (same clothes, colours, shape)?', 'Is it true that nothing appears, vanishes, multiplies or changes size without being asked for?');
  if (mv) q.push(`Does the clip show this, in this order: ${mv}`);
  return q;
}

// ---- what kind of creature a character is, in a word, and a short look for it: image models follow a name badly and a kind well ----
export const beastOf = (desc) => { const m = String(desc || '').match(BEAST); return m ? m[0].toLowerCase().replace(/s$/, '') : ''; };
export function shortLook(desc, name = '') {
  let t = String(desc || '').trim().replace(new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(is|was)\\s+`, 'i'), '').replace(/^(an?|the)\s+/i, '');
  t = t.split(/\s+(?:with|who|that|wearing|always)\s+|[,.;]/)[0].trim(); return t.length > 70 ? t.slice(0, 70).replace(/\s+\S*$/, '') : t;
}
// A name that is also a common word (Moss, Pip, Rose, Sunny) pulls an image model toward that word, so an image prompt never uses the name: "Moss left and Pip right" becomes
// "the small grey-green clay snail left and the tiny orange clay beetle right". The look comes from the character's description.
export function expandNames(text, chars) {
  let out = String(text || '');
  for (const c of chars || []) { if (!c.name || !c.look) continue; out = out.replace(new RegExp(`\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), `the ${c.look}`); }
  return out.replace(/(^|[.!?]\s+)the /g, (m, a) => `${a}The `);
}
// A description without the character's name in it ("Moss is a small snail" becomes "A small snail"), for an image prompt.
export function plainDesc(desc, name = '') {
  const t = String(desc || '').trim().replace(new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(is|was)\\s+`, 'i'), '').replace(new RegExp(`\\b${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), 'it');
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}
