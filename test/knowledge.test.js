// The knowledge base format: the rules in docs/knowledge/README.md, checked by scripts/kb-check.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkKb, normalizeUrl, buildIndex } from '../scripts/kb-check.mjs';

const src = (o = {}) => ({ id: 'chr-001', url: 'https://example.com/a', title: 'A page', publisher: 'Example', published: '2026-03', type: 'official-doc', tags: ['character'], models: ['veo-3.1'], claims: ['Accepts up to three reference images of one character.'], quality: 'primary', access: 'full', retrieved: '2026-11-08', notes: '', ...o });
const pra = (o = {}) => ({ id: 'chr-p-001', cluster: 'character-consistency', title: 'T', rule: 'Do the thing.', why: 'Because.', how: 'Like so.', applies_to: ['all'], stage: 'prompt', evidence: ['chr-001'], strength: 'vendor', conflicts: [], monofilm: { status: 'none', where: '', idea: 'build it' }, contributor: 'test', date: '2026-11-08', ...o });
const kb = (sources, practices) => { const root = mkdtempSync(join(tmpdir(), 'kb-')); mkdirSync(join(root, 'sources')); mkdirSync(join(root, 'practices')); writeFileSync(join(root, 'sources', 'chr.jsonl'), sources.map((x) => JSON.stringify(x)).join('\n')); writeFileSync(join(root, 'practices', 'chr.jsonl'), practices.map((x) => JSON.stringify(x)).join('\n')); return root; };

test('a correct source and practice pass, and the index lists the evidence and the open ideas', () => {
  const r = checkKb(kb([src()], [pra()])); assert.deepEqual(r.errors, []); assert.deepEqual([r.stats.sources, r.stats.practices], [1, 1]);
  const idx = buildIndex(r); assert.equal(idx.practices[0].evidenceSources[0].url, 'https://example.com/a'); assert.deepEqual(idx.todo, []); // a vendor-only practice is not yet a candidate
  assert.equal(buildIndex(checkKb(kb([src()], [pra({ strength: 'measured' })]))).todo[0].idea, 'build it');
});
test('the checker names every kind of mistake', () => {
  const bad = (s, p) => checkKb(kb(s, p)).errors.join('\n');
  assert.match(bad([src(), src({ id: 'chr-002', url: 'https://www.example.com/a/?utm_source=x#top' })], []), /duplicate URL/);
  assert.match(bad([src(), src()], []), /duplicate id/);
  assert.match(bad([src({ url: 'http://example.com/x' })], []), /https/);
  assert.match(bad([src({ claims: [] })], []), /1 to 6/); assert.match(bad([src({ claims: ['x'.repeat(300)] })], []), /12 to 240/);
  assert.match(bad([src({ type: 'tweet' })], []), /type must be/); assert.match(bad([src({ retrieved: 'yesterday' })], []), /retrieved/);
  assert.match(bad([src()], [pra({ evidence: ['chr-999'] })]), /not a known source/); assert.match(bad([src()], [pra({ evidence: [] })]), /at least one source/);
  assert.match(bad([src()], [pra({ conflicts: ['chr-p-009'] })]), /not a known practice/); assert.match(bad([src()], [pra({ monofilm: { status: 'maybe' } })]), /monofilm must be/);
  assert.match(bad([src()], [pra({ stage: 'magic' })]), /stage must be/);
});
test('urls compare without www, tracking parameters, a fragment or a trailing slash', () => {
  assert.equal(normalizeUrl('https://WWW.Example.com/a/?utm_medium=x&q=1#h'), 'example.com/a?q=1'); assert.equal(normalizeUrl('nonsense'), null);
});
test('the knowledge base in the repository is valid', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'knowledge'), r = checkKb(root);
  assert.deepEqual(r.errors, []);
});

test('every practice id cited in a playbook page exists', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'knowledge'), r = checkKb(root), have = new Set([...r.practices.map((p) => p.id), ...r.sources.map((x) => x.id)]), dir = join(root, 'playbook');
  const pages = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [], missing = [];
  for (const f of pages) for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/\[([a-z]{2,6}-(?:p-)?\d{3,4})\]/g)) if (!have.has(m[1])) missing.push(`${f}: ${m[1]}`);
  assert.deepEqual(missing, []);
});
