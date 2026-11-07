// A second look at every picture the studio draws: does it show what was asked for? A cartoon penguin once came out as a photographed man holding a toy,
// and every later picture and clip followed it. The check asks Muse Spark to look at the picture and say what is in it. If the check cannot run, the picture is let through.
import { spark, outputText, dataUrl } from './meta.js';
import { parseJson } from './util.js';

const SYSTEM = 'You check ONE picture made for a film against a short list of what it must show. Output JSON {ok, major, seen, problem}. ok is true only if the picture matches every point, especially the kind of being and the medium (a photograph is not an illustration). seen is one short sentence about what is really in the picture. major is true only when the kind of being or the medium is wrong, or a character is missing or someone extra is there; it is false for a small detail such as a colour, a pattern or an accessory. problem is one short sentence saying what is wrong, or an empty string when ok.';

export async function checkPicture(env, uri, expect, f) {
  try {
    if (!env.MEDIA || !uri) return { ok: true, skipped: true };
    const o = await env.MEDIA.get(String(uri).replace(/^media\//, '')); if (!o) return { ok: true, skipped: true };
    const image = dataUrl(await o.arrayBuffer(), (o.httpMetadata && o.httpMetadata.contentType) || 'image/png');
    const r = await spark(env, { instructions: `${SYSTEM}\nReply with one JSON object and nothing else.`, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `It must show:\n${expect}` }, { type: 'input_image', image_url: image }] }] }, f);
    const m = /\{[\s\S]*\}/.exec(outputText(r)), j = m && parseJson(m[0], null);
    if (!j || typeof j.ok !== 'boolean') return { ok: true, skipped: true };
    return { ok: j.ok, major: j.ok ? false : j.major !== false, seen: String(j.seen || '').slice(0, 200), problem: j.ok ? '' : String(j.problem || '').slice(0, 200) };
  } catch (e) { return { ok: true, skipped: true }; }
}
