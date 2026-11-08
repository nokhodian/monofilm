// Checks the knowledge base in docs/knowledge and (with --build) writes docs/knowledge/index.json.
//   node scripts/kb-check.mjs            validate and print the counts
//   node scripts/kb-check.mjs --build    validate, then write index.json
// The rules are in docs/knowledge/README.md.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_TYPES = ['official-doc', 'paper', 'repo', 'tutorial', 'blog', 'forum', 'video', 'case-study', 'dataset', 'news', 'spec'];
const QUALITY = ['primary', 'secondary', 'anecdotal'];
const ACCESS = ['full', 'partial', 'abstract', 'search-summary'];
const STRENGTH = ['measured', 'multi-source', 'single-source', 'vendor', 'anecdotal'];
const STAGES = ['plan', 'picture', 'prompt', 'generation', 'review', 'assembly', 'audio', 'policy'];
const STATUS = ['none', 'partial', 'done'];
const DATE = /^\d{4}-\d{2}-\d{2}$/, PUBLISHED = /^(\d{4}(-\d{2}(-\d{2})?)?)?$/;
const SOURCE_ID = /^[a-z]{2,6}-\d{3,4}$/, PRACTICE_ID = /^[a-z]{2,6}-p-\d{3,4}$/;
const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_|source$|si$)/i;

export function normalizeUrl(u) {
  try {
    const x = new URL(u); x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (TRACKING.test(k)) x.searchParams.delete(k);
    const host = x.hostname.toLowerCase().replace(/^www\./, ''), path = x.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}${x.search}`;
  } catch { return null; }
}

const lines = (file) => readFileSync(file, 'utf8').split('\n').map((t, i) => ({ t: t.trim(), n: i + 1 })).filter((x) => x.t);
const files = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().map((f) => join(dir, f)) : []);
const str = (v) => typeof v === 'string' && v.trim().length > 0;
const arr = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

// root = the docs/knowledge folder. Returns { errors, sources, practices, stats }.
export function checkKb(root) {
  const errors = [], sources = [], practices = [], err = (f, n, m) => errors.push(`${f.replace(root + '/', '')}:${n} ${m}`);
  const ids = new Set(), urls = new Map();
  for (const f of files(join(root, 'sources'))) for (const { t, n } of lines(f)) {
    let s; try { s = JSON.parse(t); } catch { err(f, n, 'not valid JSON'); continue; }
    const bad = (m) => err(f, n, `${s.id || '?'}: ${m}`);
    if (!SOURCE_ID.test(s.id || '')) bad('id must look like chr-001'); else if (ids.has(s.id)) bad('duplicate id'); else ids.add(s.id);
    const nu = normalizeUrl(s.url || ''); if (!/^https:\/\//.test(s.url || '') || !nu) bad('url must be a valid https URL'); else if (urls.has(nu)) bad(`duplicate URL (also ${urls.get(nu)})`); else urls.set(nu, s.id);
    if (!str(s.title)) bad('title is required'); if (!str(s.publisher)) bad('publisher is required');
    if (!PUBLISHED.test(s.published ?? '')) bad('published must be YYYY, YYYY-MM, YYYY-MM-DD or empty');
    if (!SOURCE_TYPES.includes(s.type)) bad(`type must be one of ${SOURCE_TYPES.join(', ')}`);
    if (!arr(s.tags)) bad('tags must be a list of strings'); if (!arr(s.models)) bad('models must be a list of strings');
    if (!arr(s.claims) || s.claims.length < 1 || s.claims.length > 6) bad('claims must be 1 to 6 strings'); else if (s.claims.some((c) => c.length > 240 || c.length < 12)) bad('each claim must be 12 to 240 characters');
    if (!QUALITY.includes(s.quality)) bad(`quality must be one of ${QUALITY.join(', ')}`);
    if (!ACCESS.includes(s.access)) bad(`access must be one of ${ACCESS.join(', ')}`);
    if (!DATE.test(s.retrieved || '')) bad('retrieved must be YYYY-MM-DD');
    sources.push({ ...s, _file: f });
  }
  const pids = new Set();
  for (const f of files(join(root, 'practices'))) for (const { t, n } of lines(f)) {
    let p; try { p = JSON.parse(t); } catch { err(f, n, 'not valid JSON'); continue; }
    const bad = (m) => err(f, n, `${p.id || '?'}: ${m}`);
    if (!PRACTICE_ID.test(p.id || '')) bad('id must look like chr-p-001'); else if (pids.has(p.id)) bad('duplicate id'); else pids.add(p.id);
    for (const k of ['cluster', 'title', 'rule', 'why', 'how', 'contributor']) if (!str(p[k])) bad(`${k} is required`);
    if (str(p.rule) && p.rule.length > 400) bad('rule must be one sentence of at most 400 characters');
    if (!arr(p.applies_to) || !p.applies_to.length) bad('applies_to must be a non-empty list');
    if (!STAGES.includes(p.stage)) bad(`stage must be one of ${STAGES.join(', ')}`);
    if (!arr(p.evidence) || !p.evidence.length) bad('evidence must list at least one source id');
    if (!STRENGTH.includes(p.strength)) bad(`strength must be one of ${STRENGTH.join(', ')}`);
    if (!arr(p.conflicts)) bad('conflicts must be a list');
    if (!p.monofilm || !STATUS.includes(p.monofilm.status) || typeof p.monofilm.where !== 'string' || typeof p.monofilm.idea !== 'string') bad('monofilm must be {status, where, idea}');
    if (!DATE.test(p.date || '')) bad('date must be YYYY-MM-DD');
    practices.push({ ...p, _file: f, _line: n });
  }
  for (const p of practices) {
    for (const e of p.evidence || []) if (!ids.has(e)) errors.push(`${p._file.replace(root + '/', '')}:${p._line} ${p.id}: evidence ${e} is not a known source`);
    for (const c of p.conflicts || []) if (!pids.has(c)) errors.push(`${p._file.replace(root + '/', '')}:${p._line} ${p.id}: conflicts ${c} is not a known practice`);
  }
  const by = (list, k) => list.reduce((o, x) => ((o[x[k]] = (o[x[k]] || 0) + 1), o), {});
  const stats = { sources: sources.length, practices: practices.length, sourcesByType: by(sources, 'type'), sourcesByAccess: by(sources, 'access'), practicesByStage: by(practices, 'stage'), practicesByStatus: by(practices.map((p) => ({ s: p.monofilm && p.monofilm.status })), 's') };
  return { errors, sources, practices, stats };
}

export function buildIndex({ sources, practices }) {
  const strip = ({ _file, _line, ...x }) => x, srcs = sources.map(strip), byId = Object.fromEntries(srcs.map((s) => [s.id, s]));
  const prs = practices.map(strip).map((p) => ({ ...p, evidenceSources: p.evidence.map((e) => ({ id: e, url: byId[e].url, title: byId[e].title, quality: byId[e].quality })) }));
  const stages = {}; for (const p of prs) (stages[p.stage] = stages[p.stage] || []).push(p.id);
  const todo = prs.filter((p) => p.monofilm.status === 'none' && ['measured', 'multi-source'].includes(p.strength)).map((p) => ({ id: p.id, title: p.title, idea: p.monofilm.idea }));
  return { generated: new Date().toISOString().slice(0, 10), counts: { sources: srcs.length, practices: prs.length }, stages, todo, practices: prs, sources: srcs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'knowledge'), r = checkKb(root);
  if (r.errors.length) { console.error(`${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}:\n` + r.errors.slice(0, 60).join('\n') + (r.errors.length > 60 ? `\n... and ${r.errors.length - 60} more` : '')); process.exit(1); }
  console.log(JSON.stringify(r.stats, null, 2));
  if (process.argv.includes('--build')) { writeFileSync(join(root, 'index.json'), JSON.stringify(buildIndex(r), null, 1)); console.log('wrote docs/knowledge/index.json'); }
}
