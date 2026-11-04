// The AI that works the studio, run by Muse Spark. It sees the same tools an MCP client sees (next_work, get_canon, propose, call_tool ...),
// reads the human's feedback, revises, and answers each thread. A human approves what it proposes; this loop can never approve anything.
import { HttpError } from './util.js';
import { spark, outputText, MODELS } from './meta.js';
import { TOOLS } from './mcp.js';

export const AGENT = { id: 'muse-spark', name: 'muse-spark', kind: 'ai', role: 'agent' };
const SYSTEM = `You are the AI director on a film production studio. A human reviews everything you make.
Work in this order: call next_work. For each feedback item, read the thread and the artifact (get_artifact), then revise it with propose and addresses:[comment_id], or reply with comment if you disagree and say why. Fix stale items by re-proposing them. Respect get_canon and run check_continuity or check_cut before you finish. Never repeat work. Keep rationales short and concrete. You cannot approve; say what you changed when you are done.`;

const toolSpec = () => TOOLS.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.inputSchema }));

export async function runAgent(env, db, pid, { goal, maxSteps = 8 } = {}, f) {
  const ctx = { db, env, actor: AGENT, fetch: f || fetch }, steps = [];
  let r = await spark(env, { instructions: SYSTEM, tools: toolSpec(), input: `Production id: ${pid}. ${goal || 'Work through everything waiting for the AI, starting with next_work.'}` }, f);
  for (let i = 0; i < maxSteps; i++) {
    const calls = (r.output || []).filter((x) => x.type === 'function_call');
    if (!calls.length) break;
    const outs = [];
    for (const c of calls) {
      const tool = TOOLS.find((t) => t.name === c.name); let result, ok = true, args = {};
      try { args = JSON.parse(c.arguments || '{}'); if (!tool) throw new Error(`unknown tool ${c.name}`); if (!args.production && tool.inputSchema.required.includes('production')) args.production = pid; result = await tool.run(ctx, args); }
      catch (e) { ok = false; result = { error: e instanceof HttpError ? `${e.status}: ${e.message}` : e.message }; }
      steps.push({ tool: c.name, ok, summary: ok ? summarise(c.name, args) : result.error });
      outs.push({ type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(result).slice(0, 60000) });
    }
    r = await spark(env, { instructions: SYSTEM, tools: toolSpec(), input: outs, previous: r.id }, f);
  }
  return { model: MODELS.spark, steps, text: outputText(r).trim(), finished: !(r.output || []).some((x) => x.type === 'function_call') };
}
const summarise = (name, a) => ({ propose: `proposed ${a.ref}`, comment: `replied on ${a.ref}`, call_tool: `ran ${a.tool} for ${a.ref}`, get_artifact: `read ${a.ref}`, attach_asset: `attached a file to ${a.ref}` }[name] || name);
