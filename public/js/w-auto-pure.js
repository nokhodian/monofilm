// "Roll camera": the AI does every step and approves it. This file only decides WHAT TO DO NEXT from the studio's current state, so it can be tested.
// It looks at the state afresh each time, so a run that was stopped (closed tab, no credits) simply carries on from where the work really is.
import { R, REFS, keyOf } from './wizard-model.js';
import { slotsOf } from './w-stage-pure.js';

const byN = (a, b) => ((a.data || {}).n || 0) - ((b.data || {}).n || 0), byRef = (a, b) => a.ref.localeCompare(b.ref);
const isPlace = (a) => a.kind === 'canon.world' && a.ref.startsWith('canon.world:place-');
const APPROVABLE = (a) => ['bible', 'canon.cast', 'canon.voice', 'canon.style', 'scene'].includes(a.kind) || isPlace(a);
const imgs = (a) => ((a && a.assets) || []).filter((x) => (x.mime || 'image/').startsWith('image/'));
const kids = (d) => ({ cast: d.arts.filter((a) => a.kind === 'canon.cast').sort(byRef), places: d.arts.filter(isPlace).sort(byRef), scenes: d.arts.filter((a) => a.kind === 'scene').sort(byN) });

// The next thing to do, or { type: 'done' } or { type: 'blocked', why }. Order: read, approve, faces, anchors, places, scenes, then each scene's stage and pictures.
export function plan(d) {
  const story = d.by[REFS.story];
  if (!story || !String((story.data || {}).text || '').trim()) return { type: 'blocked', why: 'Write your story first.' };
  if (!d.by[REFS.reading] || !d.by[REFS.look]) return { type: 'read' }; // the reading also makes the look; if it is missing, read again
  const todo = d.arts.filter((a) => a.status === 'proposed' && APPROVABLE(a));
  if (todo.length) return { type: 'approve', refs: todo.map((a) => a.ref) };
  const { cast, places, scenes } = kids(d);
  for (const c of cast) if (!((c.data || {}).candidates || []).length) return { type: 'face', id: keyOf(c.ref), name: c.data.name, cost: 1 };
  for (const c of cast) if (!(c.data || {}).anchor) return { type: 'anchor', ref: c.ref, name: c.data.name, assetId: c.data.candidates[0].id };
  for (const c of cast) if (!(((c.data || {}).views) || []).length) return { type: 'views', id: keyOf(c.ref), name: c.data.name, cost: 2 }; // a full-body and a side view from the chosen face
  for (const p of places) if (!((p.data || {}).plates || []).length && (p.data || {}).source !== 'photo') return { type: 'plate', id: keyOf(p.ref).replace(/^place-/, ''), name: p.data.name, cost: 1 };
  if (!scenes.length) return { type: 'scenes' };
  for (const s of scenes) {
    const id = keyOf(s.ref);
    if (!d.by[R.stage(id)]) return { type: 'stage', scene: id, name: s.data.name, n: s.data.n };
    for (const slot of slotsOf(id, s.data)) {
      if (slot.mode !== 'stage') continue; // skipped, taken from the scene before, or the person's own picture: nothing to make
      const kf = d.by[slot.ref]; if (kf && kf.data && kf.data.chosen) continue;
      const have = imgs(kf);
      if (!have.length) return { type: 'frame', scene: id, clip: slot.clip, which: slot.which, ref: slot.ref, name: s.data.name, n: s.data.n, cost: 1 };
      return { type: 'pick', ref: slot.ref, assetId: have[have.length - 1].id, scene: id, which: slot.which, name: s.data.name, n: s.data.n };
    }
  }
  return { type: 'done' };
}

// How many more moves there are, roughly (it grows once the scenes exist). Used for the progress bar.
export function remaining(d) {
  const story = d.by[REFS.story]; if (!story || !d.by[REFS.reading]) return 14;
  const { cast, places, scenes } = kids(d);
  let n = d.arts.some((a) => a.status === 'proposed' && APPROVABLE(a)) ? 1 : 0;
  for (const c of cast) n += ((c.data || {}).candidates || []).length ? 0 : 1, n += (c.data || {}).anchor ? 0 : 1, n += ((c.data || {}).views || []).length ? 0 : 1;
  for (const p of places) n += ((p.data || {}).plates || []).length || (p.data || {}).source === 'photo' ? 0 : 1;
  if (!scenes.length) return n + 1 + 5 * 3;
  for (const s of scenes) { const id = keyOf(s.ref); n += d.by[R.stage(id)] ? 0 : 1; for (const slot of slotsOf(id, s.data)) { if (slot.mode !== 'stage') continue; const kf = d.by[slot.ref]; if (kf && kf.data && kf.data.chosen) continue; n += imgs(kf).length ? 1 : 2; } }
  return n;
}

// Credits it will take: one per face, plate and picture. Before the story is read it is a guess (3 people, 3 places, 5 scenes).
export function estimate(d) {
  if (!d.by[REFS.reading]) return { credits: 16, rough: true };
  const { cast, places, scenes } = kids(d);
  let c = cast.filter((x) => !((x.data || {}).candidates || []).length).length + 2 * cast.filter((x) => !((x.data || {}).views || []).length).length + places.filter((p) => !((p.data || {}).plates || []).length && (p.data || {}).source !== 'photo').length;
  if (!scenes.length) return { credits: c + 9, rough: true };
  for (const s of scenes) for (const slot of slotsOf(keyOf(s.ref), s.data)) { if (slot.mode !== 'stage') continue; const kf = d.by[slot.ref]; if (!(kf && kf.data && kf.data.chosen) && !imgs(kf).length) c++; }
  return { credits: c, rough: false };
}

// Plain words for a move, and the wizard page it happens on.
const stepOf = (ref) => (ref.startsWith('canon.style') ? 'look' : /^canon\.(cast|voice)/.test(ref) ? 'people' : ref.startsWith('canon.world') ? 'places' : ref.startsWith('scene:') ? 'scenes' : 'understand');
export function describe(a) {
  const sc = a.scene ? `scene ${a.n}, ${a.name}` : '';
  switch (a.type) {
    case 'read': return { title: 'Reading your story', sub: 'Finding the people, places and beats, and three looks to choose from.', page: 'start' };
    case 'approve': { const steps = [...new Set(a.refs.map(stepOf))]; return { title: `Approving ${a.refs.length} thing${a.refs.length === 1 ? '' : 's'} I made`, sub: 'Checking each one off for you, so the next step can build on it.', page: steps.length === 1 ? steps[0] : steps[0] }; }
    case 'face': return { title: `Making a face for ${a.name}`, sub: 'Muse Image draws a portrait from the description and the look.', page: 'people' };
    case 'views': return { title: `Drawing ${a.name} from head to toe and from the side`, sub: 'More pictures of the same person keep them the same in every scene.', page: 'people' };
    case 'anchor': return { title: `Choosing ${a.name}'s main face`, sub: 'Every later picture of this person must match it.', page: 'people' };
    case 'plate': return { title: `Making a picture of ${a.name}`, sub: 'The place every scene there is built on.', page: 'places' };
    case 'scenes': return { title: 'Turning the story into scenes', sub: 'Muse Spark writes each scene: what happens, the camera, the sound, the lines.', page: 'scenes' };
    case 'stage': return { title: `Setting up the stage for ${sc}`, sub: 'Who stands where, and where the camera is.', scene: a.scene, sub2: 'stage' };
    case 'frame': return { title: `Making the ${a.which} picture for ${sc}`, sub: 'Muse Image draws it from the stage layout and the main faces.', scene: a.scene, sub2: 'pictures' };
    case 'pick': return { title: `Choosing the ${a.which} picture for ${sc}`, sub: 'Putting it in use.', scene: a.scene, sub2: 'pictures' };
    case 'done': return { title: 'Your film is ready', sub: 'Everything is made and approved.', page: 'ship' };
    default: return { title: 'Working', sub: '', page: 'start' };
  }
}
// The hash of the page where this move happens, e.g. '#/w/scenes/the-crack/pictures'.
export const pageOf = (a) => { const x = describe(a); return `#/w/${x.scene ? `scenes/${x.scene}/${x.sub2}` : x.page}`; };
