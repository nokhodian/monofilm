// The script as a page you can read and mark up: a comment on any line, edits in place, or paste your own draft.
import { $, esc, st, api, P, toast, chip, tag, isHuman, saveText } from './core.js';
import { ofKind, get, createArtifact, editArtifact, episodeRef, threads } from './data.js';
import { composer, threadHtml } from './feedback.js';

// Fountain-ish draft to lines: "INT. PLACE - NIGHT" headings, "NAME: text" or NAME on its own line over the speech, everything else is action.
export function parseDraft(text) {
  const raw = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), out = []; let i = 0, m;
  while (i < raw.length && out.length < 800) {
    const l = raw[i];
    if (/^(INT|EXT|INT\.?\/EXT|I\/E)[./\s]/i.test(l)) { out.push({ k: 'slug', t: l.toUpperCase() }); i++; continue; }
    if ((m = l.match(/^([A-Za-zÀ-ſ][A-Za-zÀ-ſ .'-]{0,22}):\s*(.+)$/))) { out.push({ k: 'dial', who: m[1].toUpperCase(), t: m[2].replace(/^["“]|["”]$/g, '') }); i++; continue; }
    if (/^[A-ZÀ-Þ][A-ZÀ-Þ .'-]{1,22}$/.test(l) && raw[i + 1] && !/^(INT|EXT)/i.test(raw[i + 1])) { out.push({ k: 'dial', who: l, t: raw[i + 1] }); i += 2; continue; }
    out.push({ k: 'act', t: l }); i++;
  }
  return out;
}
const linesOf = (s) => s.data.lines || parseDraft(s.data.text || '');
const key = (ref) => ref.slice(ref.indexOf(':') + 1);

export function vScript(arg) {
  const list = ofKind('script'), cur = list.find((s) => key(s.ref) === arg) || list[0], ed = isHuman();
  const picker = `<div class="row">${list.map((s) => `<a class="vd" style="text-decoration:none" href="#/script/${esc(key(s.ref))}" aria-pressed="${cur && s.ref === cur.ref}">${esc(s.data.title || key(s.ref))}</a>`).join('')}</div>`;
  const add = ed ? `<details class="card"${cur ? '' : ' open'}><summary><b>Add a draft</b> <span class="mute small">paste text or choose a .txt, .md or .fountain file</span></summary><label class="k">Name</label><input id="sctitle" placeholder="Episode 1" style="max-width:320px"><textarea id="sctext" placeholder="INT. CATHEDRAL - NIGHT&#10;ORCA: I will not act without you."></textarea><div class="row"><input type="file" id="scfile" accept=".txt,.md,.fountain,text/plain" style="max-width:300px"><button class="btn pri sm" data-act="scadd">Add as a script</button></div></details>` : '';
  if (!cur) return `<h1>Script</h1><p class="mute">The script, line by line. Comment on any line or edit it in place.</p>${add}<div class="empty">No script yet. The AI proposes one as <code>script:&lt;episode&gt;</code>, or add your own draft above.</div>`;
  const ls = linesOf(cur), byLine = {}; threads(cur.ref).forEach((c) => { const m = /line:(\d+)/.exec(c.anchor || ''); if (m) (byLine[m[1]] ||= []).push(c); });
  const gen = threads(cur.ref).filter((c) => !/line:\d+/.test(c.anchor || ''));
  return `<h1>Script</h1>${picker}${add}<div class="row"><h2 style="margin:0;color:var(--ink)">${esc(cur.data.title || key(cur.ref))}</h2>${chip(cur)}<span class="mute">v${cur.version} · ${esc(cur.author)}</span><span class="sp"></span><button class="btn sm" data-act="scdl" data-ref="${esc(cur.ref)}">Download as text</button></div>
  <div class="page">${ls.map((l, n) => `<div class="sl ${l.k}" id="sl-${n}"><div class="slt" data-n="${n}">${l.k === 'dial' ? `<b>${esc(l.who || '')}</b><span>${esc(l.t)}</span>` : l.k === 'slug' ? `<b>${esc(l.t)}</b>` : `<span>${esc(l.t)}</span>`}</div>
    <div class="slc">${(byLine[n] || []).length ? `<span class="tag fbk">${byLine[n].filter((c) => c.status === 'open').length || byLine[n].length}</span>` : ''}<button class="btn sm" data-act="scdisc" data-n="${n}">Comment</button>${ed ? `<button class="btn sm" data-act="scedit" data-n="${n}" data-ref="${esc(cur.ref)}">Edit</button>` : ''}</div>
    <div class="sld" id="sld-${n}" ${(byLine[n] || []).length ? '' : 'hidden'}>${(byLine[n] || []).map(threadHtml).join('')}${composer(cur.ref, { anchor: `line:${n}`, placeholder: 'What should change in this line?', draw: false })}</div></div>`).join('')}</div>
  <h2>Feedback on the whole script</h2>${gen.map(threadHtml).join('')}${composer(cur.ref, { anchor: 'script', placeholder: 'Pace, structure, what is missing…', draw: false })}`;
}
const toText = (ls) => ls.map((l) => (l.k === 'slug' ? `\n${l.t}\n` : l.k === 'dial' ? `${l.who}: ${l.t}` : l.t)).join('\n');
export const acts = {
  scdisc: (el) => { const b = $(`#sld-${el.dataset.n}`); b.hidden = !b.hidden; },
  async scadd() {
    let text = $('#sctext').value.trim(); const f = $('#scfile').files[0]; if (f) text = await f.text(); if (!text) return toast('Paste a draft or choose a file');
    const lines = parseDraft(text); if (lines.length < 3) return toast('Could not read three lines from that draft');
    const title = $('#sctitle').value.trim() || (f ? f.name.replace(/\.[^.]+$/, '') : 'Draft'), k = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'draft';
    await createArtifact(`script:${k}`, { title, lines }, { parent: episodeRef(), why: 'Draft added by a human' }); toast(`Added ${lines.length} lines`); location.hash = `#/script/${k}`; return 'refresh';
  },
  async scedit(el) {
    const n = Number(el.dataset.n), s = get(el.dataset.ref), l = linesOf(s)[n], t = prompt('Edit this line', l.t); if (t === null || t.trim() === l.t) return;
    await editArtifact(el.dataset.ref, (d) => { d.lines = d.lines || parseDraft(d.text || ''); d.lines[n].t = t.trim(); delete d.text; return d; }, `Rewrote line ${n + 1}`); toast('Saved as your version'); return 'refresh';
  },
  scdl: (el) => { const s = get(el.dataset.ref); saveText(`${key(s.ref)}.fountain`, toText(linesOf(s))); },
};
