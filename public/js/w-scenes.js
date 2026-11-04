// Step 6, Scenes. This file only routes: the scene list and each sub-page register themselves with registerSub(), each in its own file.
//   registerSub(sub, { items?(ctx), html(ctx), bind?(root, ctx), acts? })   sub is 'list' (the overview, no scene open) or one of SUBS: brief, stage, pictures, sound, pack.
//   ctx = { step:'scenes', scene:'<scene id>' | null, sub, d, get, ofKind }. The open scene's artifact is get(R.scene(ctx.scene)).
import { registerStep, wzActs } from './w-core.js';
const SUB = {};
export const registerSub = (sub, def) => { SUB[sub] = def; if (def.acts) Object.assign(wzActs, def.acts); };
const key = (ctx) => (ctx.scene ? ctx.sub : 'list');
const todo = (ctx) => `<div class="wempty"><b>${key(ctx) === 'list' ? 'The scene list' : 'This page'} is still being built.</b></div>`;
registerStep('scenes', {
  items: (ctx) => (SUB[key(ctx)] && SUB[key(ctx)].items ? SUB[key(ctx)].items(ctx) : []),
  html: (ctx) => (SUB[key(ctx)] ? SUB[key(ctx)].html(ctx) : todo(ctx)),
  bind: (root, ctx) => { const s = SUB[key(ctx)]; if (s && s.bind) s.bind(root, ctx); },
});
