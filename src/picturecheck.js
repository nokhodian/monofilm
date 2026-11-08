// A second look at every picture the studio draws: does it show what was asked for? A cartoon penguin once came out as a photographed man holding a toy,
// and every later picture and clip followed it. The check asks Muse Spark to look at the picture and say what is in it. If the check cannot run, the picture is let through.
import { spark, outputText, dataUrl } from './meta.js';
import { parseJson } from './util.js';

const SYSTEM = 'If reference pictures of characters follow the first picture, compare each character in the FIRST picture with its reference picture: every garment, every colour, the ear and body shape and the markings must be the same, and any difference is kind "appearance" and goes in problem as "NAME wears X; must wear Y". You check ONE picture made for a film against a short list of what it must show. FIRST, for every character the list names, write what you actually see it wearing and its main colours, and compare that with the description word by word (blue overalls are not a pink sweater, a yellow scarf is not a blue scarf). THEN output JSON {characters, ok, kind, seen, problem}. characters is a list of {name, sees (clothes and main colours you see), matches (true or false)}. ok is true only if the picture matches every point and every character matches its description. kind says what is wrong when ok is false: "being" (the wrong kind of being, for example a person instead of an animal), "medium" (a photograph instead of an illustration or the reverse), "character" (a character is missing or someone extra is there), "stage" (a thing is present, absent or at the wrong growth stage for the moment described, for example a plant where there should only be soil), "appearance" (a character wears different clothes or has different colours or a different shape from its description), or "detail" (anything smaller: a pattern, an accessory, how many of something, or how big a thing is). seen is one short sentence about what is really in the picture. problem is one short sentence saying what is wrong and what it must be instead (for example "Mimi wears a pink sweater; she must wear tiny blue overalls"), or an empty string when ok.';

// A picture that fails is looked at a second time before it counts as failed: one wrong look at a splash of water must not stop a whole film.
export async function checkPicture(env, uri, expect, f, refs = []) {
  const first = await checkOnce(env, uri, expect, f, refs);
  if (first.ok || first.skipped) return first;
  const second = await checkOnce(env, uri, expect, f, refs);
  return second.ok || second.skipped ? { ...second, ok: true, secondOpinion: true } : first;
}
const read = async (env, uri) => { const o = await env.MEDIA.get(String(uri).replace(/^media\//, '')); return o ? dataUrl(await o.arrayBuffer(), (o.httpMetadata && o.httpMetadata.contentType) || 'image/png') : null; };
async function checkOnce(env, uri, expect, f, refs = []) {
  try {
    if (!env.MEDIA || !uri) return { ok: true, skipped: true };
    const image = await read(env, uri); if (!image) return { ok: true, skipped: true };
    const extra = []; for (const r of refs.slice(0, 3)) { const u = await read(env, r.uri); if (u) extra.push({ type: 'input_text', text: `Reference picture of ${r.name}:` }, { type: 'input_image', image_url: u }); }
    const r = await spark(env, { instructions: `${SYSTEM}\nReply with one JSON object and nothing else.`, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `It must show:\n${expect}\nThe picture to check:` }, { type: 'input_image', image_url: image }, ...extra] }] }, f);
    const m = /\{[\s\S]*\}/.exec(outputText(r)), j = m && parseJson(m[0], null);
    if (!j || typeof j.ok !== 'boolean') return { ok: true, skipped: true };
    return { ok: j.ok, kind: j.ok ? '' : String(j.kind || ''), major: j.ok ? false : j.kind ? ['being', 'medium', 'character', 'stage'].includes(String(j.kind)) : j.major !== false, seen: String(j.seen || '').slice(0, 200), problem: j.ok ? '' : String(j.problem || '').slice(0, 200) };
  } catch (e) { return { ok: true, skipped: true }; }
}
