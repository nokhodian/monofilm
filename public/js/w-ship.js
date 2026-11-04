// Step 7, Ship. A = what to send (deliverables, what the generator can take); B = the film at a glance (scenes, storyline strip, what I noticed, each with a link to where it is fixed);
// C = download the film pack. The scenes were already reviewed on their own pages, so this step has nothing to approve. The whole-film pack lives only here.
import { st, api, P, toast, mediaSrc, copyText, esc } from './core.js';
import { get, threads } from './data.js';
import { R, TARGETS, REFS, SUBS, sceneReadiness, composeClip, keyOf, slug } from './wizard-model.js';
import { filmEntries, buildZip, sceneDir } from './pack.js';
import { registerStep, spine, sceneArts, lk, hrefOf, nothing } from './w-core.js';
import { settings, setSettings, filmOf, sceneInput, clipsOf, takesOf, fetchBytes, saveBlob, rctx } from './w-pack.js';

const pad = (n) => String(n).padStart(2, '0');
const stamp = (t) => { const ms = Math.round(t * 1000); return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, '0')}`; };
// One .srt for the whole film. Lines are placed one after the other inside each scene; each scene starts where the one before it ended (by its length).
function filmSrt(scenes, pick) {
  let at = 0, i = 0; const out = [];
  for (const sc of scenes) {
    let t = at;
    for (const l of sc.data.transcript || []) { const text = pick(l); const d = Math.max(1, Number(l.sec) || 2); if (text) { out.push(`${++i}\n${stamp(t)} --> ${stamp(t + d)}\n${l.who ? l.who + ': ' : ''}${text}\n`); } t += d; }
    at += Number(sc.data.seconds) || 0;
  }
  return out.join('\n');
}
// Where a thing is fixed.
const pageOf = (a) => {
  const k = a.ref.slice(0, a.ref.indexOf(':')), sid = (a.data || {}).scene;
  if (k === 'scene') return hrefOf('scenes', keyOf(a.ref), 'brief'); if (k === 'stage') return hrefOf('scenes', keyOf(a.ref), 'stage');
  if (k === 'keyframe' && sid) return hrefOf('scenes', sid, 'pictures'); if (k === 'take' && sid) return hrefOf('scenes', sid, 'pack'); if (k === 'shot' && sid) return hrefOf('scenes', sid, 'brief');
  if (k === 'canon.cast' || k === 'canon.voice') return hrefOf('people'); if (k === 'canon.world') return hrefOf('places'); if (k === 'canon.style') return hrefOf('look'); if (k === 'bible') return hrefOf('understand');
  return hrefOf('scenes');
};
const state = () => { const scenes = sceneArts(), rs = scenes.map((s) => sceneReadiness(s, rctx())); return { scenes, rs, notReady: scenes.filter((s, i) => rs[i][0] < 2 || rs[i][2] < 2 || rs[i][3] < 2) }; };

function reviewDoc(film, scenes) {
  const th = (ref) => threads(ref).filter((c) => c.status !== 'resolved' && !c.parent);
  const lines = [`# ${film.name}`, '', `${scenes.length} scenes · ${scenes.reduce((a, s) => a + (+s.data.seconds || 0), 0)} s`, ''];
  for (const s of scenes) {
    const id = keyOf(s.ref), refs = [s.ref, R.stage(id), ...[1, 2, 3, 4, 5, 6].flatMap((n) => [R.frame(id, n, 'start'), R.frame(id, n, 'end')]), ...takesOf(id).map((t) => t.ref)].filter((r) => get(r)), open = refs.flatMap((r) => th(r).map((c) => `- ${r}: ${c.author}${c.verdict ? ` [${c.verdict}]` : ''}: ${c.body || '(drawing)'}`));
    lines.push(`## ${s.data.n}. ${s.data.name} (${s.data.seconds} s)`, '', String((s.data.notes || {}).happens || ''), '', open.length ? `Open feedback:\n${open.join('\n')}` : 'No open feedback.', '');
  }
  return lines.join('\n');
}
async function build() {
  const s = settings(), film = filmOf(), { scenes } = state(), ins = scenes.map((sc) => sceneInput(sc, film)), root = slug(film.name) || 'film';
  const entries = filmEntries(film, ins, { target: s.target, max: s.max });
  if (s.srt) { entries.push({ path: `${root}/captions/film-${slug(film.speech || 'original')}.srt`, text: filmSrt(scenes, (l) => l.text) }); entries.push({ path: `${root}/captions/film-english.srt`, text: filmSrt(scenes, (l) => l.en) }); }
  if (s.review) entries.push({ path: `${root}/review.md`, text: reviewDoc(film, scenes) });
  if (s.staging) for (const [i, inp] of ins.entries()) for (const a of inp.stage) entries.push({ path: `${root}/staging/${sceneDir(scenes[i])}/${a.role}${a.shot ? '-' + a.shot.split(':').pop() : ''}.${(/\.(\w+)$/.exec(a.uri) || [, 'png'])[1]}`, uri: a.uri });
  if (s.backup) entries.push({ path: `${root}/backup.json`, text: JSON.stringify(await api(P('/backup')), null, 2) });
  return buildZip(entries, fetchBytes);
}
// The whole film as a .zip, saved to disk. Returns the files that could not be read.
export async function downloadFilm() { const { bytes, missing } = await build(); saveBlob(`${slug(filmOf().name) || 'film'}-pack.zip`, bytes); return missing; }
const allPrompts = () => { const f = filmOf(); return sceneArts().map((sc) => `Scene ${sc.data.n} · ${sc.data.name}\n${clipsOf(sc).map((c, i) => { const p = composeClip(sc, f, i + 1); return `Clip ${i + 1} of ${clipsOf(sc).length} (${p.seconds} s)\n${p.prompt}\nMust not show: ${p.negative || 'nothing special'}`; }).join('\n\n')}`).join('\n\n-----\n\n'); };

function htmlShip(ctx) {
  const s = settings(), film = filmOf(), { scenes, rs, notReady } = state(), fmt = ((get(REFS.story) || {}).data || {}).format || {};
  const total = scenes.reduce((a, x) => a + (+x.data.seconds || 0), 0), takes = scenes.map((sc) => takesOf(keyOf(sc.ref)));
  const chip = (act, v, label, on) => `<span class="ch cl ${on ? 'on' : ''}" tabindex="0" role="button" data-act="${act}" data-v="${esc(v)}" aria-pressed="${on}">${on ? '✓ ' : ''}${esc(label)}</span>`;
  const dl = (k, label, sub) => `<div class="wzp-dl">${chip('wsh-opt', k, label, !!s[k])}<span class="sm mute">${sub}</span></div>`;
  const A = `<span class="lbl" style="margin-top:0">What to send</span><p class="sm mute" style="margin:0 0 8px">Everything you tick goes into one .zip. Nothing is sent anywhere. The pack has no video and no audio: Meta cannot make them.</p>
  <div class="wzp-dl"><span class="ch on">✓ Generator packs, one per scene</span><span class="sm mute">Always included: prompts, pictures, stage controls, transcripts, manifest.</span></div>
  ${dl('srt', 'Captions for the whole film', 'Two .srt files: your speech language and English, from the transcripts.')}
  ${dl('staging', 'Staging package', 'The stage pictures of every scene in one folder (layout, depth, camera).')}
  ${dl('review', 'Review document', 'A text file with each scene and the feedback still open.')}
  ${dl('backup', 'Backup', 'Everything in this production as one JSON file. Media files are not in it.')}
  <span class="lbl">What can your generator take?</span><div>${TARGETS.map(([k, l]) => chip('wp-target', k, l, s.target === k).replace('✓ ', '')).join('')}</div>
  <div class="row" style="margin-top:6px"><button class="bt sm" data-act="wsh-copy">Copy every prompt</button><span class="sm mute">Scene by scene, in one text.</span></div>`;

  const bars = (r) => `<span class="wzp-bars" aria-label="${SUBS.slice(0, 4).map((u, i) => `${u[1]} ${['not started', 'in progress', 'ready'][r[i]]}`).join(', ')}">${SUBS.slice(0, 4).map((u, i) => `<i class="k-${u[0]} v${r[i]}" title="${u[1]}: ${['not started', 'in progress', 'ready'][r[i]]}"></i>`).join('')}</span>`;
  const rows = scenes.map((sc, i) => { const id = keyOf(sc.ref), n = takes[i].length; return `<a class="wzp-row" href="${hrefOf('scenes', id, 'brief')}"><b>${sc.data.n} · ${esc(sc.data.name)}</b><span class="sm mute">${sc.data.seconds} s</span>${bars(rs[i])}<span class="sm mute">${n ? `${n} take${n === 1 ? '' : 's'} back` : 'no clip back yet'}</span></a>`; }).join('');
  const lane = scenes.map((sc, i) => { const id = keyOf(sc.ref), tk = takes[i].find((t) => t.data.picked) || takes[i][0], src = tk && tk.assets && tk.assets[0] ? mediaSrc(tk.assets[0].uri) : '';
    return `<a class="wzp-cell" style="flex:${Math.max(1, +sc.data.seconds || 1)} 1 ${Math.max(84, (+sc.data.seconds || 1) * 9)}px" href="${hrefOf('scenes', id, 'pack')}" title="Scene ${sc.data.n} · ${sc.data.seconds} s">${src ? `<video muted preload="metadata" playsinline src="${esc(src)}#t=0.1"></video>` : '<span class="wzp-ph">no clip yet</span>'}<small>${sc.data.n} · ${sc.data.seconds} s</small></a>`; }).join('');

  const notes = [], want = +fmt.seconds || 0;
  if (scenes.length) notes.push(!want || Math.abs(total - want) / want <= 0.1 ? ['ok', `The scenes add up to ${total} s${want ? `, close to the ${want} s you asked for` : ''}.`] : ['warn', `The scenes add up to ${total} s. You asked for ${want} s. ${lk('Look at the scenes', hrefOf('scenes'))}`]);
  else notes.push(['warn', `There are no scenes yet. ${lk('Make the scenes', hrefOf('scenes'))}`]);
  for (const [i, sc] of scenes.entries()) { const id = keyOf(sc.ref), bad = [0, 2, 3].filter((k) => rs[i][k] < 2); if (bad.length) notes.push(['warn', `Scene ${sc.data.n} · ${esc(sc.data.name)} is not ready: ${bad.map((k) => lk(`${SUBS[k][1]}${rs[i][k] === 0 ? ' (not started)' : ''}`, hrefOf('scenes', id, SUBS[k][0]))).join(', ')}`]); }
  const noTake = scenes.filter((sc, i) => !takes[i].length).length; if (scenes.length) notes.push([noTake ? 'warn' : 'ok', noTake ? `${noTake} of ${scenes.length} scenes have no clip back from the generator yet. That is expected until you have made them. Bring them back on each scene's Pack page.` : 'Every scene has a clip back.']);
  const open = st.d.comments.filter((c) => c.status === 'open' && !c.parent), ref = open[0] && get(open[0].ref);
  notes.push([open.length ? 'warn' : 'ok', open.length ? `${open.length} piece${open.length === 1 ? '' : 's'} of feedback ${open.length === 1 ? 'is' : 'are'} still open.${ref ? ' ' + lk('Open the first one', pageOf(ref)) : ''}` : 'No feedback is waiting.']);
  const stale = st.d.arts.filter((a) => a.stale); if (stale.length) notes.push(['warn', `${stale.length} item${stale.length === 1 ? ' is' : 's are'} out of date because something under ${stale.length === 1 ? 'it' : 'them'} changed: ${stale.slice(0, 3).map((a) => lk(esc(((a.data || {}).name || (a.data || {}).title || a.ref)), pageOf(a))).join(', ')}.`]);

  const slate = `<div class="slate"><div class="clapr top"></div><div class="clapr"></div><div class="sg"><div><small>Film</small><b>${esc(film.name)}</b></div><div><small>Scenes</small><b>${scenes.length}</b></div><div><small>Runtime</small><b>${total} s</b></div><div><small>Shape</small><b>${esc(((film.look || {}).aspect) || fmt.aspect || '9:16')}</b></div></div></div>`;
  const B = `${slate}<span class="lbl" style="margin-top:0">Scenes at a glance</span><p class="sm mute" style="margin:0 0 6px">Four bars each: Brief, Stage, Pictures, Sound. Click a scene to open it.</p><div class="wzp-rows">${rows || nothing('No scenes yet.')}</div>
  <span class="lbl">The film in order</span><div class="wzp-lane">${lane || nothing('No scenes yet.')}</div>
  <div class="cd wzp-after"><h5>After the generator</h5><p class="sm" style="margin:0 0 6px">Make each clip in your generator from its scene pack. Then bring the clip file back on that scene's Pack page. I check the first and last picture against yours.</p><div>${scenes.map((sc) => lk(`Scene ${sc.data.n} · Pack`, hrefOf('scenes', keyOf(sc.ref), 'pack'))).join(' · ') || ''}</div></div>`;
  return spine(ctx, { A, B, items: [], notice: notes, ai: 'This is the film so far. I list what I noticed, and where to fix it. Download the pack when you are ready.',
    next: { label: 'Download the film pack · .zip', act: 'wsh-zip' }, gate: { ready: scenes.length > 0, reason: !scenes.length ? 'There are no scenes to pack yet.' : notReady.length ? `${notReady.length} of ${scenes.length} scenes are not ready. You can still download. Missing parts are listed in the zip.` : 'Everything is ready. The zip holds all you ticked above.' }, act: 'C' });
}
registerStep('ship', {
  items: () => [], html: htmlShip,
  acts: {
    'wsh-opt'(el) { setSettings({ [el.dataset.v]: !settings()[el.dataset.v] }); return 'render'; },
    'wsh-copy'() { return copyText(allPrompts(), 'Every prompt copied.'); },
    async 'wsh-zip'() {
      const b = document.getElementById('wz-go'); if (b) { b.disabled = true; b.textContent = 'Building the pack...'; }
      try { const { bytes, missing } = await build(); saveBlob(`${slug(filmOf().name) || 'film'}-pack.zip`, bytes); toast(missing.length ? `Downloaded. ${missing.length} file${missing.length === 1 ? '' : 's'} could not be read; they are listed in MISSING.txt.` : 'Downloaded.'); }
      catch (e) { toast(`I could not build the pack: ${e.message}`); }
      return 'render';
    },
  },
});
