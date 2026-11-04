// Sound cue sheet (ambience, effects, music) and captions with timing. Both are lists you can edit, listen to and comment on.
import { $, esc, st, api, P, toast, chip, tag, isHuman, saveText, mediaSrc } from './core.js';
import { ofKind, get, createArtifact, editArtifact, episodeRef, cuts, lines, lineSeconds, openCount } from './data.js';
import { threadsHtml } from './feedback.js';

const key = (ref) => ref.slice(ref.indexOf(':') + 1);
const audio = (a) => (a.assets || []).find((x) => (x.mime || '').startsWith('audio/'));
const src = (a) => { const x = audio(a); return x ? (x.uri.startsWith('audio/') ? '/' + x.uri : mediaSrc(x.uri)) : ''; };

// ---------- sound ----------
export function vSound() {
  const scenes = ofKind('scene').filter((s) => s.data.heading), cues = [...ofKind('sfx'), ...ofKind('music')], ed = isHuman();
  const of = (parent) => cues.filter((c) => c.parent === parent);
  const row = (c) => `<tr><td>${tag(c.kind)}</td><td><b>${esc(c.data.label || key(c.ref))}</b>${c.data.muted ? ' ' + tag('muted', 'warn') : ''}<div class="mute small">${chip(c)} ${esc(c.author)}</div></td><td>${c.data.at ?? ''}${c.data.at !== undefined ? ' s' : ''}</td><td>${c.data.seconds ?? ''}${c.data.seconds !== undefined ? ' s' : ''}</td><td>${c.data.level ?? ''}</td><td>${src(c) ? `<audio controls preload="none" src="${esc(src(c))}"></audio>` : '<span class="mute small">no file</span>'}</td><td class="row">${ed ? `<button class="btn sm" data-act="cuemute" data-ref="${esc(c.ref)}">${c.data.muted ? 'Unmute' : 'Mute'}</button><button class="btn sm" data-act="cueedit" data-ref="${esc(c.ref)}">Edit</button>` : ''}<button class="btn sm" data-act="cuedisc" data-ref="${esc(c.ref)}">Discuss${openCount(c.ref) ? ` (${openCount(c.ref)})` : ''}</button></td></tr><tr id="cd-${esc(c.ref)}" hidden><td colspan="7">${threadsHtml(c.ref)}</td></tr>`;
  const add = (parent, kind) => ed ? `<div class="row" style="margin:6px 0"><input data-cue="label" placeholder="${kind === 'music' ? 'Music: what and where' : 'Effect or ambience'}" style="max-width:260px"><input data-cue="at" type="number" step="0.5" placeholder="starts (s)" style="width:100px"><input data-cue="seconds" type="number" step="0.5" placeholder="length (s)" style="width:100px"><input data-cue="level" type="number" min="0" max="100" placeholder="level" style="width:80px"><input data-cue="file" type="file" accept="audio/*" style="max-width:220px"><button class="btn sm" data-act="cueadd" data-parent="${esc(parent)}" data-kind="${kind}">Add ${kind}</button></div>` : '';
  return `<h1>Sound</h1><p class="mute">Effects and ambience for each shot, and music for each scene. Edit the timing and level, mute a cue, or comment on it. The AI produces and revises the files.</p>${scenes.map((sc) => {
    const shots = ofKind('shot').filter((x) => x.parent === sc.ref && x.data.title), mus = of(sc.ref);
    return `<section class="card"><h2 style="margin:0 0 6px;color:var(--ink)">${esc(sc.data.heading)}</h2><div class="mute small">Scene music</div>${mus.length ? `<table>${mus.map(row).join('')}</table>` : '<span class="mute small">none yet</span>'}${add(sc.ref, 'music')}
    ${shots.map((sh) => { const fx = of(sh.ref); return fx.length || ed ? `<details${fx.length ? ' open' : ''}><summary><b>${esc(key(sh.ref))}</b> ${esc(sh.data.title)} <span class="mute small">${fx.length} cue${fx.length === 1 ? '' : 's'}</span></summary>${fx.length ? `<table>${fx.map(row).join('')}</table>` : ''}${add(sh.ref, 'sfx')}</details>` : ''; }).join('')}</section>`;
  }).join('') || '<div class="empty">No scenes yet.</div>'}`;
}

// ---------- captions ----------
const tc = (s, sep = ',') => { const ms = Math.round(s * 1000), p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`; };
export const srt = (cues) => cues.map((c, i) => `${i + 1}\n${tc(c.start)} --> ${tc(c.end)}\n${c.text}\n`).join('\n');
export const vtt = (cues) => `WEBVTT\n\n${cues.map((c) => `${tc(c.start, '.')} --> ${tc(c.end, '.')}\n${c.text}\n`).join('\n')}`;
// Timing from the recommended cut: each spoken line starts where its shot starts and lasts as long as it takes to say.
export function draftCues(order, lang) {
  const out = []; let at = 0;
  for (const o of order) { let t = at; for (const l of lines(o.id)) { if (l.data.role === 'CARD') { out.push({ start: at, end: at + Math.min(o.seconds, 2.5), text: l.data.de || '' }); continue; } const d = Math.max(0.8, lineSeconds(l.data)), text = lang === 'en' ? (l.data.en || l.data.de || '') : (l.data.de || l.data.en || ''); out.push({ start: Math.round(t * 100) / 100, end: Math.round((t + d) * 100) / 100, text: `${l.data.speaker ? l.data.speaker + ': ' : ''}${text}` }); t += d + 0.15; } at += o.seconds; }
  return out;
}
export function vCaptions(arg) {
  const list = ofKind('captions'), cur = list.find((c) => key(c.ref) === arg) || list[0], ed = isHuman(), rec = cuts()[0];
  const newBox = ed ? `<details class="card"${cur ? '' : ' open'}><summary><b>Start a language</b> <span class="mute small">timing is drafted from the recommended storyline${rec ? ` (${esc(rec.data.name)})` : ''}</span></summary><div class="row"><input id="cplang" placeholder="Language code, e.g. en or de" style="max-width:240px" value="en"><button class="btn pri sm" data-act="capdraft">Draft from dialogue</button></div></details>` : '';
  if (!cur) return `<h1>Captions</h1><p class="mute">Subtitles for each language with their timing.</p>${newBox}<div class="empty">No captions yet. The AI proposes them as <code>captions:&lt;language&gt;</code>, or draft them above.</div>`;
  const cs = cur.data.cues || [];
  return `<h1>Captions</h1><div class="row">${list.map((c) => `<a class="vd" style="text-decoration:none" href="#/captions/${esc(key(c.ref))}" aria-pressed="${c.ref === cur.ref}">${esc(c.data.language || key(c.ref))}</a>`).join('')}</div>${newBox}
  <div class="row"><h2 style="margin:0;color:var(--ink)">${esc(cur.data.language || key(cur.ref))}</h2>${chip(cur)}<span class="mute">v${cur.version} · ${esc(cur.author)} · ${cs.length} captions</span><span class="sp"></span><button class="btn sm" data-act="capdl" data-f="srt">Download SRT</button><button class="btn sm" data-act="capdl" data-f="vtt">Download VTT</button></div>
  <table class="capt"><tr><th>#</th><th>Start</th><th>End</th><th>Text</th><th></th></tr>${cs.map((c, i) => `<tr><td>${i + 1}</td><td><input type="number" step="0.1" data-cap="${i}.start" value="${c.start}" ${ed ? '' : 'disabled'}></td><td><input type="number" step="0.1" data-cap="${i}.end" value="${c.end}" ${ed ? '' : 'disabled'}></td><td><input data-cap="${i}.text" value="${esc(c.text)}" ${ed ? '' : 'disabled'}></td><td class="row">${ed ? `<button class="btn sm no" data-act="capdel" data-i="${i}">×</button>` : ''}</td></tr>`).join('')}</table>
  ${ed ? `<div class="row"><button class="btn sm" data-act="capadd">Add a caption</button><button class="btn pri" data-act="capsave">Save my version</button></div>` : ''}<h2>Feedback</h2><p class="mute small">Comment at a moment: write the time in the note, for example "at 12.5 s the line is cut off".</p>${threadsHtml(cur.ref, { composerOpts: { anchor: 'captions' } })}`;
}
const edit = () => { const cur = document.querySelector('.capt'); const cs = []; cur.querySelectorAll('tr').forEach((tr, i) => { if (!i) return; const g = (k) => tr.querySelector(`[data-cap$=".${k}"]`); cs.push({ start: Number(g('start').value), end: Number(g('end').value), text: g('text').value }); }); return cs; };
const curRef = () => { const a = location.hash.split('/')[2]; const list = ofKind('captions'); return (list.find((c) => key(c.ref) === a) || list[0]).ref; };

export const acts = {
  cuedisc: (el) => { const r = document.getElementById(`cd-${el.dataset.ref}`); r.hidden = !r.hidden; },
  async cueadd(el) {
    const box = el.parentElement, v = (k) => box.querySelector(`[data-cue=${k}]`), label = v('label').value.trim(); if (!label) return toast('Describe the cue first');
    const k = `${Date.now().toString(36)}`, ref = `${el.dataset.kind}:${k}`;
    await createArtifact(ref, { label, at: Number(v('at').value) || 0, seconds: Number(v('seconds').value) || undefined, level: Number(v('level').value) || 70 }, { parent: el.dataset.parent, why: 'Cue added by a human' });
    const f = v('file').files[0]; if (f) { const name = `cue-${k}.${(f.name.split('.').pop() || 'mp3').toLowerCase()}`, r = await fetch(`/api/p/${st.pid}/media/${name}`, { method: 'PUT', headers: { authorization: 'Bearer ' + st.key, 'content-type': f.type || 'audio/mpeg' }, body: f }); if (r.ok) await api(P('/assets'), { method: 'POST', body: { ref, uri: `media/${st.pid}/${name}`, mime: f.type || 'audio/mpeg', bytes: f.size, provenance: { uploaded_by: st.me.name } } }); }
    toast('Cue added'); return 'refresh';
  },
  cuemute: async (el) => { await editArtifact(el.dataset.ref, (d) => { d.muted = !d.muted; return d; }, 'Toggled mute'); return 'refresh'; },
  async cueedit(el) { const c = get(el.dataset.ref), t = prompt('Label, start s, length s, level (comma separated)', [c.data.label, c.data.at ?? 0, c.data.seconds ?? '', c.data.level ?? 70].join(', ')); if (t === null) return; const [label, at, seconds, level] = t.split(',').map((x) => x.trim()); await editArtifact(el.dataset.ref, (d) => ({ ...d, label, at: Number(at) || 0, seconds: Number(seconds) || undefined, level: Number(level) || 70 }), 'Edited the cue'); return 'refresh'; },
  async capdraft() {
    const lang = ($('#cplang').value.trim() || 'en').toLowerCase(), rec = cuts()[0]; if (!rec) return toast('There is no storyline to time against yet');
    const cues = draftCues(rec.data.order || [], lang), ref = `captions:${lang}`;
    if (get(ref)) await editArtifact(ref, (d) => ({ ...d, language: lang, cues }), 'Redrafted from dialogue'); else await createArtifact(ref, { language: lang, cues, from_cut: rec.ref }, { parent: episodeRef(), why: 'Drafted from the dialogue timing' });
    toast(`Drafted ${cues.length} captions`); location.hash = `#/captions/${lang}`; return 'refresh';
  },
  async capsave() { await editArtifact(curRef(), (d) => ({ ...d, cues: edit().filter((c) => c.text) }), 'Edited the captions'); toast('Saved as your version'); return 'refresh'; },
  async capadd() { const cs = edit(), last = cs[cs.length - 1]; cs.push({ start: last ? last.end : 0, end: (last ? last.end : 0) + 2, text: '' }); await editArtifact(curRef(), (d) => ({ ...d, cues: cs }), 'Added a caption'); return 'refresh'; },
  async capdel(el) { const cs = edit(); cs.splice(Number(el.dataset.i), 1); await editArtifact(curRef(), (d) => ({ ...d, cues: cs }), 'Removed a caption'); return 'refresh'; },
  capdl: (el) => { const c = get(curRef()), cs = c.data.cues || []; saveText(`${c.data.language || 'captions'}.${el.dataset.f}`, el.dataset.f === 'srt' ? srt(cs) : vtt(cs), 'text/plain'); },
};
