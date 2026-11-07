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
const AUDIO_TEXT = { dialogue: 'Audio: only the spoken lines above, with quiet room sound. No music.', ambient: 'Audio: only the ambient sound described above. No speech, no music.', silent: 'Audio: none. No speech, no voices, no music.' };

// A generator cuts when the camera line lists several shots ("close on hands, then her face"). A clip gets only the first move.
export const oneMove = (cam) => String(cam || '').split(/[,;.]?\s+(?:and then|then|followed by|cut to|next|after that|before)\s+/i)[0].replace(/\bshots\b/i, 'shot').trim();
// What a video generator can take. A clip's words are adapted to it; an unknown generator gets the plain prompt.
export const GENERATORS = {
  'minimax-h3': { name: 'MiniMax H3 (local, ComfyUI)', negative: false, end_picture: true, native_audio: true, max_seconds: 8, notes: 'No negative prompt input (it is added to the prompt as "Do not show"). Cuts when the prompt lists several shots. Natural walking and consistent voices across clips are weak.' },
  generic: { name: 'Any generator', negative: true, end_picture: true, native_audio: true, max_seconds: 8, notes: '' },
};
export const forGenerator = (clip, id) => { const k = Object.hasOwn(GENERATORS, id) ? id : 'generic', g = GENERATORS[k]; return { ...clip, generator: { id: k, ...g }, prompt: !g.negative && clip.negative ? `${clip.prompt}\nDo not show: ${clip.negative}.` : clip.prompt, negative: g.negative ? clip.negative : '' }; };
// The words a generator receives for one clip, built only from approved film canon and this scene's brief. Pure, so the page, the pack and the Worker agree.
// film = { look, speech, cast: { '<canon.cast ref>': { name, desc } } }
export function composeClip(scene, film, clipIndex = 1) {
  const d = scene.data || {}, n = d.notes || {}, spans = clipSpans(d), c = spans[clipIndex - 1] || spans[0], k = c.n;
  const look = film.look || {}, never = [...new Set([...(String(n.never || '').split(/[.;\n]/).map((s) => s.trim()).filter(Boolean)), ...(Array.isArray(look.forbidden) ? look.forbidden : String(look.forbidden || '').split(',').map((s) => s.trim()).filter(Boolean)).map((t) => `no ${t}`)])];
  const lines = linesOfClip(d, k), beats = clipBeats(d), endPic = k === spans.length ? hasEnd(d) : midEnds(d), policy = audioPolicy(d, k), cast = film.cast || {};
  const who = (d.who || []).map((r) => cast[r]).filter((p) => p && p.desc);
  const parts = [beats[k - 1] || (spans.length > 1 ? 'Carry on calmly from the clip before.' : n.happens), k > 1 && beats[k - 2] ? `The clip before ended on: ${beats[k - 2]} Do not repeat it.` : '', n.mood && `Mood and pace: ${n.mood}`, n.cam && `Camera: ${oneMove(n.cam)}, one continuous shot`, n.sound && `Sound: ${n.sound}`,
    who.length ? `Characters (keep each one exactly as in its reference picture): ${who.map((p) => `${p.name}: ${p.desc}`).join(' ')}` : '',
    `Look: ${look.look || look.base || 'as in the film'}. ${look.aspect || '9:16'}, ${look.fps || 24} fps, ${c.seconds} seconds. The medium, colours, exposure and time of day stay exactly the same for the whole clip. No scene change, no cuts, no text on screen.`];
  if (lines.length) parts.push(`Dialogue: ${lines.map((l) => `${l.who || 'NARRATOR'} says${film.speech ? `, in ${film.speech},` : ''} "${l.text}"${l.en && String(l.en).trim().toLowerCase() !== String(l.text).trim().toLowerCase() ? ` (${l.en})` : ''}`).join(' ')}`);
  if (k > 1) parts.push(c.join === 'cut' ? 'This clip is a cut to a new view. It has its own start picture.' : endPic ? 'It begins from the end picture of the clip before.' : 'Continue from the last picture of the previous clip.');
  parts.push(AUDIO_TEXT[policy], timingLine(c.seconds, endPic));
  const st = clipStates(d), pr = propsOf(d);
  if (st) parts.splice(parts.findIndex((x) => /^Look: /.test(x || '')), 0, `It begins like this: ${st[k - 1]}\nIt ends like this, and nothing further happens: ${st[k]}`);
  if (pr.length) parts.splice(parts.findIndex((x) => /^Look: /.test(x || '')), 0, `Things in this scene (always look exactly like this, never bigger or smaller, never a different colour): ${pr.map((p) => `${p.name}: ${p.look}`).join('; ')}`);
  return { prompt: parts.filter(Boolean).join('\n'), negative: never.join('. '), seconds: c.seconds, join: c.join, clips: spans.length, beat: beats[k - 1] || '', audio: policy, timing: timingLine(c.seconds, endPic) };
}
// Generators tend to reach the end picture early and then hold it still, or to pile on extra events. This asks for the whole length to be used, with the end picture reached on the last frame.
export const timingLine = (seconds, endPicture) => (endPicture
  ? `Timing: use the full ${seconds} seconds with slow, steady movement the whole time, and reach the end picture on the very last frame, not before. Do not add events that are not listed.`
  : `Timing: move gently for the full ${seconds} seconds. Do not add new events, stay in the same place and light, and do not freeze at the end.`);

export const emptyScene = (n, o = {}) => ({ n, name: o.name || `Scene ${n}`, tag: o.tag || '', seconds: o.seconds || 10, place: o.place || null, time: o.time || '', who: o.who || [], transcript: o.transcript || [], notes: { ...emptyNotes(), ...(o.notes || {}) }, start: { mode: 'stage' }, end: { mode: 'stage' }, clips: clipPlan(o.seconds || 10), overrides: {}, states: [], props: [] });

// How many pictures the studio still has to draw for a scene (one credit each).
export const pictureCount = (id, d) => slotsOf(id, d).filter((x) => x.mode === 'stage').length;

// ---- what kind of picture and what kind of being, so a cartoon penguin is not drawn as a photographed man ----
export const isDrawn = (look) => /cartoon|animat|\b3d\b|illustrat|drawn|painted|pixar|anime|claymation|storybook|stylis|toon/i.test([look && look.look, look && look.name, look && look.period].filter(Boolean).join(' '));
export const mediumOf = (look) => (isDrawn(look) ? 'illustration' : 'photograph');
const STRONG = /\b(man|woman|boy|girl|person|human|lady|gentleman|grandfather|grandmother|mother|father|teenager|\d+[- ]year[- ]old)\b/i, BEAST = /\b(penguin|bear|seal|cub|cat|kitten|dog|puppy|bird|animal|creature|robot|dragon|fox|rabbit|bunny|elephant|horse|monkey|owl|mouse|duck|fish|lion|tiger|monster|alien|toy|doll)\b/i;
// 'person' unless the description names an animal or creature before it names a human.
export function beingOf(desc) { const t = String(desc || ''), a = t.search(BEAST), p = t.search(STRONG); return a >= 0 && (p < 0 || a < p) ? 'creature' : 'person'; }
