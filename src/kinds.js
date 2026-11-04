// What a production is made of. An artifact's kind fixes where it sits in the tree (parent kind) and the pipeline order.
export const KINDS = {
  logline: { parent: null }, bible: { parent: null }, reference: { parent: null },
  'canon.style': { parent: null }, 'canon.world': { parent: null }, 'canon.cast': { parent: null }, 'canon.voice': { parent: null },
  episode: { parent: null }, script: { parent: 'episode' }, scene: { parent: 'episode' }, stage: { parent: 'scene' }, shot: { parent: 'scene' },
  keyframe: { parent: 'shot' }, take: { parent: 'shot' }, dialogue: { parent: 'shot' }, sfx: { parent: 'shot' }, music: { parent: 'scene' },
  cut: { parent: 'episode' }, grade: { parent: 'episode' }, captions: { parent: 'episode' }, export: { parent: 'episode' },
};
export const PIPELINE = ['logline', 'bible', 'reference', 'canon.style', 'canon.world', 'canon.cast', 'canon.voice', 'episode', 'script', 'scene', 'stage', 'shot', 'keyframe', 'take', 'dialogue', 'sfx', 'music', 'cut', 'grade', 'captions', 'export'];
// A proposal of this kind must list (or have as parent) at least one approved artifact of each kind named here.
// This is what makes canon changes propagate, and it keeps video behind approved images.
export const REQUIRES = { shot: ['canon.style'], keyframe: ['canon.style'], take: ['keyframe', 'canon.style'] };
export const isCanon =(kind) => kind.startsWith('canon.');
export const TOOL_KINDS = ['image', 'video', 'voice', 'lipsync', 'music', 'sfx', 'edit', 'render'];
export const TRANSPORTS = ['http', 'mcp', 'mock', 'meta-image'];
export const DONE = new Set(['approved', 'locked']);
export const FORMATS = ['movie', 'series'];
export const VERDICTS = ['keep', 'change', 'cut', 'question', 'hold', 'continuity', 'anachronism'];
export const NEEDS_NOTE = ['continuity', 'anachronism']; // a risk flag is useless without saying what is wrong

export const REF_RE = /^([a-z]+(?:\.[a-z]+)?):([A-Za-z0-9._-]{1,64})$/;
export function parseRef(ref) {
  const m = typeof ref === 'string' && REF_RE.exec(ref);
  if (!m || !KINDS[m[1]]) return null;
  return { kind: m[1], key: m[2] };
}

// Role -> what it may do. Humans decide; agents propose; admins manage actors, tools and budgets.
const CAN = {
  admin: ['read', 'propose', 'comment', 'decide', 'budget', 'manage'],
  approver: ['read', 'propose', 'comment', 'decide', 'budget'],
  agent: ['read', 'propose', 'comment', 'request_budget', 'call_tool'],
  // A signed-up person: works their own productions, decides on their own work, but cannot grant credits or manage tools and people.
  member: ['read', 'propose', 'comment', 'decide', 'request_budget', 'call_tool'],
  viewer: ['read'],
};
export const can = (actor, action) => (CAN[actor.role] || []).includes(action) || (action === 'call_tool' && ['admin', 'approver'].includes(actor.role)) || (action === 'request_budget' && ['admin', 'approver'].includes(actor.role));
