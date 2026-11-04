// Did the picture follow the stage? SAM 3.1 finds the people and objects, and we compare each box with where the stage put it.
import { HttpError } from './util.js';
import { loadStage } from './stage.js';
import { sam, dataUrl } from './meta.js';
import { expectedBoxes, compareAdherence } from '../public/js/stage-math.js';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
export async function checkAdherence(env, db, pid, { stage: ref, shot, uri }, f) {
  const { stage, style } = await loadStage(db, pid, ref), exp = expectedBoxes(stage, shot, style.aspect || '9:16');
  if (!exp.length) throw new HttpError(404, `${shot} has nothing in frame on ${ref}, or no camera`);
  if (!env.MEDIA || !/^media\/[A-Za-z0-9]+\/[A-Za-z0-9._-]+$/.test(uri || '')) throw new HttpError(400, 'uri must be a picture stored in this studio (media/...)');
  const obj = await env.MEDIA.get(uri.slice(6)); if (!obj) throw new HttpError(404, 'no such picture');
  const image = dataUrl(await obj.arrayBuffer(), (obj.httpMetadata && obj.httpMetadata.contentType) || MIME[uri.split('.').pop()] || 'image/png');
  const found = {};
  for (const concept of [...new Set(exp.map((e) => e.concept))]) found[concept] = await sam(env, { image, concept }, f); // SAM takes one concept per request
  return { stage: ref, shot, uri, ...compareAdherence(exp, found), expected: exp.map(({ id, type, box }) => ({ id, type, box })) };
}
