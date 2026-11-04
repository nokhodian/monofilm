// Minimal D1 look-alike over node:sqlite so the store, tools and worker run unchanged in tests.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function makeDb() {
  let queue = Promise.resolve();
  const s = new DatabaseSync(':memory:');
  s.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = s.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    first: async () => s.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: s.prepare(sql).all(...args) }),
  });
  return {
    prepare: (sql) => stmt(sql),
    // one batch at a time, as D1 does; without the queue two overlapping requests would start a transaction inside a transaction
    batch: (list) => { const run = queue.then(async () => { s.exec('BEGIN'); try { const out = []; for (const x of list) out.push(await x.run()); s.exec('COMMIT'); return out; } catch (e) { s.exec('ROLLBACK'); throw e; } }); queue = run.catch(() => {}); return run; },
  };
}
export const human = { id: 'h1', name: 'ann', kind: 'human', role: 'approver' };
export const agent = { id: 'a1', name: 'claude', kind: 'ai', role: 'agent' };
