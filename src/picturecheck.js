// A second look at every picture the studio draws: does it show what was asked for? A cartoon penguin once came out as a photographed man holding a toy,
// and every later picture and clip followed it. The check asks Muse Spark to look at the picture and say what is in it. If the check cannot run, the picture is let through.
import { spark, outputText, dataUrl } from './meta.js';
import { parseJson } from './util.js';

const SYSTEM = 'You check ONE picture made for a film against a short list of what it must show. Output JSON {ok, kind, seen, problem}. ok is true only if the picture matches every point. kind says what is wrong when ok is false: "being" (the wrong kind of being, for example a person instead of an animal), "medium" (a photograph instead of an illustration or the reverse), "character" (a character is missing or someone extra is there), "stage" (a thing is present, absent or at the wrong growth stage for the moment described, for example a plant where there should only be soil), or "detail" (anything smaller: a colour, a pattern, an accessory, how many of something, or how big a thing is). seen is one short sentence about what is really in the picture. problem is one short sentence saying what is wrong, or an empty string when ok.';

export async function checkPicture(env, uri, expect, f) {
  try {
    if (!env.MEDIA || !uri) return { ok: true, skipped: true };
    const o = await env.MEDIA.get(String(uri).replace(/^media\//, '')); if (!o) return { ok: true, skipped: true };
    const image = dataUrl(await o.arrayBuffer(), (o.httpMetadata && o.httpMetadata.contentType) || 'image/png');
    const r = await spark(env, { instructions: `${SYSTEM}\nReply with one JSON object and nothing else.`, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `It must show:\n${expect}` }, { type: 'input_image', image_url: image }] }] }, f);
    const m = /\{[\s\S]*\}/.exec(outputText(r)), j = m && parseJson(m[0], null);
    if (!j || typeof j.ok !== 'boolean') return { ok: true, skipped: true };
    return { ok: j.ok, kind: j.ok ? '' : String(j.kind || ''), major: j.ok ? false : j.kind ? ['being', 'medium', 'character', 'stage'].includes(String(j.kind)) : j.major !== false, seen: String(j.seen || '').slice(0, 200), problem: j.ok ? '' : String(j.problem || '').slice(0, 200) };
  } catch (e) { return { ok: true, skipped: true }; }
}
