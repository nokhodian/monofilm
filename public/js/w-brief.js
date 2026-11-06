// Step 6, Scenes: the scene list ('list'), a scene's Brief ('brief') and Sound ('sound'). Registered with registerSub() from w-scenes.js.
//   list  : A write all briefs, the time budget, edit name/seconds, + Scene.  B every scene as a reviewable item (scene:<id>) with readiness bars.
//   brief : A the transcript, the six notes, anchor source, clip plan (the ONE home of all of these).  B the scene as ONE reviewable item with the script and notes as clickable parts.
//   sound : A cues (scene.data.cues [{id,name,at,level}]), read-only sound note and captions.  B lines and cues as clickable parts. items = [] on purpose: the scene is approved in Brief, so it is not counted twice.
// Edits are applied to the page's snapshot at once and saved a moment later with ownEdit (like w-start.js). Typing never re-renders the page, so the cursor stays; only part B is repainted in place.
import { $, esc, api, P, toast } from './core.js';
import { get } from './data.js';
import { R, REFS, SUBS, NOTE_KEYS, ANCHOR_MODES, JOINS, MAX_CLIP, FORMAT_DEFAULT, sceneBounds, clampScene, clipPlan, clipSpans, clipBeats, linesOfClip, cuesOfClip, emptyScene, sceneReadiness, keyOf, slug } from './wizard-model.js';
import { gateReason } from './w-pure.js';
import { W, spine, itemEl, chipOf, statusOf, pill, nothing, ownEdit, sceneArts, rerender, hrefOf, hrefIn } from './w-core.js';
import { clipBar } from './w-clips.js';
import { registerFix, markSel, placeMargin } from './w-fix.js';
import { registerSub } from './w-scenes.js';

const S = { busy: false, err: '', redo: false };
const rc = { get, assets: (ref) => (get(ref) || {}).assets || [] };
const fmtOf = () => ({ ...FORMAT_DEFAULT, ...((get(REFS.story) || {}).data || {}).format });
const nameOf = (ref) => ((get(ref) || {}).data || {}).name || '';
const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());

// ---------- autosave: patch the snapshot now, save later ----------
const Q = { p: {}, t: 0, chain: Promise.resolve() };
const say = (t) => { const e = $('#wzb-saved'); if (e) e.textContent = t; };
function patch(ref, fn) { const a = get(ref); if (a) a.data = fn(a.data); (Q.p[ref] = Q.p[ref] || []).push(fn); say('Saving…'); }
const later = () => { clearTimeout(Q.t); Q.t = setTimeout(flush, 700); };
export function flush() {
  clearTimeout(Q.t); const todo = Q.p; Q.p = {};
  if (!Object.keys(todo).length) return Q.chain;
  Q.chain = Q.chain.then(async () => {
    try { for (const r of Object.keys(todo)) await ownEdit(r, (d) => todo[r].reduce((x, f) => f(x), d), 'Edited in the wizard'); say('Saved.'); }
    catch (e) { for (const r of Object.keys(todo)) Q.p[r] = [...todo[r], ...(Q.p[r] || [])]; say(`Not saved: ${e.message}`); toast(`Not saved: ${e.message}`); }
  });
  return Q.chain;
}
addEventListener('hashchange', () => { flush(); });
const setSeconds = (v) => (d) => { const n = clampScene(v, fmtOf()); d.seconds = n; d.clips = clipPlan(n, MAX_CLIP, (d.clips || []).map((c) => c.join)); if ((d.beats || []).length !== d.clips.length) d.beats = []; return d; };
// "n:happens" a note, "l:<id>:text" a line, "c:<id>:name" a cue, "s:name|seconds|tag" the scene itself
function setter(key, v) {
  const [k, a, b] = key.split(':');
  if (k === 'n') return (d) => { d.notes = d.notes || {}; d.notes[a] = v; return d; };
  if (k === 'b') return (d) => { const arr = clipBeats(d); arr[Number(a) - 1] = v; d.beats = arr; return d; }; // what happens in clip <a>; the others keep what they had
  if (k === 'l') return (d) => { const l = (d.transcript || []).find((x) => x.id === a); if (l) l[b] = b === 'sec' ? Number(v) || 0 : v; return d; };
  if (k === 'c') return (d) => { const c = (d.cues || []).find((x) => x.id === a); if (c) c[b] = b === 'at' ? Number(v) || 0 : v; return d; };
  if (k === 's') return a === 'seconds' ? setSeconds(v) : (d) => { d[a] = v; return d; };
  return (d) => d;
}
const nextId = (list, p) => `${p}${Math.max(0, ...(list || []).map((x) => parseInt(String(x.id).slice(p.length), 10) || 0)) + 1}`;
const act = async (ref, fn) => { patch(ref, fn); await flush(); return 'render'; };

// ---------- shared bits ----------
const scn = (ctx) => get(R.scene(ctx.scene));
const link = (label, href) => `<a class="lk" href="${href}">${label}</a>`;
const bars = (r) => `<span class="wzb-bars" role="img" aria-label="${SUBS.map((u, i) => `${u[1]} ${['not started', 'in progress', 'ready'][r[i]]}`).join(', ')}">${SUBS.map((u, i) => `<span class="wzb-bar k-${u[0]} s${r[i]}"><i></i>${u[1]}</span>`).join('')}</span>`;
function tabs(ctx) {
  const r = sceneReadiness(scn(ctx), rc);
  return `<nav class="ptabs" aria-label="Pages of this scene">${SUBS.map((u, i) => `<button class="k-${u[0]} ${u[0] === ctx.sub ? 'on' : ''}" data-go="${hrefIn(ctx, u[0])}" ${u[0] === ctx.sub ? 'aria-current="page"' : ''}><small>${i + 1}</small>${u[1]}${r[i] === 2 ? ' <span class="tick" aria-label="ready">✓</span>' : ''}</button>`).join('')}</nav>`;
}
const field = (key, v, o = {}) => `<input class="f ${o.cls || ''}" data-wbf="${key}" value="${esc(v)}" ${o.type ? `type="${o.type}" min="${o.min ?? 0}" ${o.max ? `max="${o.max}"` : ''} ${o.step ? `step="${o.step}"` : ''}` : ''} aria-label="${esc(o.label || '')}" placeholder="${esc(o.ph || '')}">`;

// ---------- the scene list ----------
const budget = (scenes) => {
  const total = scenes.reduce((s, a) => s + (Number(a.data.seconds) || 0), 0), want = Number(fmtOf().seconds) || 0, diff = total - want;
  if (!scenes.length) return { ok: true, text: want ? `The film is ${want} s long. The scenes will add up to that.` : '' };
  return { ok: !want || diff === 0, text: !want || diff === 0 ? `The scenes add up to ${total} s. That fits the film.` : `The scenes add up to ${total} s but the film is ${want} s. That is ${Math.abs(diff)} s too ${diff > 0 ? 'long' : 'short'}. Change a scene's seconds below.` };
};
function sceneRow(a) {
  const id = keyOf(a.ref), d = a.data, r = sceneReadiness(a, rc), clips = (d.clips || []).length || 1;
  const inner = `<div class="ri"><b>${d.n} · ${esc(d.name)}</b> ${d.tag ? pill(d.tag) : ''}<div class="sm mute">${d.seconds} s · ${clips} clip${clips === 1 ? '' : 's'}${d.place ? ` · ${esc(nameOf(d.place))}` : ''}</div>${bars(r)}</div><div class="wzb-side">${chipOf(a.ref)}${link('Open scene →', hrefOf('scenes', id))}</div>`;
  return itemEl(a.ref, inner, { cls: 'rowitem hc wzb-scene', kind: 'scene' });
}
const listB = () => { const sc = sceneArts(); return sc.length ? sc.map(sceneRow).join('') : nothing('No scenes yet. Press the first button above and I will write them.'); };
function listA(scenes) {
  const b = budget(scenes), why = !get(REFS.episode) ? 'Finish steps 1 and 2 first, then I can write the scenes.' : '';
  const rows = scenes.map((a) => `<div class="wzb-edit"><span class="mono mute">${a.data.n}</span>${field(`s:name`, a.data.name, { label: `Name of scene ${a.data.n}` }).replace('data-wbf="s:name"', `data-wbf="s:name" data-ref="${esc(a.ref)}"`)}<label class="wzb-sec">${field('s:seconds', a.data.seconds, { type: 'number', min: sceneBounds(fmtOf())[0], max: sceneBounds(fmtOf())[1], step: 1, label: `Seconds of scene ${a.data.n}`, cls: 'wzb-num' }).replace('data-wbf="s:seconds"', `data-wbf="s:seconds" data-ref="${esc(a.ref)}"`)} s</label></div>`).join('');
  return `<span class="lbl" style="margin-top:0">Write the scenes</span>
  <p class="rule">I turn your story into scenes. Each one gets a brief: a script, notes for the video maker and its length.</p>
  <div class="row"><button class="bt pri big" data-act="wb-draft" ${S.busy || why ? 'disabled' : ''}>${S.busy ? 'Writing the scenes…' : scenes.length ? 'Write all the scene briefs again' : 'Write all the scene briefs for me'}</button><span class="sm mute">${S.busy ? 'This takes a little while. You can wait here.' : why || (scenes.length ? 'This replaces the scenes I wrote before. Your own new scenes stay.' : 'Nothing is made until you press it.')}</span></div>
  ${S.err ? `<p class="wzb-err" role="alert">${esc(S.err)}</p>` : ''}
  <span class="lbl">How long is each scene</span><p class="wzb-bud ${b.ok ? 'ok' : 'warn'}" id="wzb-bud" aria-live="polite"><b aria-hidden="true">${b.ok ? '✓' : '!'}</b> ${esc(b.text)}</p>
  ${rows ? `<div class="wzb-edits">${rows}</div>` : ''}
  <div class="row" style="margin-top:8px"><button class="bt sm" data-act="wb-add" ${get(REFS.episode) ? '' : 'disabled'}>+ Scene</button><span class="mute sm" id="wzb-saved"></span></div>`;
}
function htmlList(ctx) {
  const sc = sceneArts(), refs = sc.map((a) => a.ref), sts = refs.map(statusOf), todo = sts.filter((s) => s !== 'ok').length, chg = sts.filter((s) => s === 'change').length, all2 = sc.length && sc.every((a) => sceneReadiness(a, rc).every((x) => x === 2));
  const b = budget(sc);
  const reason = !sc.length ? 'Write the scene briefs first.' : todo ? gateReason({ todo, chg, noun: ['scene', 'scenes'], n: sc.length }) : all2 ? 'Every scene is ready. You can go on to Ship.' : 'All briefs are approved. Some scenes still need work in Stage, Pictures, Sound or Pack, but you can go on.';
  return spine(ctx, { A: listA(sc), B: listB(), items: refs, noun: ['scene', 'scenes'], title: 'Turn the story into scenes', act: sc.length ? undefined : 'A', empty: !sc.length,
    ai: sc.length ? 'Here are the scenes. Open one to read and change its brief, or click it to write a note on it.' : 'I have not written any scenes yet. Press the first button and I will draft them from your story.',
    notice: sc.length && !b.ok ? [['warn', esc(b.text)]] : [], next: { label: 'Go to Ship →', href: hrefOf('ship') }, gate: { ready: !!sc.length && !todo, reason } });
}

// ---------- 'brief' ----------
const peopleOf = (d) => (d.who || []).map((r) => ({ ref: r, name: nameOf(r) })).filter((x) => x.name);
const A_STEP = { chip: (label, href) => `<a class="ch lk" href="${href}">${label}</a>` };
function sceneHead(ctx, a) {
  const d = a.data, ppl = peopleOf(d), look = (get(REFS.look) || {}).data || {}, place = d.place ? get(d.place) : null, faces = ppl.filter((p) => ((get(p.ref) || {}).data || {}).anchor).length;
  return `${tabs(ctx)}${clipBar(ctx)}
  <div class="wzb-head"><div class="row"><b class="mono">Scene ${d.n}</b>${d.tag ? pill(d.tag) : ''}<span class="mono">${d.seconds} s</span><span class="mute">${esc(d.time && d.time !== 'none' ? cap(d.time) : 'No time of day')}</span></div>
  <div class="inh"><span class="mute sm">Where and who</span>${place ? A_STEP.chip(`${esc(place.data.name)} · change in step 5`, hrefOf('places')) : `<span class="ch">No place chosen</span> ${A_STEP.chip('Choose in step 5', hrefOf('places'))}`}${ppl.length ? ppl.map((p) => A_STEP.chip(`${esc(p.name)} · change in step 4`, hrefOf('people'))).join('') : '<span class="ch">Nobody on screen</span>'}</div>
  <div class="inh"><span class="mute sm">Inherited from the film</span>${A_STEP.chip(`Look: ${esc(look.look || look.base || look.name || 'the film look')}`, hrefOf('look'))}${A_STEP.chip(`People: ${ppl.length ? `${faces} of ${ppl.length} with a face` : 'none here'}`, hrefOf('people'))}${A_STEP.chip(`Place plate: ${place ? ((place.assets || []).length || (place.data || {}).anchor ? 'made' : 'not made yet') : 'no place'}`, hrefOf('places'))}</div></div>`;
}
function transcriptA(d) {
  const sp = fmtOf().speech, ls = d.transcript || [];
  return `<span class="lbl" style="margin-top:0">Dialogue · ${esc(sp)}</span>
  <p class="sm mute" style="margin:0 0 8px">The transcript lives here and nowhere else. Write the line in ${esc(sp)}, then what it means in English. Seconds are how long it takes to say.</p>
  <div class="wzb-lines">${ls.length ? `<div class="wzb-ln wzb-lh" aria-hidden="true"><span>Who</span><span>Says (${esc(sp)})</span><span>In English</span><span>Sec</span><span></span></div>` : '<p class="nothing">No speech in this scene yet. Sound and picture only.</p>'}${ls.map((l) => `<div class="wzb-ln">${field(`l:${l.id}:who`, l.who, { label: 'Who speaks', ph: 'WHO', cls: 'wzb-who' })}<textarea class="f" rows="2" data-wbf="l:${l.id}:text" aria-label="What is said, in ${esc(sp)}" placeholder="What is said">${esc(l.text)}</textarea>${field(`l:${l.id}:en`, l.en, { label: 'English meaning', ph: 'In English' })}${field(`l:${l.id}:sec`, l.sec, { type: 'number', min: 0, step: 0.5, label: 'Seconds', cls: 'wzb-num' })}<button class="bt sm" data-act="wb-lrm" data-id="${esc(l.id)}" aria-label="Remove this line">×</button></div>`).join('')}</div>
  <div class="row" style="margin-top:6px"><button class="bt sm" data-act="wb-ladd">+ Line</button><button class="bt sm" data-act="wb-ladd" data-who="NARRATOR">+ Narration</button></div>`;
}
const notesA = (d) => `<span class="lbl">Notes for the video maker</span><p class="sm mute" style="margin:0 0 6px">These words go to the video maker as they are. The first note is the action line of the script. Pack shows the finished prompt, read only.</p>
  <div class="notes">${NOTE_KEYS.map(([k, l]) => `<div class="dn ${k === 'never' ? 'wzb-never' : ''}"><label class="nm" for="wzb-n-${k}">${l}</label><textarea id="wzb-n-${k}" data-wbf="n:${k}" rows="2">${esc((d.notes || {})[k] || '')}</textarea></div>`).join('')}</div>`;
const MODE_HINT = { stage: 'Made from your stage, then varied.', chain: (n, w) => (w === 'start' ? `Starts where scene ${n - 1} ends, so the cut is smooth.` : 'Ends where the next scene starts.'), own: 'Your own picture, added in Pictures.', skip: (n, w) => `No ${w} picture. The video maker decides.` };
function anchorsA(d) {
  const one = (w) => { const cur = (d[w] || {}).mode || 'stage', hint = MODE_HINT[cur], first = d.n === 1;
    return `<div><span class="wk">${w === 'start' ? 'Start' : 'End'} picture · where does it come from?</span><div>${ANCHOR_MODES.filter((m) => !(m[0] === 'chain' && w === 'start' && first)).map((m) => `<span class="ch cl ${cur === m[0] ? 'on' : ''}" tabindex="0" role="button" aria-pressed="${cur === m[0]}" data-act="wb-anchor" data-w="${w}" data-v="${m[0]}">${m[1]}</span>`).join('')}</div><div class="sm mute">${typeof hint === 'function' ? hint(d.n, w) : hint}</div></div>`; };
  return `<span class="lbl">Start and end pictures</span><div class="g2" style="gap:24px">${one('start')}${one('end')}</div>`;
}
function clipsA(d) {
  const clips = d.clips && d.clips.length ? d.clips : clipPlan(d.seconds);
  return `<span class="lbl">Length and clips</span><div class="row"><label class="row"><b>Scene length</b> ${field('s:seconds', d.seconds, { type: 'number', min: sceneBounds(fmtOf())[0], max: sceneBounds(fmtOf())[1], step: 1, label: 'Scene length in seconds', cls: 'wzb-num' })} s</label><span class="mute sm">Video makers make short clips (up to ${MAX_CLIP} s), so I split the scene.</span></div>
  <div class="clips" role="img" aria-label="${clips.map((c, i) => `clip ${i + 1}: ${c.seconds} seconds`).join(', ')}">${clips.map((c, i) => `<i style="flex:${c.seconds}">clip ${i + 1} · ${c.seconds} s</i>`).join('')}</div>
  ${clips.length > 1 ? clips.slice(1).map((c, k) => `<div class="wzb-join"><span class="wk">How clip ${k + 2} begins</span><div>${JOINS.map((j) => `<span class="ch cl ${c.join === j[0] ? 'on' : ''}" tabindex="0" role="button" aria-pressed="${c.join === j[0]}" data-act="wb-join" data-i="${k + 1}" data-v="${j[0]}">${j[1]}</span>`).join('')}</div><div class="sm mute">${c.join === 'cut' ? 'A new view. This clip gets its own start picture.' : 'Same view, place and people. No jump.'}</div></div>`).join('') : '<div class="sm mute">One clip. No split needed.</div>'}${clips.length > 1 ? beatsA(d, clips) : ''}`;
}
// What happens in each clip, so no clip is asked to do the whole scene. Shared out from "What happens" until the person writes their own.
const beatsA = (d, clips) => `<span class="lbl">What happens in each clip</span><p class="sm mute" style="margin:0 0 6px">${Array.isArray(d.beats) && d.beats.length === clips.length ? 'Your own lines, one for each clip.' : 'Shared out from What happens, in order. Change a line to write your own.'} Each clip is asked to do only its own part, so it does not rush, repeat or cut.</p><div class="notes">${clipBeats(d).map((b, i) => `<div class="dn"><label class="nm" for="wzb-b-${i + 1}">Clip ${i + 1} · ${clips[i].seconds} s</label><textarea id="wzb-b-${i + 1}" data-wbf="b:${i + 1}" rows="2" placeholder="Nothing of its own: it carries on calmly.">${esc(b)}</textarea></div>`).join('')}</div>`;
function scriptB(a) {
  const d = a.data, ref = a.ref, sp = fmtOf().speech, place = d.place ? nameOf(d.place) : '', hap = (d.notes || {}).happens || '';
  const slugl = [place, d.time && d.time !== 'none' ? d.time : ''].filter(Boolean).join(' · ').toUpperCase() || esc(d.name).toUpperCase();
  const lines = (d.transcript || []).filter((l) => l.text || l.en);
  return `<div class="script"><div class="sh"><span>${d.n}</span>${esc(slugl)}</div>
  ${itemEl(ref, `<span class="dtxt">${hap ? esc(hap) : '<i class="mute">Nothing written yet.</i>'}</span>`, { part: 'note:happens', kind: 'dir', cls: 'act', name: 'What happens' })}
  ${lines.length ? lines.map((l) => itemEl(ref, `<div class="cue">${esc(l.who || 'Narrator')}</div><div class="par">${/^NARRATOR/i.test(l.who || '') ? '(V.O., ' : '('}in ${esc(sp)})</div><div class="dlg">${esc(l.text)}</div><div class="sub">${esc(l.en)}${l.sec ? ` · ${l.sec} s` : ''}</div>`, { part: `line:${l.id}`, kind: 'line', cls: 'wdl', name: `${l.who || 'Narrator'}: ${String(l.text).slice(0, 40)}` })).join('') : '<p class="act dim">(No speech. Sound and picture only.)</p>'}
  <p class="tr">${d.n < sceneArts().length ? 'Cut to:' : 'Fade out.'}</p></div>`;
}
const notesB = (a) => NOTE_KEYS.filter(([k]) => k !== 'happens').map(([k, l]) => { const t = ((a.data.notes || {})[k] || '').trim(); return itemEl(a.ref, `<div class="ri"><span class="nm">${l}</span>${k === 'never' ? ' ' + pill('rule', 'warn') : ''}<div class="dtxt">${t ? esc(t) : '<i class="mute">Nothing written yet.</i>'}</div></div>`, { part: `note:${k}`, kind: 'dir', cls: `dn hc ${k === 'never' ? 'wzb-never' : ''}`, name: l }); }).join('');
function briefB(a) {
  const d = a.data, clips = (d.clips || []).length || 1;
  return `${itemEl(a.ref, `<div class="ri"><b>Scene ${d.n} · ${esc(d.name)}</b><div class="sm mute">${d.seconds} s · ${clips} clip${clips === 1 ? '' : 's'} · ${(d.transcript || []).length} line${(d.transcript || []).length === 1 ? '' : 's'}. Press “Looks right” in the margin when the brief is fine. Pictures can only be made after that.</div></div>${chipOf(a.ref)}`, { cls: 'rowitem hc wzb-scene', kind: 'scene' })}
  <div class="row wzb-redo"><input class="f" id="wb-instr" placeholder="What should change? (optional)" aria-label="What should change in this brief"><button class="bt" data-act="wb-redo" ${S.redo ? 'disabled' : ''}>${S.redo ? 'Redoing…' : 'Redo this brief'}</button></div>
  <div class="brief"><div><span class="lbl" style="margin-top:0">Script · click a line</span>${scriptB(a)}</div><div class="notes"><span class="lbl" style="margin-top:0">Notes for the video maker</span>${notesB(a)}</div></div>`;
}
function htmlBrief(ctx) {
  const a = scn(ctx); if (!a) return htmlList(ctx);
  const empty = NOTE_KEYS.filter(([k]) => !String((a.data.notes || {})[k] || '').trim()).length;
  const A = `<div class="row" style="justify-content:flex-end"><span class="mute sm" id="wzb-saved" aria-live="polite"></span></div>${transcriptA(a.data)}${notesA(a.data)}${anchorsA(a.data)}${clipsA(a.data)}`;
  return spine(ctx, { head: sceneHead(ctx, a), title: `Scene ${a.data.n} · ${a.data.name}`, A, B: briefB(a), items: [a.ref], noun: ['brief', 'briefs'],
    ai: 'This is everything the video maker will be told about this scene. Fix what is off, then press “Looks right”.',
    notice: empty ? [['warn', `${empty} of the ${NOTE_KEYS.length} notes ${empty === 1 ? 'is' : 'are'} empty. Fill ${empty === 1 ? 'it' : 'them'} in, or ask me to redo the brief.`]] : [['ok', 'All six notes are written.']] });
}

// ---------- 'sound' ----------
const LEVELS = [['low', 'Quiet'], ['mid', 'Normal'], ['high', 'Loud']];
function soundA(a, clip = 1) {
  const d = a.data, multi = clipSpans(d).length > 1, span = clipSpans(d)[clip - 1] || { from: 0, to: d.seconds }, cues = multi ? cuesOfClip(d, clip) : d.cues || [], f = fmtOf(), caps = (f.captions || []).length ? f.captions.join(', ') : 'none', snd = ((d.notes || {}).sound || '').trim();
  return `<div class="wzb-honest"><b>Good to know.</b> Meta has no voice or sound generator. Your lines and sounds go into the pack as text and as the transcript, not as audio. Take them to any voice or sound maker you like.</div>
  <span class="lbl">Sounds and music for ${multi ? `clip ${clip} (${span.from}–${span.to} s of the scene)` : 'this scene'}</span>
  <div class="wzb-lines">${cues.length ? `<div class="wzb-cu wzb-lh" aria-hidden="true"><span>Sound</span><span>At (s)</span><span>Level</span><span></span></div>` : `<p class="nothing">No sounds ${multi ? 'in this clip' : 'yet'}. Add one, for example “wind” or “low music”.</p>`}${cues.map((c) => `<div class="wzb-cu">${field(`c:${c.id}:name`, c.name, { label: 'Sound or music', ph: 'What it is' })}${field(`c:${c.id}:at`, c.at, { type: 'number', min: 0, step: 0.5, label: 'Starts at (seconds of the scene)', cls: 'wzb-num' })}<select class="f" data-wbf="c:${c.id}:level" aria-label="Level">${LEVELS.map((l) => `<option value="${l[0]}" ${c.level === l[0] ? 'selected' : ''}>${l[1]}</option>`).join('')}</select><button class="bt sm" data-act="wb-crm" data-id="${esc(c.id)}" aria-label="Remove this sound">×</button></div>`).join('')}</div>
  <div class="row" style="margin-top:6px"><button class="bt sm" data-act="wb-cadd">+ Sound</button><span class="mute sm" id="wzb-saved" aria-live="polite"></span></div>
  <span class="lbl">Set elsewhere</span>
  <div class="wzb-ro"><div><span class="wk">Sound in the picture</span><div class="sm">${snd ? esc(snd) : '<i class="mute">Not written yet.</i>'}</div>${link('Change in Brief', hrefOf('scenes', keyOf(a.ref), 'brief'))}</div>
  <div><span class="wk">Captions</span><div class="sm">${esc(caps)}</div>${link('Change in Start', hrefOf('start'))}</div></div>`;
}
function soundB(a, clip = 1) {
  const d = a.data, multi = clipSpans(d).length > 1, ls = multi ? linesOfClip(d, clip) : (d.transcript || []).filter((l) => l.text), cues = multi ? cuesOfClip(d, clip) : d.cues || [];
  return `<div class="g2 wzb-snd"><div><span class="lbl" style="margin-top:0">Lines in ${multi ? `clip ${clip}` : 'this scene'} · click one</span>${ls.length ? ls.map((l) => itemEl(a.ref, `<div class="ri"><div class="wzb-dl"><b class="mono">${esc(l.who || 'Narrator')}</b><span class="mono mute sm">${multi ? `at ${l.at} s` : ''}${l.sec ? `${multi ? ' · ' : ''}${l.sec} s` : ''}</span></div><div style="font-size:17px">${esc(l.text)}</div><div class="sm mute">${esc(l.en)}</div></div>`, { part: `line:${l.id}`, kind: 'line', cls: 'rowitem hc2', name: `${l.who || 'Narrator'}: ${String(l.text).slice(0, 40)}` })).join('') : `<div class="sm mute">No speech in ${multi ? 'this clip' : 'this scene'}. ${link('Add lines in Brief', hrefOf('scenes', keyOf(a.ref), 'brief'))}</div>`}
  <p class="sm mute" style="margin:8px 0 0">Click a line to say “too fast”, “mispronounced” and so on. The speed and energy sliders are only a note: the voice maker you use reads them.</p></div>
  <div><span class="lbl" style="margin-top:0">Sounds and music · click one</span>${cues.length ? cues.map((c) => itemEl(a.ref, `<div class="ri"><b>${esc(c.name || 'Sound')}</b><div class="sm mute">from ${c.at || 0} s · ${(LEVELS.find((l) => l[0] === c.level) || LEVELS[1])[1].toLowerCase()}</div></div>`, { part: `cue:${c.id}`, kind: 'cue', cls: 'rowitem hc2', name: c.name || 'Sound' })).join('') : '<div class="sm mute">No sounds added.</div>'}</div></div>`;
}
function htmlSound(ctx) {
  const a = scn(ctx); if (!a) return htmlList(ctx);
  return spine(ctx, { head: sceneHead(ctx, a), title: `Scene ${a.data.n} · ${a.data.name}`, A: soundA(a, ctx.clip), B: soundB(a, ctx.clip), items: [], act: 'B',
    ai: clipSpans(a.data).length > 1 ? `Here are the lines and sounds for clip ${ctx.clip}. Choose another clip above to see its own. Click one to leave a note on it.` : 'Here are the lines and sounds for this scene. Click one to leave a note on it.',
    gate: { ready: true, reason: `The scene itself is approved in Brief (${statusOf(a.ref) === 'ok' ? 'it is' : 'not yet'}). Nothing to approve here, so you can go on.` } });
}

// ---------- events ----------
function liveB(root) {
  const ctx = { scene: W.scene, sub: (W.scene ? W.sub : 'list') }, a = scn(ctx), pb = $('.pB .pb', root);
  const keep = document.activeElement;
  if (!pb) return;
  if (ctx.scene && a) pb.innerHTML = (W.scene ? W.sub : 'list') === 'sound' ? soundB(a, W.clip) : briefB(a);
  else pb.innerHTML = listB();
  if (keep && keep.focus && document.contains(keep)) keep.focus();
  markSel(); placeMargin();
}
let paintFn = null;
function bind(root) {
  paintFn = () => liveB(root);
  root.addEventListener('input', (e) => {
    const t = e.target, k = t.dataset && t.dataset.wbf; if (!k || k === 's:seconds') return;
    patch(t.dataset.ref || (scn({ scene: W.scene }) || {}).ref, setter(k, t.value)); later();
    clearTimeout(bind.pt); bind.pt = setTimeout(paintFn, 350);
  });
  root.addEventListener('change', async (e) => {
    const t = e.target, k = t.dataset && t.dataset.wbf; if (!k) return;
    const ref = t.dataset.ref || (scn({ scene: W.scene }) || {}).ref; if (!ref) return;
    patch(ref, setter(k, t.value));
    await flush();
    if (k === 's:seconds' || (k.startsWith('c:') && k.endsWith(':level'))) { if (W.scene && (W.scene ? W.sub : 'list') === 'brief') rerender(); else { const b = $('#wzb-bud', root); if (b) { const x = budget(sceneArts()); b.className = `wzb-bud ${x.ok ? 'ok' : 'warn'}`; b.innerHTML = `<b aria-hidden="true">${x.ok ? '✓' : '!'}</b> ${esc(x.text)}`; } paintFn(); } } else paintFn();
  });
}

const bad = (e) => { const m = String(e && e.message || e); return /^\d+$/.test(m) ? `Something went wrong (${m}). Try again.` : m; };
const acts = {
  async 'wb-draft'() {
    if (S.busy) return; if (sceneArts().length && !confirm('Write the scenes again? This replaces the scenes I wrote before. Your own edits to them are kept for review.')) return;
    S.busy = true; S.err = ''; rerender();
    try { await flush(); const r = await api(P('/wizard/scenes'), { method: 'POST', body: {} }); toast(`I wrote ${(r.made || []).length} scene brief${(r.made || []).length === 1 ? '' : 's'}. Please review them.`); }
    catch (e) { S.err = `I could not write the scenes: ${bad(e)}`; }
    S.busy = false; return 'refresh';
  },
  async 'wb-add'() {
    const sc = sceneArts(), n = Math.max(0, ...sc.map((a) => a.data.n || 0)) + 1, want = Number(fmtOf().seconds) || 0, used = sc.reduce((s, a) => s + (Number(a.data.seconds) || 0), 0);
    let id = slug(`scene ${n}`); while (get(R.scene(id))) id += '-2';
    try { await api(P('/propose'), { method: 'POST', body: { ref: R.scene(id), parent: REFS.episode, auto_approve: false, rationale: 'A scene you added in the wizard', data: emptyScene(n, { seconds: clampScene(want > used ? want - used : 10, fmtOf()) }) } }); toast(`Scene ${n} added. Open it to write its brief.`); }
    catch (e) { toast(`Could not add the scene: ${bad(e)}`); }
    return 'refresh';
  },
  'wb-ladd'(el) { const r = scn({ scene: W.scene }).ref; return act(r, (d) => { d.transcript = d.transcript || []; d.transcript.push({ id: nextId(d.transcript, 'l'), who: el.dataset.who || '', text: '', en: '', sec: 0 }); return d; }); },
  'wb-lrm'(el) { return act(scn({ scene: W.scene }).ref, (d) => { d.transcript = (d.transcript || []).filter((l) => l.id !== el.dataset.id); return d; }); },
  'wb-cadd'() { return act(scn({ scene: W.scene }).ref, (d) => { d.cues = d.cues || []; d.cues.push({ id: nextId(d.cues, 'c'), name: '', at: (clipSpans(d)[W.clip - 1] || { from: 0 }).from, level: 'mid' }); return d; }); },
  'wb-crm'(el) { return act(scn({ scene: W.scene }).ref, (d) => { d.cues = (d.cues || []).filter((c) => c.id !== el.dataset.id); return d; }); },
  'wb-anchor'(el) { return act(scn({ scene: W.scene }).ref, (d) => { d[el.dataset.w] = { ...(d[el.dataset.w] || {}), mode: el.dataset.v }; return d; }); },
  'wb-join'(el) { return act(scn({ scene: W.scene }).ref, (d) => { const i = +el.dataset.i; d.clips = clipPlan(d.seconds, MAX_CLIP, (d.clips || []).map((c) => c.join)); if (d.clips[i]) d.clips[i].join = el.dataset.v; return d; }); },
  async 'wb-redo'(el) {
    const a = scn({ scene: W.scene }), ins = ($('#wb-instr') || {}).value || ''; if (!a || S.redo) return;
    S.redo = true; el.disabled = true; el.textContent = 'Redoing…';
    try { await flush(); await api(P('/wizard/brief'), { method: 'POST', body: { scene: keyOf(a.ref), instruction: ins } }); toast('I rewrote the brief. Please review it.'); }
    catch (e) { toast(`I could not redo the brief: ${bad(e)}`); }
    S.redo = false; return 'refresh';
  },
};

// The margin card's "Fix it": ask the AI to rewrite the brief (or one note / one line of it) with the person's words.
const redo = async (ref, instruction) => { await flush(); await api(P('/wizard/brief'), { method: 'POST', body: { scene: keyOf(ref), instruction } }); };
registerFix('scene', { run: async (i) => { await redo(i.ref, i.instruction); return 'I rewrote the brief. Please review it.'; } });
registerFix('dir', { run: async (i) => { const k = (i.part || '').replace('note:', ''), l = (NOTE_KEYS.find((n) => n[0] === k) || [k, k])[1]; await redo(i.ref, `Rewrite only the note "${l}"; keep the other notes as they are. ${i.instruction}`); return `I rewrote the brief with a new "${l}" note. Please review it.`; } });
registerFix('line', { run: async (i) => { const id = (i.part || '').replace('line:', ''), l = (((get(i.ref) || {}).data || {}).transcript || []).find((x) => x.id === id); await redo(i.ref, `About the line ${l ? `"${l.text}" (${l.who})` : id}: ${i.instruction} Keep every other line.`); return 'I rewrote the brief with your note on that line. Please review it.'; } });

registerSub('list', { items: () => sceneArts().map((a) => a.ref), html: htmlList, bind, acts });
registerSub('brief', { items: (ctx) => (scn(ctx) ? [scn(ctx).ref] : []), html: htmlBrief, bind });
registerSub('sound', { items: () => [], html: htmlSound, bind });
