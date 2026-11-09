// A second look at every picture the studio draws: does it show what was asked for? A cartoon penguin once came out as a photographed man holding a toy,
// and every later picture and clip followed it. The check asks Muse Spark to look at the picture and say what is in it. If the check cannot run, the picture is let through.
import { spark, outputText, dataUrl, sam } from './meta.js';
import { parseJson } from './util.js';

const SYSTEM = 'If reference pictures of characters follow the first picture, compare each character in the FIRST picture with its reference picture: every garment, every colour, the ear and body shape and the markings must be the same, and any difference is kind "appearance" and goes in problem as "NAME wears X; must wear Y". You check ONE picture made for a film against a short list of what it must show. FIRST, for every character the list names, write what you actually see it wearing and its main colours, and compare that with the description word by word (blue overalls are not a pink sweater, a yellow scarf is not a blue scarf). THEN output JSON {characters, ok, kind, seen, problem}. characters is a list of {name, kind_seen (what kind of being or animal it really is, one or two words), sees (clothes and main colours you see), matches (true or false)}. ok is true only if the picture matches every point and every character matches its description. kind says what is wrong when ok is false: "being" (the wrong kind of being, for example a person instead of an animal), "medium" (a photograph instead of an illustration or the reverse), "character" (a character is missing or someone extra is there), "stage" (a thing is present, absent or at the wrong growth stage for the moment described, for example a plant where there should only be soil), "size" (a character is clearly bigger or smaller than in the previous picture, or out of proportion to the others, without having walked toward or away from the camera), "scene" (the place, the background or the camera framing is not the same as in the previous picture), "appearance" (a character wears different clothes or has different colours or a different shape from its description), or "detail" (anything smaller: a pattern, an accessory, how many of something, or how big a thing is). seen is one short sentence about what is really in the picture. problem is one short sentence saying what is wrong and what it must be instead (for example "Mimi wears a pink sweater; she must wear tiny blue overalls"), or an empty string when ok.';

// A picture that fails is looked at a second time before it counts as failed: one wrong look at a splash of water must not stop a whole film.
// Describe the beings in a picture WITHOUT saying what they should be, then compare the kinds in code. A judge that is told "these are a snail and a beetle" agrees; one that is only asked what it sees does not.
const BLIND = 'List every character or creature you see in the picture. Output JSON {beings: [{kind (what kind of being or animal it really is, one or two words), colour}]}. Do not guess what it is meant to be: say what it looks like.';
async function blindKinds(env, uri, kinds, f) {
  try {
    const image = await read(env, uri); if (!image) return { why: '', seen: [] };
    const r = await spark(env, { instructions: `${BLIND}\nReply with one JSON object and nothing else.`, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'The picture:' }, { type: 'input_image', image_url: image }] }] }, f), m = /\{[\s\S]*\}/.exec(outputText(r)), j = m && parseJson(m[0], null);
    const seen = (j && Array.isArray(j.beings) ? j.beings : []).map((b) => String((b && b.kind) || '').toLowerCase()).filter(Boolean); if (!seen.length) return { why: '', seen: [], error: `no beings in the answer: ${outputText(r).slice(0, 200)}` };
    const missing = kinds.filter((k) => !seen.some((x) => sameKind(k.kind, x))); return { why: missing.length ? `The picture shows ${seen.join(' and ')}; it must show ${missing.map((k) => `a ${k.kind}`).join(' and ')} (${missing.map((k) => k.name).join(', ')})` : '', seen };
  } catch (e) { return { why: '', seen: [], error: String(e && e.message).slice(0, 160) }; }
}
// How big each character is, measured and not judged: SAM finds the character by what it looks like and returns its box. A character that is half the size it was in the
// previous picture, with a camera that did not move, is a fault; a vision judge does not see it (nor does it see the opposite). `sizes` = { baseUri, looks: [{ name, look }], push }.
const sizeOf = (boxes) => { const b = (boxes || []).slice().sort((x, y) => (y.conf || 0) - (x.conf || 0))[0]; if (!b) return 0; const [x1, y1, x2, y2] = b.box; return Math.sqrt(Math.max(0, x2 - x1) * Math.max(0, y2 - y1)); };
// Every picture is held to the previous one (`baseUri`) and to the first picture of its scene (`originUri`), so small steps cannot add up to a big drift; the size of one character
// relative to another is held too (a snail that shrinks next to a beetle is a fault even when the camera "moved").
export async function sizeProblem(env, uri, sizes, f, out = {}) {
  try {
    const now = await read(env, uri); if (!now) return '';
    const refs = [{ uri: sizes.baseUri, what: 'the previous picture' }, ...(sizes.originUri && sizes.originUri !== sizes.baseUri ? [{ uri: sizes.originUri, what: "the scene's first picture" }] : []), ...(sizes.filmUri && sizes.filmUri !== sizes.baseUri && sizes.filmUri !== sizes.originUri && (sizes.looks || []).length > 1 ? [{ uri: sizes.filmUri, what: "the film's first picture", ratioOnly: true }] : [])]; // the film's first picture: only the size of one character next to another is held (a scene may change the framing, the snail never changes next to the beetle)
    const lo = sizes.push ? 0.85 : 0.78, hi = sizes.push ? 1.6 : 1.3, looks = sizes.looks.slice(0, 3), bad = [];
    for (const r of refs) {
      const before = await read(env, r.uri); if (!before) continue; const sa = [], sb = [];
      for (const c of looks) {
        const concept = c.concept || c.look, [a, b] = await Promise.all([sam(env, { image: before, concept }, f), sam(env, { image: now, concept }, f)]); sa.push(sizeOf(a)); sb.push(sizeOf(b));
        (out.report = out.report || []).push({ look: concept, against: r.what, before: Math.round(sa[sa.length - 1] * 100) / 100, now: Math.round(sb[sb.length - 1] * 100) / 100 });
      }
      if (!r.ratioOnly) looks.forEach((c, i) => { if (sa[i] > 0.02 && sb[i] > 0.02) { const ratio = sb[i] / sa[i]; if (ratio < lo || ratio > hi) (out.fixes = out.fixes || []).push({ concept: c.concept || c.look, factor: sa[i] / sb[i] }), bad.push(`the ${c.look} is ${Math.round(ratio * 100)}% of the size it was in ${r.what}: redraw it about ${(Math.round((ratio < 1 ? 1 / ratio : ratio) * 10) / 10).toFixed(1)} times ${ratio < 1 ? 'bigger' : 'smaller'}`); } });
      if (!sizes.push && looks.length > 1 && sa[0] > 0.02 && sb[0] > 0.02) for (let i = 1; i < looks.length; i++) if (sa[i] > 0.02 && sb[i] > 0.02) { const q = (sb[0] / sb[i]) / (sa[0] / sa[i]); if (r.ratioOnly ? q < 0.72 || q > 1.38 : q < 0.8 || q > 1.25) (out.fixes = out.fixes || []).push({ concept: looks[0].concept || looks[0].look, factor: 1 / q }), bad.push(`the ${looks[0].look} compared with the ${looks[i].look} is ${Math.round(q * 100)}% of what it was in ${r.what}: scale the ${looks[0].look} by ${(Math.round((1 / q) * 100) / 100).toFixed(2)}`); }
      if (bad.length) break;
    }
    return bad.length ? `${bad.join('; ')}; every character must keep the same size, and the same size next to the others (it may look bigger or smaller only by really walking nearer or further)` : '';
  } catch (e) { return ''; }
}
export async function checkPicture(env, uri, expect, f, refs = [], kinds = [], sizes = null) {
  const sizeOut = {}; if (sizes && sizes.baseUri && (sizes.looks || []).length) { const why = await sizeProblem(env, uri, sizes, f, sizeOut); if (why) return { ok: false, kind: 'size', major: true, seen: '', beings: [], sizeReport: sizeOut.report, sizeFix: (sizeOut.fixes || []).sort((x, y) => Math.abs(Math.log(y.factor)) - Math.abs(Math.log(x.factor)))[0], problem: why.slice(0, 380) }; }
  let beings = [], beingsError = ''; if (kinds.length) { const b = await blindKinds(env, uri, kinds, f); beings = b.seen; beingsError = b.error || ''; if (b.why) return { ok: false, kind: 'being', major: true, seen: '', beings, problem: b.why.slice(0, 220) }; }
  const first = await checkOnce(env, uri, expect, f, refs, kinds);
  if (first.ok || first.skipped) return { ...first, beings, beingsError, sizeReport: sizeOut.report };
  const second = await checkOnce(env, uri, expect, f, refs, kinds);
  return second.ok || second.skipped ? { ...second, ok: true, secondOpinion: true, beings, beingsError, sizeReport: sizeOut.report } : { ...first, beings, beingsError, sizeReport: sizeOut.report };
}
const read = async (env, uri) => { const o = await env.MEDIA.get(String(uri).replace(/^media\//, '')); return o ? dataUrl(await o.arrayBuffer(), (o.httpMetadata && o.httpMetadata.contentType) || 'image/png') : null; };
// A bear is not a snail: the kind of every named character is compared in code, because a judge that is asked only "does it match?" says yes to a bear.
const SAME = { rabbit: ['bunny', 'hare'], bunny: ['rabbit', 'hare'], beetle: ['bug', 'insect', 'ladybug', 'ladybird', 'ant'], bug: ['beetle', 'insect', 'ladybug', 'ant'], ant: ['beetle', 'bug', 'insect'], snail: ['slug'], frog: ['toad'], penguin: ['bird'], hedgehog: ['porcupine'] };
export const sameKind = (want, seen) => { const w = String(want || '').toLowerCase(), t = String(seen || '').toLowerCase(); return !w || !t || t.includes(w) || w.includes(t) || (SAME[w] || []).some((x) => t.includes(x)); };
async function checkOnce(env, uri, expect, f, refs = [], kinds = []) {
  try {
    if (!env.MEDIA || !uri) return { ok: true, skipped: true };
    const image = await read(env, uri); if (!image) return { ok: true, skipped: true };
    const extra = []; for (const r of refs.slice(0, 3)) { const u = await read(env, r.uri); if (u) extra.push({ type: 'input_text', text: `Reference picture of ${r.name}:` }, { type: 'input_image', image_url: u }); }
    const r = await spark(env, { instructions: `${SYSTEM}\nReply with one JSON object and nothing else.`, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `It must show:\n${expect}${kinds.length ? `\nName the kind of being of each of these characters in characters.kind_seen: ${kinds.map((k) => `${k.name} (it must be a ${k.kind})`).join(', ')}.` : ''}\nThe picture to check:` }, { type: 'input_image', image_url: image }, ...extra] }] }, f);
    const m = /\{[\s\S]*\}/.exec(outputText(r)), j = m && parseJson(m[0], null);
    if (!j || typeof j.ok !== 'boolean') return { ok: true, skipped: true };
    const wrong = kinds.map((k) => { const c = (Array.isArray(j.characters) ? j.characters : []).find((x) => x && String(x.name || '').toLowerCase() === k.name.toLowerCase()); return c && c.kind_seen && !sameKind(k.kind, c.kind_seen) ? `${k.name} looks like a ${String(c.kind_seen).slice(0, 40)}; it must be a ${k.kind}` : ''; }).filter(Boolean);
    if (wrong.length) return { ok: false, kind: 'being', major: true, seen: String(j.seen || '').slice(0, 200), problem: wrong.join('; ').slice(0, 200) };
    return { ok: j.ok, kind: j.ok ? '' : String(j.kind || ''), major: j.ok ? false : j.kind ? ['being', 'medium', 'character', 'stage', 'size', 'scene'].includes(String(j.kind)) : j.major !== false, seen: String(j.seen || '').slice(0, 200), problem: j.ok ? '' : String(j.problem || '').slice(0, 200) };
  } catch (e) { return { ok: true, skipped: true }; }
}
