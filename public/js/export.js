// Things you can hand to someone outside the studio: edit lists for an editor, a voice-over script, a review document.
import { get, lines, pickedTake, threads } from './data.js';
import { lineSeconds } from './checks.js';

const FPS = 24;
const tc = (sec) => { const f = Math.round(sec * FPS); return [Math.floor(f / (FPS * 3600)), Math.floor(f / (FPS * 60)) % 60, Math.floor(f / FPS) % 60, f % FPS].map((n) => String(n).padStart(2, '0')).join(':'); };
const file = (id) => { const t = pickedTake(id); return t && t.assets && t.assets[0] ? t.assets[0].uri.split('/').pop() : `${id}.mp4`; };
const title = (cut) => (cut.data.name || cut.ref).replace(/[^\w .-]/g, '');

export function edl(cut, order) {
  let at = 0;
  return [`TITLE: ${title(cut)}`, 'FCM: NON-DROP FRAME', '', ...order.map((o, i) => {
    const a = at; at += o.seconds;
    return `${String(i + 1).padStart(3, '0')}  ${o.id.padEnd(8).slice(0, 8)} V     C        ${tc(0)} ${tc(o.seconds)} ${tc(a)} ${tc(at)}\n* FROM CLIP NAME: ${file(o.id)}`;
  })].join('\n') + '\n';
}
export function otio(cut, order) {
  const rt = (s) => ({ OTIO_SCHEMA: 'RationalTime.1', rate: FPS, value: Math.round(s * FPS) });
  const clip = (o) => ({ OTIO_SCHEMA: 'Clip.2', name: o.id, source_range: { OTIO_SCHEMA: 'TimeRange.1', start_time: rt(0), duration: rt(o.seconds) }, media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: file(o.id), available_range: null }, metadata: { title: (get(`shot:${o.id}`) || { data: {} }).data.title || '' } });
  return JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', name: title(cut), tracks: { OTIO_SCHEMA: 'Stack.1', children: [{ OTIO_SCHEMA: 'Track.1', kind: 'Video', children: order.map(clip) }] } }, null, 2);
}
// For `ffmpeg -f concat -safe 0 -i cut.txt -c:v libx264 out.mp4` with each clip trimmed to its length in the cut.
export const ffmpegList = (order) => order.map((o) => `file '${file(o.id)}'\ninpoint 0\noutpoint ${o.seconds}`).join('\n') + '\n';

export function voScript(cut, order) {
  let at = 0; const rows = [];
  for (const o of order) {
    for (const l of lines(o.id)) if (l.data.role !== 'CARD') rows.push(`${tc(at)}  ${String(l.data.speaker || l.data.role).toUpperCase().padEnd(14)}${l.data.de || ''}${l.data.en ? `   (${l.data.en})` : ''}${(get(`shot:${o.id}`) || { data: {} }).data.is_new ? '   [NEW]' : ''}`);
    at += o.seconds;
  }
  return `VOICE-OVER SCRIPT · ${title(cut)}\n${'-'.repeat(60)}\n${rows.join('\n') || 'No spoken lines.'}\n`;
}

export function reviewDoc(cut, order, checks) {
  const sum = order.reduce((a, o) => a + o.seconds, 0), th = (ref) => threads(ref).filter((c) => c.status !== 'resolved');
  const fmt = (c) => `  - **${c.author}**${c.verdict ? ` [${c.verdict}]` : ''}: ${c.body || '(drawing)'}${c.replies.map((r) => `\n    - ${r.author}: ${r.body}`).join('')}`;
  return `# ${cut.data.name || cut.ref}\n\n${cut.data.logline || ''}\n\nRuntime ${Math.round(sum * 10) / 10}s${cut.data.target_seconds ? ` of ${cut.data.target_seconds}s` : ''} · ${order.length} shots · version ${cut.version} by ${cut.author}\n\n## Checks\n${checks.map((c) => `- ${{ ok: 'OK  ', warn: 'WARN', bad: 'FIX ' }[c.lvl]} ${c.txt}`).join('\n')}\n\n## Feedback on the storyline\n${th(cut.ref).map(fmt).join('\n') || '- none open'}\n\n## Beats\n${order.map((o, i) => {
    const s = get(`shot:${o.id}`), D = s ? s.data : {}, f = th(`shot:${o.id}`);
    return `### ${i + 1}. ${o.id} · ${D.title || ''} (${o.seconds}s)\n${D.note || ''}\n${lines(o.id).map((l) => `- ${l.data.speaker || l.data.role}: ${l.data.de || ''}${l.data.en ? ` / ${l.data.en}` : ''}`).join('\n')}${f.length ? `\n\nOpen feedback:\n${f.map(fmt).join('\n')}` : ''}`;
  }).join('\n\n')}\n`;
}

export const HANDOFF = [
  ['DaVinci Resolve', 'Import the EDL or OTIO, relink the clips by file name, then grade and mix with the settings saved under Grade and mix.'],
  ['ffmpeg', 'Concatenate with the list: ffmpeg -f concat -safe 0 -i cut.txt -c:v libx264 -pix_fmt yuv420p cut.mp4, then mix the voice-over and music bed.'],
  ['HyperFrames', 'Build titles and burned-in captions over the finished cut from the voice-over script; keep the look from Grade and mix.'],
  ['Claude', 'Give it the review document and the EDL: it can write an edit note per shot or revise the storyline from your feedback.'],
];
export { lineSeconds };
