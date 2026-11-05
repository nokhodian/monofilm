// Connect an AI agent: how to reach this studio over MCP (the address, the key, ready-to-paste settings) and what an agent can do there.
// The list of tools is asked from the server itself, so it is always what is really there.
import { $, esc, st, api, toast } from './core.js';
import { registerPage } from './w-core.js';

const GROUPS = [
  ['Read the production', ['list_productions', 'next_work', 'get_canon', 'list_artifacts', 'get_artifact', 'get_feedback']],
  ['Write and answer', ['propose', 'comment', 'changes', 'attach_asset']],
  ['Check the work', ['check_continuity', 'check_cut', 'get_stage', 'check_stage', 'stage_input', 'check_adherence']],
  ['Credits and generation tools', ['budget_status', 'request_budget', 'list_tools', 'call_tool']],
  ['Clips, for a video model', ['list_clips', 'get_clip', 'get_media', 'submit_take']],
];
let NEWKEY = '', TOOLS = null;
const part = (L, title, body) => `<section class="part p${L}" aria-labelledby="wh${L}"><header class="ph"><span class="pn">${L}</span><h3 id="wh${L}">${title}</h3></header><div class="pb">${body}</div></section>`;
const short = (t) => { const s = String(t || '').replace(/\s+/g, ' '), i = s.search(/[.:]\s/); return (i > 20 && i < 150 ? s.slice(0, i) : s.slice(0, 140)).replace(/\.$/, ''); };
const code = (text) => `<div class="cncode"><pre>${esc(text)}</pre><button class="bt sm" data-act="wcn-copy" data-text="${esc(text)}">Copy</button></div>`;

async function listTools() { // the tools exactly as an agent would see them
  if (TOOLS) return TOOLS;
  try {
    const r = await fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-mf': '1', ...(st.key ? { authorization: 'Bearer ' + st.key } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    TOOLS = ((await r.json()).result || {}).tools || [];
  } catch { TOOLS = []; }
  return TOOLS;
}

registerPage('connect', {
  title: 'Connect an AI agent',
  async html() {
    const url = `${location.origin}/mcp`, key = NEWKEY || 'YOUR_KEY', tools = await listTools(), by = Object.fromEntries(tools.map((t) => [t.name, t]));
    const known = new Set(GROUPS.flatMap((g) => g[1])), other = tools.filter((t) => !known.has(t.name)).map((t) => t.name);
    const what = (names) => `<table class="crtab">${names.filter((n) => by[n]).map((n) => `<tr><td class="mono">${esc(n)}</td><td>${esc(short(by[n].description))}</td></tr>`).join('')}</table>`;
    const getKey = st.me && st.me.role === 'admin'
      ? `<div class="row"><input id="wcn-name" placeholder="Name, for example claude" aria-label="Name for the agent" style="width:220px"><button class="bt pri" data-act="wcn-make">Make an agent key</button></div>
         ${NEWKEY ? `<p><b>Your new key, shown only once. Copy it now:</b></p>${code(NEWKEY)}` : '<p class="sm mute">The key is shown once and only a scrambled copy is kept. Lose it and you make a new one.</p>'}
         <p class="sm mute">An agent key can work on every production in this studio, not only yours.</p>`
      : '<p class="sm mute">An agent key is made by the person who runs this studio. Ask them for one. It lets an agent work on the studio\'s productions.</p>';
    return `<div class="band"><span class="chapbadge">AI</span><div class="bt1"><div class="prog">For agents and video models</div><h1>Connect an AI agent</h1></div></div>
    <div class="sheet"><div class="wpage">
    ${part('A', 'What this is', '<p>Monofilm speaks MCP, the standard way for an AI program to use a tool. Connect one, for example Claude, and it works on the same story, faces, scenes, stage, pictures and pack that you see here. Anything it makes <b>waits for you</b> in the wizard: an agent can propose and comment, but only a person approves.</p>')}
    ${part('B', 'Get a key', getKey)}
    ${part('C', 'Connect', `<span class="lbl">The address</span>${code(url)}<span class="lbl">Claude Code</span>${code(`claude mcp add --transport http monofilm ${url} --header "Authorization: Bearer ${key}"`)}
      <span class="lbl">Other MCP programs (settings file)</span>${code(JSON.stringify({ mcpServers: { monofilm: { type: 'http', url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2))}
      <span class="lbl">Check it works</span>${code(`curl -s ${url} -H "Authorization: Bearer ${key}" -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`)}
      <p class="sm mute"><b>If you get "403" or "error code: 1010":</b> Cloudflare turns away requests that carry no User-Agent or a script default one (such as Python's <span class="mono">Python-urllib</span>) before they reach Monofilm. Send any User-Agent of your own, for example <span class="mono">User-Agent: monofilm-agent/1</span>. MCP programs such as Claude Code already send one. The same applies to picture links (<span class="mono">/api/p/…/media/…</span>).</p>
      <p class="sm mute">Start the agent with the tool <span class="mono">next_work</span>. It lists what is waiting: notes you sent back, out-of-date items, then the next missing piece.</p>`)}
    ${part('D', 'What an agent can do', tools.length ? GROUPS.map(([t, n]) => (n.some((x) => by[x]) ? `<span class="lbl">${esc(t)}</span>${what(n)}` : '')).join('') + (other.length ? `<span class="lbl">More</span>${what(other)}` : '') : '<p class="sm mute">The list could not be loaded just now. Reload the page.</p>')}
    ${part('E', 'Export and everything else', '<p>The finished project (every picture, the prompts, the stage controls and the transcript in one zip) is the <b>Download</b> on the Ship page, and a button in the Roll camera box. That download is made in your browser, so an agent does not call it. It gets the same material piece by piece: <span class="mono">get_canon</span> for the story and the look, <span class="mono">list_clips</span> and <span class="mono">get_clip</span> for each clip\'s prompt, start and end pictures and stage controls, and <span class="mono">get_media</span> for the pictures. A video model brings its result back with <span class="mono">submit_take</span>, and the take waits for you on the Pack page.</p>')}
    </div></div>`;
  },
  acts: {
    async 'wcn-make'() { const name = ($('#wcn-name') || {}).value.trim() || 'agent'; const r = await api('/actors', { method: 'POST', body: { name, kind: 'ai', role: 'agent' } }); NEWKEY = r.token; toast('Key made. Copy it now: it is shown only once.'); return 'render'; },
    async 'wcn-copy'(el) { try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied.'); } catch { toast('Select the text and copy it.'); } },
  },
});
