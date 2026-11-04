// Turns an approved stage into the exact input for one generator: the control images and camera it accepts, and words for the rest.
import { HttpError } from './util.js';
import { parseJson } from './util.js';
import { composePrompt, checkStage, parseAspect } from '../public/js/stage-math.js';

export const ACCEPTS = ['layout', 'depth', 'ids', 'pose', 'camera', 'first_frame', 'prompt']; // what a tool may declare in target.accepts

export async function loadStage(db, pid, ref) {
  const a = await db.prepare('SELECT * FROM artifacts WHERE production=? AND ref=?').bind(pid, ref).first();
  if (!a || a.kind !== 'stage') throw new HttpError(404, `no stage ${ref}`);
  const assets = (await db.prepare('SELECT id,uri,mime,provenance FROM assets WHERE production=? AND ref=? ORDER BY ts').bind(pid, ref).all()).results.map((x) => ({ ...x, provenance: parseJson(x.provenance) }));
  const style = await db.prepare("SELECT data FROM artifacts WHERE production=? AND ref='canon.style:look'").bind(pid).first();
  return { artifact: a, stage: parseJson(a.data), assets, style: style ? parseJson(style.data) : {} };
}
export async function validateStage(db, pid, ref) {
  const { stage, style } = await loadStage(db, pid, ref);
  const cast = (await db.prepare("SELECT ref FROM artifacts WHERE production=? AND kind='canon.cast'").bind(pid).all()).results.map((r) => r.ref);
  return checkStage(stage, { aspect: style.aspect || '9:16', cast });
}

// The newest asset for each role (layout, depth, ids, pose, camera) that the stage has rendered for this shot.
const latest = (assets, role, shot) => [...assets].reverse().find((x) => x.provenance.role === role && (!x.provenance.shot || x.provenance.shot === shot));
export async function stageInput(db, pid, { ref, shot, accepts = ACCEPTS }) {
  const { artifact, stage, assets, style } = await loadStage(db, pid, ref);
  if (!(stage.shots || {})[shot]) throw new HttpError(404, `${ref} has no camera for ${shot}`);
  const files = [], words = [], want = new Set(accepts);
  for (const role of ['layout', 'depth', 'ids', 'pose']) { const a = want.has(role) && latest(assets, role, shot); if (a) files.push({ role, uri: a.uri, mime: a.mime }); }
  const cam = stage.cameras[stage.shots[shot].camera], camAsset = want.has('camera') && latest(assets, 'camera', shot);
  if (camAsset) files.push({ role: 'camera', uri: camAsset.uri, mime: camAsset.mime });
  if (want.has('first_frame')) {
    const kf = await db.prepare('SELECT data FROM artifacts WHERE production=? AND ref=?').bind(pid, `keyframe:${shot.slice(5)}`).first(), pick = kf && parseJson(kf.data).pick;
    if (pick) { const a = (await db.prepare('SELECT uri,mime FROM assets WHERE production=? AND ref=? AND (uri LIKE ? OR uri LIKE ?)').bind(pid, `keyframe:${shot.slice(5)}`, `%img-${pick}.jpg`, `%${pick}.png`).first()); if (a) files.push({ role: 'first_frame', uri: a.uri, mime: a.mime }); }
  }
  const anchors = []; // each character's chosen face, so a generator can keep them consistent
  for (const c of stage.characters || []) if (c.anchor && c.cast) { const a = await db.prepare('SELECT uri FROM assets WHERE production=? AND ref=? AND uri LIKE ?').bind(pid, c.cast, `%img-${c.anchor}.jpg`).first(); if (a) anchors.push({ id: c.id, cast: c.cast, uri: a.uri }); }
  // Whatever the tool cannot take as a file is written into the prompt, so nothing the human decided is dropped.
  const given = new Set(files.map((f) => f.role)), missing = ['layout', 'depth', 'ids', 'pose', 'camera'].filter((r) => !given.has(r));
  const prompt = want.has('prompt') || missing.length ? composePrompt(stage, shot, style) : '';
  return { stage: ref, shot, version: artifact.version, aspect: parseAspect(style.aspect), files, anchors, camera: given.has('camera') ? undefined : cam, prompt, described_in_words: missing, accepts: [...want] };
}
