// Client for the Meta Model API (https://dev.meta.ai/docs): Muse Image, SAM 3.1, Muse Voice Transcribe and Muse Spark.
// Every function takes the Worker env (for MODEL_API_KEY) and an optional fetch, so tests can stand in for Meta.
import { HttpError, parseJson } from './util.js';

export const META = 'https://api.meta.ai/v1';
export const MODELS = { image: 'muse-image-1.0', sam: 'sam-3.1', asr: 'muse-voice-transcribe-1.0', spark: 'muse-spark-1.3' };
// A model that Meta renames or retires can be switched without a new release: set MODEL_IMAGE, MODEL_SPARK, MODEL_SAM or MODEL_ASR on the Worker.
export const modelOf = (env, k) => (env && env[`MODEL_${k.toUpperCase()}`]) || MODELS[k];
export const metaConfigured = (env) => !!env.MODEL_API_KEY;

async function call(env, path, init, f = fetch) {
  if (!env.MODEL_API_KEY) throw new HttpError(503, 'MODEL_API_KEY is not set on this studio, so the Meta models are off');
  for (let i = 0; ; i++) {
    // META_BASE points tests and local development at a stand-in server
    const res = await f((env.META_BASE || META) + path, { ...init, headers: { authorization: `Bearer ${env.MODEL_API_KEY}`, ...(init.headers || {}) } });
    if ((res.status === 429 || res.status === 503 || res.status === 500) && i < 3) { await new Promise((s) => setTimeout(s, 700 * (i + 1))); continue; } // Meta asks for backoff on these
    const text = await res.text(), body = parseJson(text, { raw: text });
    if (res.status === 404 && i < 3 && /model was not found/i.test(text)) { await new Promise((r) => setTimeout(r, 700 * (i + 1))); continue; } // Meta sometimes answers this for a model that exists (seen once on 7 Nov 2026), and the same call works a moment later
    if (!res.ok) throw new HttpError(res.status === 400 ? 400 : 502, `Meta API ${res.status}: ${(body.error && (body.error.message || body.error.code)) || text.slice(0, 200)}`);
    return body;
  }
}
const json = (b) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
export const dataUrl = (bytes, mime) => { let s = ''; const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return `data:${mime};base64,${btoa(s)}`; };
export const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ---- Muse Image: text to image, or edit with up to 10 reference images ----
export async function museImage(env, { prompt, images = [], size, n = 1 }, f) {
  const base = { model: modelOf(env, 'image'), prompt, n, response_format: 'b64_json', output_format: 'png' };
  const body = images.length ? await call(env, '/images/edits', json({ ...base, images: images.slice(0, 10).map((u) => ({ image_url: u })) }), f) : await call(env, '/images/generations', json({ ...base, ...(size ? { size } : {}) }), f);
  const out = (body.data || []).filter((d) => d.b64_json).map((d) => ({ bytes: fromB64(d.b64_json), mime: `image/${body.output_format || 'png'}` }));
  if (!out.length) throw new HttpError(502, 'Muse Image returned no picture');
  return out;
}

// ---- SAM 3.1: one concept per request, boxes come back as text tokens ----
const BOX = /<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=([\d.]+))?\|>/g;
export function parseBoxes(text) {
  const out = []; for (const m of String(text || '').matchAll(BOX)) out.push({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], w: +m[5], h: +m[6], c: m[7] ? +m[7] : null });
  return out.map((b) => ({ box: [b.x1 / b.w, b.y1 / b.h, b.x2 / b.w, b.y2 / b.h], conf: b.c })); // normalised to the picture
}
export const outputText = (r) => r.output_text || (r.output || []).flatMap((it) => (it.content || []).map((c) => c.text || '')).join('\n');
export async function sam(env, { image, concept }, f) {
  const r = await call(env, '/responses', json({ model: modelOf(env, 'sam'), input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: concept }, { type: 'input_image', image_url: image }] }], metadata: { include_confidence: 'true' } }), f);
  return parseBoxes(outputText(r)); // no match is an empty list, not an error
}

// "snail" also matches the beetle, and with a higher confidence in some pictures, so the most confident box for a character may be another character. A box that another character's
// search found with more confidence (they overlap, intersection over the smaller box above 0.5) belongs to that character: `lists` = one box list per character, the same lists come back without the stolen boxes.
export function ownBoxes(lists) {
  const inter = (a, b) => { const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); return w > 0 && h > 0 ? (w * h) / Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])) : 0; };
  return lists.map((list, i) => (list || []).filter((b) => !lists.some((other, j) => j !== i && (other || []).some((c) => (c.conf || 0) > (b.conf || 0) && inter(b.box, c.box) > 0.5))));
}

// The same request, with the pixel mask of every match: each box is followed by <|mask;x=;y=;c=;data=H,W,PAYLOAD|>, the mask of that box (H rows, W columns, from the box's top left corner).
// "one_bit" is the small encoding that src/rescale.js decodes (the default "lossless" one is a much heavier coder, and a mask only needs to be on or off).
const MASK = /<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=([\d.]+))?\|><\|mask;[^|]*?data=(\d+),(\d+),([^|]*)\|>/g;
export async function samMasks(env, { image, concept }, f) {
  const r = await call(env, '/responses', json({ model: modelOf(env, 'sam'), input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: concept }, { type: 'input_image', image_url: image }] }], metadata: { include_confidence: 'true', mask_encoding: 'one_bit' } }), f);
  return [...outputText(r).matchAll(MASK)].map((m) => ({ box: [+m[1] / +m[5], +m[2] / +m[6], +m[3] / +m[5], +m[4] / +m[6]], px: [+m[1], +m[2], +m[3], +m[4]], conf: m[7] ? +m[7] : null, mask: { h: +m[8], w: +m[9], payload: m[10] } }));
}

// ---- Muse Voice Transcribe: a WAV file in, text out ----
export async function transcribe(env, wav, { language } = {}, f) {
  const form = new FormData();
  form.append('request', new Blob([JSON.stringify({ mode: 'ENDPOINTING', model: modelOf(env, 'asr'), audioEncoding: 'WAV', ...(language ? { languageBias: [language] } : {}) })], { type: 'application/json' }));
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
  const r = await call(env, `/asr/transcribe?sessionId=mf-${Date.now().toString(36)}`, { method: 'POST', body: form }, f);
  return { transcript: String(r.transcript || (r.turns || []).map((t) => t.transcript).join(' ')).trim(), seconds: (r.audioDurationMs || 0) / 1000 };
}

// ---- Muse Spark: one step of a tool-using conversation (Responses API) ----
export async function spark(env, { input, tools, previous, instructions, model = modelOf(env, 'spark') }, f) {
  return call(env, '/responses', json({ model, input, tools, instructions, ...(previous ? { previous_response_id: previous } : {}), parallel_tool_calls: true }), f);
}

// The models this key can use right now (GET /v1/models), for the studio's admin.
export const listMetaModels = (env, f) => call(env, '/models', { method: 'GET' }, f);

// An empty frame of the wanted shape, as a small PNG data URL. The edit endpoint has no size field and takes the size of the FIRST picture, so a picture made from a portrait face comes out portrait.
// Putting an empty frame of the film's shape first fixes the shape. Uncompressed deflate blocks keep this free of any library.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u) => { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function blankFrame(aw, ah, long = 192) {
  const w = aw >= ah ? long : Math.max(8, Math.round((long * aw) / ah)), h = aw >= ah ? Math.max(8, Math.round((long * ah) / aw)) : long, raw = new Uint8Array((w + 1) * h).fill(0xd8);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0; // filter type 0 at the start of each row
  const blocks = []; for (let i = 0; i < raw.length; i += 65535) { const part = raw.subarray(i, Math.min(raw.length, i + 65535)), last = i + 65535 >= raw.length, head = new Uint8Array(5); head[0] = last ? 1 : 0; head[1] = part.length & 255; head[2] = part.length >> 8; head[3] = ~part.length & 255; head[4] = (~part.length >> 8) & 255; blocks.push(head, part); }
  let a = 1, b = 0; for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  const adler = new Uint8Array(4); new DataView(adler.buffer).setUint32(0, ((b << 16) | a) >>> 0);
  const z = [new Uint8Array([0x78, 0x01]), ...blocks, adler], zl = z.reduce((n, x) => n + x.length, 0), idat = new Uint8Array(zl); let o = 0; for (const x of z) { idat.set(x, o); o += x.length; }
  const chunk = (type, data) => { const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer); dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i); out.set(data, 8); dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out; };
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer); hv.setUint32(0, w); hv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 0;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))], png = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); o = 0; for (const x of parts) { png.set(x, o); o += x.length; }
  return { url: dataUrl(png, 'image/png'), width: w, height: h, bytes: png };
}
