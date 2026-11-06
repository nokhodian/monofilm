// The export pack: what an outside video generator needs, as a folder or a .zip. Pure functions, so the page and the tests use the same code.
// Meta has no video generator, so nothing here generates video. It writes the prompt, the anchor pictures, the stage controls and a manifest for whichever generator the person uses.
import { composeClip, clipPlan, clipLineCheck, linesOfClip, startOf, hasEnd, NOTE_KEYS, slug, keyOf, MAX_CLIP } from './wizard-model.js';

const pad = (n) => String(n).padStart(2, '0');
const ext = (uri, mime) => (/\.(png|jpe?g|webp|gif|mp4|webm|wav|mp3|json)$/i.exec(uri || '') || [, ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' })[mime] || 'png'])[1].toLowerCase();
export const sceneDir = (s) => `scene-${pad(s.data.n)}-${slug(s.data.name)}`;

// ---- subtitles ----
const stamp = (t) => { const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms % 1000).padStart(3, '0')}`; };
export function srt(lines) {
  let t = 0, i = 0, out = [];
  for (const l of lines || []) { if (!(l.text || '').trim()) continue; const d = Math.max(1, Number(l.sec) || 2); if (typeof l.at === 'number') t = l.at; out.push(`${++i}\n${stamp(t)} --> ${stamp(t + d)}\n${l.who ? l.who + ': ' : ''}${l.text}${l.en ? `\n(${l.en})` : ''}\n`); t += d; }
  return out.join('\n');
}

// What a target can take. The pack is trimmed to this so a generator is never handed files it will reject.
export const WANTS = { both: { start: true, end: true, refs: false, stage: true }, start: { start: true, end: false, refs: false, stage: true }, refs: { start: false, end: false, refs: true, stage: true }, text: { start: false, end: false, refs: false, stage: false } };

// One scene as a list of entries: { path, text } for files written here, { path, uri } for files that must be fetched from the studio.
// scene = { ref, data, frames: { '<clip>-start'|'<clip>-end': uri }, stage: [{ role, uri, shot }], anchors: [{ id, name, uri }], take... }
export function sceneEntries(film, scene, { target = 'both', max = MAX_CLIP, root = '' } = {}) {
  const w = WANTS[target] || WANTS.both, d = scene.data, dir = (root ? root + '/' : '') + sceneDir(scene), clips = (d.clips && d.clips.length ? d.clips : clipPlan(d.seconds, max)), out = [];
  const bad = clipLineCheck(d); if (bad.length) throw new Error(`Scene ${d.n}: the lines do not fit the clips (${bad.join('; ')}). Fix the script before packing.`);
  const E = (path, text) => out.push({ path: `${dir}/${path}`, text });
  const U = (path, uri) => out.push({ path: `${dir}/${path}`, uri });
  E('brief.md', [`# ${d.name}`, '', `${d.seconds} s · ${d.place ? 'place: ' + keyOf(d.place) : 'no set place'} · ${d.time || 'no time of day'}`, '', ...NOTE_KEYS.map(([k, label]) => `## ${label}\n${(d.notes || {})[k] || '-'}\n`)].join('\n'));
  E('transcript.json', JSON.stringify(d.transcript || [], null, 2));
  if ((d.transcript || []).some((l) => l.text)) E('transcript.srt', srt(d.transcript));
  const first = scene.frames['1-start'], lastEnd = scene.frames[`${clips.length}-end`]; // the scene's own start and end pictures, next to the brief, as far as the target can take them
  if (w.start && first && d.start && d.start.mode !== 'skip') U(`start.${ext(first)}`, first);
  if (w.end && lastEnd && d.end && d.end.mode !== 'skip') U(`end.${ext(lastEnd)}`, lastEnd);
  const refs = [];
  clips.forEach((c, i) => {
    const n = i + 1, last = n === clips.length, c1 = `clip-${pad(n)}`, p = composeClip(scene, film, n), files = [];
    E(`${c1}/prompt.txt`, p.prompt); E(`${c1}/negative.txt`, p.negative); files.push('prompt.txt', 'negative.txt');
    const cl = linesOfClip(d, n); if (cl.length) { E(`${c1}/transcript.json`, JSON.stringify(cl.map(({ who, text, en, at, sec }) => ({ who, text, en, at, sec })), null, 2)); E(`${c1}/transcript.srt`, srt(cl.map((l) => ({ ...l, sec: l.sec })))); files.push('transcript.json', 'transcript.srt'); } // the lines spoken in this clip, timed from its own start
    let startFrom = null; const sf = scene.frames, from = startOf(d, n), putStart = (uri, what) => { U(`${c1}/start.${ext(uri)}`, uri); files.push('start'); startFrom = what; };
    if (w.start) {
      if (from === 'start' && sf[`${n}-start`]) putStart(sf[`${n}-start`], 'start picture');
      else if (from === 'own' && sf[`${n}-start`]) putStart(sf[`${n}-start`], 'own start picture');
      else if (from === 'prev-end' && sf[`${n - 1}-end`]) putStart(sf[`${n - 1}-end`], `end picture of clip ${pad(n - 1)} (the same picture)`);
      else if (n > 1) startFrom = `last frame of clip ${pad(n - 1)}, taken from the clip you bring back`;
    }
    if (w.end && hasEnd(d) && sf[`${n}-end`]) { U(`${c1}/end.${ext(sf[`${n}-end`])}`, sf[`${n}-end`]); files.push('end'); }
    if (w.stage) for (const s of (scene.stage || []).filter((x) => !x.shot || x.shot.endsWith(`-c${n}`) || n === 1)) { U(`${c1}/stage/${s.role}.${ext(s.uri)}`, s.uri); files.push(`stage/${s.role}`); }
    if (w.refs) for (const a of scene.anchors || []) { U(`${c1}/refs/${slug(a.id)}.${ext(a.uri)}`, a.uri); refs.push(a.id); files.push(`refs/${slug(a.id)}`); }
    E(`${c1}/clip.json`, JSON.stringify({ film: film.name, scene: d.n, scene_name: d.name, clip: n, of: clips.length, seconds: p.seconds, aspect: (film.look && film.look.aspect) || '9:16', fps: (film.look && film.look.fps) || 24, target, begins: n === 1 ? 'start' : c.join === 'cut' ? 'cut' : 'continues', start_from: startFrom, ends_with: w.end && hasEnd(d) && sf[`${n}-end`] ? 'end picture' : null, timing: p.timing, beat: p.beat, audio_policy: p.audio, transition_in: n === 1 ? (d.start && d.start.mode === 'chain' ? 'continues from the previous scene' : 'cut') : null, files, depends_on: [scene.ref, 'canon.style:look', ...(d.who || [])] }, null, 2));
  });
  return out;
}

// The whole film: shared canon once, then every scene. Anchors and plates are fetched by uri.
export function filmEntries(film, scenes, { target = 'both', max = MAX_CLIP } = {}) {
  const root = slug(film.name) || 'film', out = [], w = WANTS[target] || WANTS.both, look = film.look || {};
  out.push({ path: `${root}/film/look.txt`, text: [look.look, look.period, look.sound].filter(Boolean).join('\n') || 'No look set.' });
  out.push({ path: `${root}/film/never-on-screen.txt`, text: [].concat(look.forbidden || []).join('\n') });
  out.push({ path: `${root}/film/format.json`, text: JSON.stringify({ aspect: look.aspect || '9:16', fps: look.fps || 24, speech: film.speech || '', captions: film.captions || [] }, null, 2) });
  if (w.refs || target === 'both') { for (const a of film.anchors || []) out.push({ path: `${root}/film/anchors/${slug(a.id)}.${ext(a.uri)}`, uri: a.uri }); for (const p of film.plates || []) out.push({ path: `${root}/film/plates/${slug(p.id)}.${ext(p.uri)}`, uri: p.uri }); }
  for (const s of scenes) out.push(...sceneEntries(film, s, { target, max, root }));
  out.push({ path: `${root}/manifest.json`, text: JSON.stringify({ schema: 'monofilm/pack@1', film: film.name, target, made: new Date().toISOString(), scenes: scenes.map((s) => ({ n: s.data.n, name: s.data.name, dir: sceneDir(s), seconds: s.data.seconds, clips: (s.data.clips && s.data.clips.length ? s.data.clips : clipPlan(s.data.seconds, max)).length })), note: 'Meta has no video generator. Give each clip folder to the generator you use, then bring the result back into the studio.' }, null, 2) });
  return out;
}

// ---- a store-only .zip (no compression), enough for text and already-compressed pictures ----
const T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
// files: [{ path, bytes: Uint8Array }]
export function zip(files, when = new Date()) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const dt = ((when.getFullYear() - 1980) << 9 | (when.getMonth() + 1) << 5 | when.getDate()) & 0xffff, tm = (when.getHours() << 11 | when.getMinutes() << 5 | (when.getSeconds() >> 1)) & 0xffff;
  for (const f of files) {
    const name = enc.encode(f.path.replace(/^\/+/, '')), crc = crc32(f.bytes), size = f.bytes.length;
    const head = Uint8Array.from([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, ...u16(tm), ...u16(dt), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), 0, 0]); // flag bit 11: UTF-8 names
    parts.push(head, name, f.bytes);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, ...u16(tm), ...u16(dt), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(off)]), name);
    off += head.length + name.length + size;
  }
  const cd = central.reduce((a, b) => a + b.length, 0), end = Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cd), ...u32(off), 0, 0]);
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}
// Turn entries into a zip, fetching the pictures. `fetchBytes(uri)` returns a Uint8Array or null; a file that cannot be read is listed in MISSING.txt, never silently dropped.
export async function buildZip(entries, fetchBytes) {
  const enc = new TextEncoder(), files = [], missing = [];
  for (const e of entries) { if (e.text !== undefined) files.push({ path: e.path, bytes: enc.encode(e.text) }); else { let b = null; try { b = await fetchBytes(e.uri); } catch { /* listed below */ } if (b) files.push({ path: e.path, bytes: b }); else missing.push(e.path); } }
  if (missing.length) files.push({ path: entries[0].path.split('/')[0] + '/MISSING.txt', bytes: enc.encode('These files could not be read from the studio and are not in this pack:\n' + missing.join('\n')) });
  return { bytes: zip(files), missing };
}

// ---- does a returned clip still start and end like the anchor pictures? A tiny perceptual hash: 8x8 greyscale, each cell above or below the mean. ----
export function hashOf(rgba, w, h) { // rgba: Uint8ClampedArray from a canvas
  const N = 8, cells = new Array(N * N).fill(0), cnt = new Array(N * N).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, c = Math.min(N - 1, Math.floor(y * N / h)) * N + Math.min(N - 1, Math.floor(x * N / w)); cells[c] += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]; cnt[c]++; }
  const g = cells.map((v, i) => v / Math.max(1, cnt[i])), mean = g.reduce((a, b) => a + b, 0) / g.length;
  return g.map((v) => (v >= mean ? 1 : 0));
}
export const similarity = (a, b) => Math.round(100 * (1 - a.reduce((d, v, i) => d + (v !== b[i] ? 1 : 0), 0) / a.length));

// How long a returned clip stands still at the very end. samples: small greyscale pictures [{ t, g: number[] }] taken going back from the last frame (samples[0]). A generator that
// reaches the end picture early holds it; the hold is how far back the picture still matches the last one. Under 0.4 s is not worth mentioning.
export function tailHold(samples, duration, tol = 2.5) {
  if (!samples || samples.length < 2) return 0;
  const last = samples[0].g; let hold = 0;
  for (const s of samples.slice(1)) { const diff = s.g.reduce((a, v, i) => a + Math.abs(v - last[i]), 0) / last.length; if (diff > tol) break; hold = Math.max(hold, duration - s.t); }
  return hold >= 0.4 ? Math.round(hold * 10) / 10 : 0;
}

// Does a returned clip jump? steps: the mean absolute difference between pictures taken every `interval` seconds (small greyscale pictures). A cut or a morph shows as one step far above the
// clip's own usual step. Returns { median, max, at (seconds), flag } or null when there is too little to judge.
export function smoothness(steps, interval = 0.2) {
  if (!steps || steps.length < 4) return null;
  const sorted = [...steps].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)], max = Math.max(...steps), at = steps.indexOf(max), r1 = (x) => Math.round(x * 10) / 10;
  return { median: r1(median), max: r1(max), at: r1((at + 1) * interval), flag: max > Math.max(12, 4 * Math.max(median, 1)) };
}
