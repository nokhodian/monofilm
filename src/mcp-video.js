// MCP tools for a video generation model. Flow: list_clips -> get_clip (words, start and end pictures, references) -> make the clip -> submit_take.
// Everything the model needs comes in one answer, and every file has an absolute url it can fetch with the same bearer token (or get_media returns a picture inline).
import { HttpError, bad, parseJson } from './util.js';
import * as S from './store.js';
import { retryAdvice } from '../public/js/pack.js';
import { R, REFS, keyOf, clipPlan, composeClip, startOf, hasEnd, midEnds, forGenerator, GENERATORS } from '../public/js/wizard-model.js';
import { ensureClips, addTake } from './wizard.js';
import { reviewFrames } from './takereview.js';

const MAX_VIDEO = 25 * 1024 * 1024, MAX_INLINE = 4 * 1024 * 1024;
const str = { type: 'string' }, num = { type: 'number' };
const prod = { production: { ...str, description: 'production id' } };
const T = (name, description, props, required, run) => ({ name, description, inputSchema: { type: 'object', properties: props, required }, run });
const STUDIO = { id: 'studio', name: 'studio', kind: 'human', role: 'admin' }; // only sets up the empty clip shells that the human already approved the scene for

const mediaUrl = (c, pid, uri) => (/^media\//.test(uri || '') ? `${c.origin || ''}/api/p/${pid}/media/${uri.split('/').pop()}` : uri || null);
const pic = (c, pid, uri) => (uri ? { uri, url: mediaUrl(c, pid, uri) } : null);

async function load(c, pid) {
  const [arts, assets] = await Promise.all([S.listArtifacts(c.db, pid), S.assetsByRef(c.db, pid)]);
  const by = Object.fromEntries(arts.map((a) => [a.ref, a])), data = (ref) => (by[ref] ? by[ref].data : null);
  const uriOf = (ref, id) => { const x = (assets[ref] || []).find((a) => a.id === id); return x ? x.uri : null; };
  const fmt = (data(REFS.story) || {}).format || {}, look = data(REFS.look) || {};
  const cast = Object.fromEntries(arts.filter((a) => a.kind === 'canon.cast').map((a) => [a.ref, { name: a.data.name, desc: a.data.desc || '' }])), film = { look, speech: fmt.speech || '', captions: fmt.captions || [], cast };
  return { arts, assets, by, data, uriOf, film };
}
const sceneList = (L, only) => L.arts.filter((a) => a.kind === 'scene' && (!only || keyOf(a.ref) === only)).sort((a, b) => (a.data.n || 0) - (b.data.n || 0));

function clipSpec(c, pid, L, sc, n) {
  const id = keyOf(sc.ref), d = sc.data, clips = d.clips && d.clips.length ? d.clips : clipPlan(d.seconds), cl = clips[n - 1];
  if (!cl) throw new HttpError(404, `scene ${id} has no clip ${n} (it has ${clips.length})`);
  const last = n === clips.length, frame2 = (k, which) => { const f = L.data(R.frame(id, k, which)); return f && f.chosen ? L.uriOf(R.frame(id, k, which), f.chosen) : null; }, frame = (which) => frame2(n, which);
  const from = startOf(d, n), startUri = from === 'start' || from === 'own' ? frame2(n, 'start') : from === 'prev-end' ? frame2(n - 1, 'end') : null, endOk = last ? hasEnd(d) : midEnds(d), p = composeClip(sc, { ...L.film, pictures: !!startUri }, n);
  const takes = L.arts.filter((a) => a.kind === 'take' && a.data.scene === id && a.data.clip === n);
  const stage = (L.assets[R.stage(id)] || []).filter((a) => a.provenance && a.provenance.role && (!a.provenance.shot || a.provenance.shot.endsWith(`-c${n}`) || n === 1));
  return {
    production: pid, scene: id, scene_name: d.name, clip: n, of: clips.length, seconds: p.seconds, aspect: L.film.look.aspect || '9:16', fps: L.film.look.fps || 24,
    prompt: p.prompt, negative_prompt: p.negative, spoken_language: L.film.speech || null,
    timing: p.timing, // the end picture is the last frame only: land on it on the final frame, never hold it still
    begins: n === 1 ? 'start' : cl.join === 'cut' ? 'cut' : 'continues',
    start_picture: startUri ? pic(c, pid, startUri) : null,
    end_picture: endOk && frame('end') ? pic(c, pid, frame('end')) : null,
    continue_from: n > 1 && cl.join !== 'cut' ? (from === 'prev-end' ? `the end picture of clip ${n - 1} (it is this clip's start_picture)` : `the last frame of clip ${n - 1}, from the take you made for it`) : null,
    beat: p.beat, // what happens in this clip only; the clip before covers the rest
    audio_policy: p.audio, // silent, ambient or dialogue: ask the model for exactly that and nothing more
    transition_in: n === 1 ? (d.start && d.start.mode === 'chain' ? 'continues from the previous scene' : 'cut') : null,
    references_note: 'Models that only take a start and an end picture cannot use references: the start and end pictures and the character sentences in the prompt are what keep the film consistent.',
    references: (d.who || []).map((w) => { const cast = L.data(w) || {}, uri = cast.anchor ? L.uriOf(w, cast.anchor) : null; return uri ? { id: keyOf(w), name: cast.name || keyOf(w), ...pic(c, pid, uri) } : null; }).filter(Boolean),
    stage_controls: stage.map((a) => ({ role: a.provenance.role, ...pic(c, pid, a.uri) })),
    takes: takes.map((t) => ({ ref: t.ref, status: t.status, picked: !!t.data.picked, ...(t.data.seed != null ? { seed: t.data.seed } : {}), ...(t.data.cuts ? { cuts: t.data.cuts } : {}), ...(t.data.hold ? { stands_still_at_end_seconds: t.data.hold } : {}), ...(t.data.smooth && t.data.smooth.flag ? { jumps_at_seconds: t.data.smooth.at } : {}) })),
    assembly: { trim_start_frames: n > 1 && cl.join !== 'cut' ? 2 : 0, cut_on_motion: true, note: 'The first frames of a continued clip are often smeared: start the edit at frame 3, and cut while something is still moving, not on a still frame.' },
    retry: retryAdvice(id, n, takes.filter((t) => !(t.updated < sc.updated)).map((t) => t.data)), // takes made before the scene was last changed belong to an older plan and do not count against the tries
    next: 'Make this clip with retry.seed, then measure it (npm run measure -- <file>) and call submit_take with the video, the seed and the measures. If retry.try_again is true, add retry.add_to_prompt to the prompt and make it again with the new seed.',
  };
}

async function storeVideo(c, pid, a) {
  if (a.uri) { if (!new RegExp(`^media/${pid}/[A-Za-z0-9._-]{1,100}$`).test(a.uri)) throw bad(`uri must look like media/${pid}/<file>, a file already uploaded to this production`); return a.uri; }
  if (!c.env.MEDIA) throw new HttpError(501, 'media storage is not configured');
  let bytes, mime = a.mime || 'video/mp4';
  if (a.data_base64) {
    if (a.data_base64.length > MAX_VIDEO * 1.4) throw new HttpError(413, 'clip too large (25 MB max)');
    try { bytes = Uint8Array.from(atob(a.data_base64), (ch) => ch.charCodeAt(0)); } catch { throw bad('data_base64 is not valid base64'); }
  } else if (a.url) {
    if (!/^https:\/\//.test(a.url)) throw bad('url must start with https://');
    const r = await (c.fetch || fetch)(a.url).catch((e) => { throw new HttpError(502, `could not fetch the clip: ${e.message}`); });
    if (!r.ok) throw new HttpError(502, `the clip url answered ${r.status}`);
    const len = Number(r.headers.get('content-length') || 0); if (len > MAX_VIDEO) throw new HttpError(413, 'clip too large (25 MB max)');
    bytes = new Uint8Array(await r.arrayBuffer()); mime = (r.headers.get('content-type') || mime).split(';')[0];
  } else throw bad('give the clip as url (https), data_base64 or uri (media/...)');
  if (bytes.length > MAX_VIDEO) throw new HttpError(413, 'clip too large (25 MB max)');
  if (!bytes.length) throw bad('the clip is empty');
  const ext = /webm/.test(mime) ? 'webm' : 'mp4', name = `take-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  await c.env.MEDIA.put(`${pid}/${name}`, bytes, { httpMetadata: { contentType: mime.startsWith('video/') ? mime : 'video/mp4' } });
  return `media/${pid}/${name}`;
}

export const VIDEO_TOOLS = [
  T('list_clips', 'Every clip of the film in order, with its length, whether its start and end pictures are ready, and how many takes came back. Pass scene to see one scene. Start here if you make video.', { ...prod, scene: { ...str, description: 'scene id, e.g. "hook"' } }, ['production'], async (c, a) => {
    const L = await load(c, a.production);
    return sceneList(L, a.scene).flatMap((sc) => { const id = keyOf(sc.ref), clips = sc.data.clips && sc.data.clips.length ? sc.data.clips : clipPlan(sc.data.seconds);
      return clips.map((cl, i) => { const s = clipSpec(c, a.production, L, sc, i + 1); return { scene: id, scene_name: sc.data.name, scene_status: sc.status, clip: i + 1, of: clips.length, seconds: cl.seconds, ready: ['approved', 'locked'].includes(sc.status), start_picture: !!s.start_picture, end_picture: !!s.end_picture, takes: s.takes.length }; }); });
  }),
  T('get_clip', 'Everything needed to make one clip: the prompt, what must not show, length, shape, fps, the start picture and end picture (with urls), reference pictures of the people, stage control images, and the takes already made.', { ...prod, scene: str, clip: { ...num, description: 'clip number, from 1' }, generator: { ...str, description: 'the video model you use, from list_generators (for example minimax-h3), so the words fit it' } }, ['production', 'scene'], async (c, a) => {
    const L = await load(c, a.production), sc = sceneList(L, a.scene)[0]; if (!sc) throw new HttpError(404, `no scene ${a.scene}`);
    const spec = clipSpec(c, a.production, L, sc, Math.round(Number(a.clip) || 1)), g = forGenerator({ prompt: spec.prompt, negative: spec.negative_prompt }, a.generator);
    const cap = g.generator.max_refs, refs = cap && spec.references.length > cap ? spec.references.slice(0, cap) : spec.references; // the generator takes only so many reference pictures: the first people in the scene keep theirs
    return { ...spec, prompt: g.prompt, negative_prompt: g.negative, references: refs, ...(refs.length < spec.references.length ? { references_dropped: spec.references.slice(refs.length).map((r) => r.name) } : {}), ...(g.compacted ? { prompt_compacted: true } : {}), generator: g.generator };
  }),
  T('review_take', 'Before you submit a clip, send 6 to 8 small frames of it (jpeg, base64, in time order, about 384 px wide) and the studio looks at them against what was asked: object counts, physics, jumps in the place, identity. It answers {ok, issues, advice}; if not ok, add the advice to the prompt and make the clip again.', { ...prod, scene: str, clip: { ...num, description: 'clip number, from 1' }, frames: { type: 'array', items: str, description: 'base64 jpeg frames, in time order' } }, ['production', 'scene', 'clip', 'frames'], async (c, a) => {
    const L = await load(c, a.production), sc = sceneList(L, a.scene)[0]; if (!sc) throw new HttpError(404, `no scene ${a.scene}`);
    const n = Math.round(Number(a.clip) || 1), spec = clipSpec(c, a.production, L, sc, n);
    const pics = []; for (const [what, x] of [['start', spec.start_picture], ['end', spec.end_picture]]) if (x && x.uri) pics.push({ what, uri: x.uri });
    return reviewFrames(c.env, { frames: a.frames, asked: spec.prompt, pictures: pics });
  }),
  T('list_generators', 'The video models the studio knows, with what each can take and its quirks. Pass the id as generator to get_clip so the words fit your model.', {}, [], async () => ({ generators: Object.entries(GENERATORS).map(([id, g]) => ({ id, ...g })) })),
  T('get_media', 'Read a picture of this production (a media/ uri from get_clip) and get it back inline so you can look at it. Pictures up to 4 MB. For video use the url with your bearer token.', { ...prod, uri: str }, ['production', 'uri'], async (c, a) => {
    const m = new RegExp(`^media/${a.production}/([A-Za-z0-9._-]{1,100})$`).exec(a.uri || ''); if (!m) throw bad(`uri must look like media/${a.production}/<file>`);
    if (!c.env.MEDIA) throw new HttpError(501, 'media storage is not configured');
    const head = await c.env.MEDIA.head(`${a.production}/${m[1]}`); if (!head) throw new HttpError(404, 'no such file');
    const mime = (head.httpMetadata && head.httpMetadata.contentType) || 'application/octet-stream';
    if (!mime.startsWith('image/')) throw bad(`this is ${mime}; fetch ${mediaUrl(c, a.production, a.uri)} with your bearer token`);
    if (head.size > MAX_INLINE) throw new HttpError(413, `picture is ${head.size} bytes (4 MB max inline); fetch ${mediaUrl(c, a.production, a.uri)} instead`);
    const bytes = new Uint8Array(await (await c.env.MEDIA.get(`${a.production}/${m[1]}`)).arrayBuffer()); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { __content: [{ type: 'image', data: btoa(bin), mimeType: mime }, { type: 'text', text: JSON.stringify({ uri: a.uri, mime, bytes: head.size }) }] };
  }),
  T('submit_take', 'Bring a finished clip back to the studio. Give the video as url (https), data_base64 or uri (media/ already uploaded), up to 25 MB. It is saved as a take for the human to review; nothing is used until they pick it.',
    { ...prod, scene: str, clip: { ...num, description: 'clip number, from 1' }, url: str, data_base64: str, uri: str, mime: str, seed: { ...num, description: 'the seed you used' }, hold: { ...num, description: 'seconds it stands still at the end, from the measure script' }, cuts: { ...num, description: 'number of hard cuts, from the measure script' }, smooth: { type: 'object', description: 'the smooth object from the measure script' }, review: { type: 'object', description: 'the answer of review_take for this clip' }, note: { ...str, description: 'what you did, or anything the human should know' } }, ['production', 'scene', 'clip'], async (c, a) => {
      const sc = (await S.listArtifacts(c.db, a.production, { kind: 'scene' })).find((x) => keyOf(x.ref) === a.scene); if (!sc) throw new HttpError(404, `no scene ${a.scene}`);
      const uri = await storeVideo(c, a.production, a), r = await addTake(c.db, c.actor, a.production, { scene: a.scene, clip: Math.round(Number(a.clip) || 1), uri, seed: Number.isInteger(a.seed) ? a.seed : null, hold: typeof a.hold === 'number' ? a.hold : null, cuts: Number.isInteger(a.cuts) ? a.cuts : null, smooth: a.smooth && typeof a.smooth === 'object' ? a.smooth : null, review: a.review && typeof a.review === 'object' ? a.review : null, note: a.note || '' }, STUDIO);
      return { ...r, uri, status: 'proposed', next: 'The human reviews it on the Pack page. Call get_feedback to see their answer.' };
    }),
];
