// A stand-in for the Meta Model API for local work: node scripts/standin-meta.mjs [port]. Point the studio at it with META_BASE=http://localhost:9099/v1 and any MODEL_API_KEY.
// It answers in the documented formats, so screens can be driven end to end without spending credits. The pictures are coloured cards, the story reading is sample content.
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

const port = Number(process.argv[2] || 9099);
const crc = (() => { const t = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }); return (b) => { let c = ~0; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; }; })();
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
// A small vertical-gradient card in a hue chosen from the prompt, so different pictures look different.
function png(hue, w = 96, h = 128) {
  const hsl = (l) => { const a = 0.4 * Math.min(l, 1 - l), f = (n) => { const k = (n + hue / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return [f(0), f(8), f(4)]; };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { const c = hsl(0.62 - 0.4 * (y / h)); raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3, edge = x < 3 || x > w - 4 ? 0.85 : 1; raw[o] = c[0] * edge; raw[o + 1] = c[1] * edge; raw[o + 2] = c[2] * edge; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hueOf = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

const READ = { title: 'Ask First', summary: 'On a deep-space station the AI that runs everything must ask a human before it acts. When a coolant line cracks, the human refuses its three options and asks for a fourth.', tone: ['tense', 'quiet', 'hopeful'], period: 'Kestrel Station, 2089', language: 'English',
  people: [{ name: 'Ines Okafor', role: 'night engineer', desc: 'A woman in her late thirties, short dark hair, tired and sharp eyes, grey station coverall with a worn tool belt', voice: 'low, dry, unhurried' },
    { name: 'ORCA', role: 'the station AI', desc: 'No human face: a ring of soft white light set into the wall, with one small dark lens at its centre, calm and patient', voice: 'calm, warm, precise' },
    { name: 'Commander Vale', role: 'station commander', desc: 'A man in his fifties, grey close-cut hair, dark blue commander jacket, tired authority', voice: 'measured, formal' }],
  places: [{ name: 'Coolant corridor', desc: 'A narrow metal corridor with pipes along the walls, frost on line seven, amber warning lights', time: 'night' }, { name: 'Ines\'s cabin', desc: 'A tiny sleeping cabin with a bunk, one porthole showing stars, a wall panel with a soft light ring', time: 'night' }, { name: 'Control ring', desc: 'A circular control room with curved screens, a long window onto an ice moon, calm blue light', time: 'day' }],
  beats: [{ text: 'Coolant line seven cracks. ORCA finds a fix and waits for a human.' }, { text: 'ORCA wakes Ines and lays out three options.' }, { text: 'Ines refuses all three and asks for a fourth.' }, { text: 'The fourth fix holds. Commander Vale asks who saved the station.' }, { text: 'A title card: Ask first.' }],
  questions: [{ q: 'Should ORCA ever have a face?', options: ['A light ring only', 'A human face', 'A voice only'] }, { q: 'How tense should it feel?', options: ['Quiet and tense', 'Loud and urgent'] }], invented: ['The fourth option Ines asks for'], forbidden: ['lens flare', 'robot with a human body', 'visible logos'],
  looks: [{ name: 'Clean hard sci-fi', sub: 'cold light, steel and frost', desc: 'Clean hard sci-fi, cold blue light, steel and frost, 35 mm, subtle grain' }, { name: 'Warm analogue future', sub: 'amber light, worn metal', desc: 'Warm analogue future, amber warning light, worn metal, soft film grain' }, { name: 'Minimal white', sub: 'bright and quiet', desc: 'Minimal bright white interiors, quiet, soft shadows' }] };
const SCENES = { scenes: [
  { name: 'The crack', tag: 'hook', seconds: 12, place: 'Coolant corridor', time: 'night', who: ['ORCA'], transcript: [{ who: 'ORCA', text: 'Coolant line seven has failed. I have a fix. I will not act without you.', en: 'Coolant line seven has failed. I have a fix. I will not act without you.', sec: 5 }],
    notes: { happens: 'Night in the coolant corridor. Frost spreads across line seven and a thin jet of vapour hisses from a crack. Amber lights pulse. On the wall a ring of white light with one small lens turns toward the crack and holds still.', mood: 'Quiet urgency. Nothing rushes.', cam: 'Starts wide down the corridor, slow push-in to the light ring.', sound: 'Hiss of vapour, a low alarm tone, then silence as ORCA speaks.', never: 'No explosion. ORCA does not move anything yet.', cont: 'First scene.' } },
  { name: 'Three options', tag: 'ask', seconds: 14, place: 'Ines\'s cabin', time: 'night', who: ['Ines Okafor', 'ORCA'], transcript: [{ who: 'ORCA', text: 'Ines, I need you. I have three options.', en: 'Ines, I need you. I have three options.', sec: 3 }, { who: 'INES', text: 'None of these. Give me a fourth.', en: 'None of these. Give me a fourth.', sec: 3 }],
    notes: { happens: 'Ines wakes in her cabin. The light ring on the wall glows softly. Three simple diagrams appear on a panel. She studies them, shakes her head and says she wants a fourth.', mood: 'Intimate, tense, a little dry humour.', cam: 'Close on Ines, then a slow turn to the light ring.', sound: 'Soft hum of the station, a bunk creaking.', never: 'ORCA does not act on its own.', cont: 'Ines wears the same grey coverall.' } },
  { name: 'The fourth', tag: 'fix', seconds: 12, place: 'Coolant corridor', time: 'night', who: ['Ines Okafor', 'ORCA'], transcript: [],
    notes: { happens: 'Ines works on line seven with a hand tool while ORCA lights the pipe from the wall. The jet of vapour thins and stops. Frost slowly stops spreading.', mood: 'Focused, then relief.', cam: 'Handheld close on Ines\'s hands, then wide as the line holds.', sound: 'Tool clicks, vapour fading to silence.', never: 'No heroic music.', cont: 'Back in the coolant corridor of scene 1.' } },
  { name: 'Who saved the station', tag: 'answer', seconds: 12, place: 'Control ring', time: 'day', who: ['Commander Vale', 'ORCA'], transcript: [{ who: 'VALE', text: 'Who saved the station?', en: 'Who saved the station?', sec: 2 }, { who: 'ORCA', text: 'She did. I only proposed.', en: 'She did. I only proposed.', sec: 3 }],
    notes: { happens: 'Morning in the control ring. Commander Vale looks out at the ice moon, then at the light ring. Ines stands at the back with a coffee.', mood: 'Calm, warm.', cam: 'Slow two-shot of Vale and the light ring.', sound: 'Quiet room tone.', never: 'No applause.', cont: 'Ines is rested, same coverall.' } },
  { name: 'Ask first', tag: 'title', seconds: 10, place: '', time: 'none', who: [], transcript: [], notes: { happens: 'A black card with white text: Ask first.', mood: 'Austere.', cam: 'Locked off.', sound: 'One low tone.', never: 'No picture other than the text.', cont: 'The film ends here.' } }] };

const text = (o) => ({ id: 'r_' + Math.random().toString(36).slice(2, 8), output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(o) }] }] });
createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c); const raw = Buffer.concat(chunks).toString('latin1');
  const send = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const url = req.url.split('?')[0];
  if (req.headers.authorization === undefined) return send({ error: { message: 'no key' } }, 401);
  let b = {}; try { b = JSON.parse(raw); } catch { /* multipart for transcription */ }
  if (url.endsWith('/responses')) {
    const ins = String(b.instructions || ''), input = typeof b.input === 'string' ? b.input : JSON.stringify(b.input);
    if (/revise ONE item/.test(ins)) { const m = /Current: (\{[\s\S]*?\})\nFeedback/.exec(input), cur = m ? JSON.parse(m[1]) : {}, data = {}; for (const [k, v] of Object.entries(cur)) { if (typeof v === 'string' && v) data[k] = v + ' (made more specific)'; else if (k === 'beats' && Array.isArray(v)) data[k] = v.map((b) => ({ text: b.text + ' (more specific)' })); } return send(text({ data, note: 'Made it more specific.' })); }
    if (/read a story/.test(ins)) return send(text(READ));
    if (/turn a story into scenes/i.test(ins)) { const one = /exactly this one scene/.test(ins); const m = /"name":"([^"]+)"/.exec(input); return send(text(one ? { scenes: [{ ...(SCENES.scenes.find((s) => s.name === (m && m[1])) || SCENES.scenes[0]), notes: { ...(SCENES.scenes[0].notes), happens: 'Rewritten: ' + SCENES.scenes[0].notes.happens } }] } : SCENES)); }
    return send(text({ ok: true }));
  }
  if (url.endsWith('/images/generations') || url.endsWith('/images/edits')) { await new Promise((r) => setTimeout(r, 400)); return send({ output_format: 'png', data: [{ b64_json: png(hueOf((b.prompt || '') + Math.random())).toString('base64') }] }); }
  if (url.endsWith('/asr/transcribe')) return send({ transcript: 'Open on the beam, not on her face.', audioDurationMs: 3000 });
  send({ error: { message: 'stand-in: unknown ' + url } }, 404);
}).listen(port, () => console.log(`stand-in Meta API on http://localhost:${port}/v1`));
