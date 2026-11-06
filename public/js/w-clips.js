// A scene is made of clips, and the video model makes one clip at a time. On the pages that work clip by clip (Stage, Pictures, Sound, Pack) this bar says which clip is open,
// how far each clip has got, and lets the person move between clips without losing the page they are on.
import { esc, st } from './core.js';
import { get } from './data.js';
import { R, CLIP_SUBS, clipSpans } from './wizard-model.js';
import { slotsOf } from './w-stage-pure.js';
import { hrefOf } from './w-core.js';

// 0 not started, 1 begun, 2 done: the stage (a camera for this clip), the pictures it needs, and its take.
export function clipState(scene, n) {
  const sc = get(R.scene(scene)); if (!sc) return { stage: 0, pictures: 0, pack: 0 };
  const stage = get(R.stage(scene)), cam = stage && ((stage.data.shots || {})[R.shot(scene, n)] || {}).camera, done = (a) => a && ['approved', 'locked'].includes(a.status) && !a.stale;
  const own = slotsOf(scene, sc.data).filter((s) => s.clip === n && s.mode !== 'skip' && s.mode !== 'chain'), chosen = (r) => ((get(r) || {}).data || {}).chosen, has = (r) => (((get(r) || {}).assets || []).length);
  const takes = Object.values((st.d && st.d.by) || {}).filter((a) => a.kind === 'take' && a.ref.startsWith(`take:${scene}-c${n}-`));
  return { stage: cam ? (done(stage) ? 2 : 1) : 0, pictures: !own.length ? 2 : own.every((s) => chosen(s.ref)) ? 2 : own.some((s) => has(s.ref)) ? 1 : 0, pack: takes.some((t) => (t.data || {}).picked) ? 2 : takes.length ? 1 : 0 };
}

export function clipBar(ctx) {
  if (!ctx.scene || !CLIP_SUBS.includes(ctx.sub)) return '';
  const sc = get(R.scene(ctx.scene)); if (!sc) return '';
  const spans = clipSpans(sc.data); if (spans.length < 2) return '';
  const dots = (n) => { const s = clipState(ctx.scene, n); return `<span class="cdots" aria-hidden="true">${[['stage', 'Stage'], ['pictures', 'Pictures'], ['pack', 'Pack']].map(([k, l]) => `<i class="cdot s${s[k]}" title="${l}: ${['not started', 'begun', 'done'][s[k]]}"></i>`).join('')}</span>`; };
  return `<nav class="cbar" aria-label="The clips of this scene"><span class="lbl" style="margin:0">Clip</span>${spans.map((c) => `<button class="${c.n === ctx.clip ? 'on' : ''}" data-go="${hrefOf('scenes', ctx.scene, ctx.sub, c.n)}" ${c.n === ctx.clip ? 'aria-current="true"' : ''}><b>${c.n}</b><span>${c.from}–${c.to} s</span>${c.n > 1 ? `<small>${c.join === 'cut' ? 'a cut' : 'continues'}</small>` : ''}${dots(c.n)}</button>`).join('')}<span class="sm mute cbar-note">${spans.length} clips · the video model makes one at a time</span></nav>`;
}
