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
  const plan = (d.clips || []).length || 1, frames = [];
  for (let n = 1; n <= plan; n++) { if (n === 1 && d.start && d.start.mode !== 'skip') frames.push(ctx.get(R.frame(id, 1, 'start'))); if (n === plan && d.end && d.end.mode !== 'skip') frames.push(ctx.get(R.frame(id, n, 'end'))); }
  const chosen = (f) => f && f.data && f.data.chosen;
  const pictures = !frames.length ? (d.start || d.end ? 2 : 0) : frames.every(chosen) ? 2 : frames.some((f) => f && (ctx.assets(f.ref) || []).length) ? 1 : 0;
  const sound = !(d.transcript || []).length ? (brief ? 2 : 0) : (d.transcript || []).every((l) => (l.text || '').trim()) ? 2 : 1;
  const pack = brief === 2 && stage > 0 && pictures === 2 && sound === 2 ? 2 : brief || stage || pictures || sound ? 1 : 0;
  return [brief, stage, pictures, sound, pack];
}

// The words a generator receives for one clip, built only from approved film canon and this scene's brief. Pure, so the page, the pack and the Worker agree.
export function composeClip(scene, film, clipIndex = 1) {
  const d = scene.data || {}, n = d.notes || {}, clips = d.clips && d.clips.length ? d.clips : clipPlan(d.seconds), c = clips[clipIndex - 1] || clips[0];
  const look = film.look || {}, never = [...new Set([...(String(n.never || '').split(/[.;\n]/).map((s) => s.trim()).filter(Boolean)), ...(Array.isArray(look.forbidden) ? look.forbidden : String(look.forbidden || '').split(',').map((s) => s.trim()).filter(Boolean)).map((t) => `no ${t}`)])];
  const lines = (d.transcript || []).filter((l) => l.text);
  const parts = [n.happens, n.mood && `Mood and pace: ${n.mood}`, n.cam && `Camera: ${n.cam}`, n.sound && `Sound: ${n.sound}`,
    `Look: ${look.look || look.base || 'as in the film'}. ${look.aspect || '9:16'}, ${look.fps || 24} fps, ${c.seconds} seconds.`];
  if (lines.length) parts.push(`Dialogue: ${lines.map((l) => `${l.who || 'NARRATOR'} says${film.speech ? `, in ${film.speech},` : ''} "${l.text}"${l.en ? ` (${l.en})` : ''}`).join(' ')}`);
  if (clipIndex > 1) parts.push(c.join === 'cut' ? 'This clip is a cut to a new view. It has its own start picture.' : 'Continue from the last picture of the previous clip.');
  return { prompt: parts.filter(Boolean).join('\n'), negative: never.join('. '), seconds: c.seconds, join: c.join, clips: clips.length };
}

export const emptyScene = (n, o = {}) => ({ n, name: o.name || `Scene ${n}`, tag: o.tag || '', seconds: o.seconds || 10, place: o.place || null, time: o.time || '', who: o.who || [], transcript: o.transcript || [], notes: { ...emptyNotes(), ...(o.notes || {}) }, start: { mode: 'stage' }, end: { mode: 'stage' }, clips: clipPlan(o.seconds || 10), overrides: {} });
