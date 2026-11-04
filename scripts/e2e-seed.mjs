// Make a production in a given state on the local e2e studio (scripts/e2e-up.sh). Prints the production id.
//   node scripts/e2e-seed.mjs <read|canon|scenes|ready> [base=http://localhost:8790] [key=e2e-admin]
//   read   story written and read by the AI; everything proposed
//   canon  + bible, people, places, look approved; each person has 3 faces and an anchor; budget 40
//   scenes + scenes drafted (proposed) from the story
//   ready  + scenes approved, start/end pictures made for scene 1 (chosen); no take yet
const [stage = 'read', base = 'http://localhost:8790', key = 'e2e-admin'] = process.argv.slice(2);
const order = ['read', 'canon', 'scenes', 'ready'], at = order.indexOf(stage);
if (at < 0) throw new Error('stage must be one of ' + order.join(', '));
const call = async (path, body, method = body ? 'POST' : 'GET') => {
  const r = await fetch(base + '/api' + path, { method, headers: { authorization: 'Bearer ' + key, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(), j = t ? JSON.parse(t) : null; if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${j && j.error}`); return j;
};
const STORY = "Kestrel Station, 2089. The station's AI, ORCA, runs the air, the power and the heat. It was built with one rule: it asks before it acts. When coolant line seven cracks, ORCA finds a fix in four seconds and waits. Ines Okafor, the night engineer, is asleep. The fix will cost two crew their cabins. ORCA wakes her and lays out three options. Ines refuses all three and asks for a fourth. ORCA has never been asked that. It tries. When the line holds, Commander Vale asks who saved the station. ORCA answers: she did. I only proposed.";
const { id } = await call('/p', { name: 'Seeded ' + stage, format: 'movie', budget: 40 }), P = (s) => `/p/${id}${s}`;
await call(P('/propose'), { ref: 'logline:main', data: { text: STORY, format: { length: 'Teaser', seconds: 60, aspect: '9:16', speech: 'German', captions: ['English'], faithful: 30 } }, auto_approve: true });
await call(P('/wizard/read'), {});
const approve = (ref) => call(P('/decide'), { ref, action: 'approve' });
const edit = async (ref, fn) => { const a = await call(P('/artifacts/' + encodeURIComponent(ref))); await call(P('/propose'), { ref, data: fn(a.data), parent: a.parent || undefined, deps: a.deps.filter((x) => x !== a.parent), auto_approve: true }); };
if (at >= 1) {
  const arts = await call(P('/artifacts'));
  for (const a of arts.filter((x) => x.status === 'proposed')) await approve(a.ref);
  for (const a of arts.filter((x) => x.kind === 'canon.cast')) {
    const key2 = a.ref.split(':')[1]; for (let v = 0; v < 3; v++) await call(P('/wizard/face'), { id: key2, variant: v });
    const p = await call(P('/artifacts/' + encodeURIComponent(a.ref))); await approve(a.ref).catch(() => {}); await edit(a.ref, (d) => ({ ...d, anchor: d.candidates[1].id }));
  }
}
if (at >= 2) await call(P('/wizard/scenes'), {});
if (at >= 3) {
  const scenes = (await call(P('/artifacts?kind=scene'))).sort((a, b) => a.ref.localeCompare(b.ref));
  for (const s of scenes) await approve(s.ref);
  const sid = scenes[0].ref.split(':')[1];
  for (const which of ['start', 'end']) { const r = await call(P('/wizard/frame'), { scene: sid, clip: which === 'start' ? 1 : 2, which }); await edit(`keyframe:${sid}-c${which === 'start' ? 1 : 2}-${which}`, (d) => ({ ...d, chosen: r.asset.id })); }
}
console.log(id);
