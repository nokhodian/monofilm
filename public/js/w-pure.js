// Pure helpers for the wizard page: words, counts and the margin card's plan sentence. No DOM, so node can test them (test/wizard-ui.test.js).

// What each kind of AI-made thing offers in the margin card.
//   offT: the question; off: quick "what is off" chips; adj: sliders; keep: what to preserve; vis: a picture to pin on;
//   cost: credits one fix costs by default (a registered handler can override); does: the verb the plan sentence uses.
export const CFG = {
  sent: { n: 'sentence', offT: 'What should I do with this sentence?', off: ['Keep word for word', 'Can be adapted', 'Cut it', 'Too vague', 'Not clear who'], adj: [], keep: [], quick: ['Make it the opening line', 'Say it more plainly'], vis: false, cost: 0, does: 'mark', touch: 'how I read your story' },
  file: { n: 'file', offT: 'What should I do with this file?', off: ['Read it for the story', 'Use as a place photo', 'Use as a face reference', 'Transcribe it', 'Ignore it'], adj: [], keep: [], quick: [], vis: false, cost: 0, does: 'handle', touch: 'the reading and the places' },
  ent: { n: 'item', offT: 'Is this right?', off: ['Wrong name', 'Wrong role', 'Wrong age', 'Not needed', 'Merge with another', 'I never said that'], adj: [], keep: [], quick: ['Make her the lead', 'Remove it'], vis: false, cost: 0, does: 'correct', touch: 'scenes and faces not yet made' },
  reading: { n: 'part of the reading', offT: 'What is wrong with my reading?', off: ['Wrong period', 'Wrong tone', 'Missed a part of the story', 'Made something up', 'Too long', 'Too vague'], adj: [], keep: [], quick: ['Say it more plainly'], vis: false, cost: 0, does: 'rewrite', touch: 'the scenes drafted from it' },
  look: { n: 'look', offT: 'What is off about this look?', off: ['Too dark', 'Too clean', 'Wrong colours', 'Too modern', 'Too grainy', 'Wrong mood'], adj: [{ k: 'grain', l: 'Grain', min: 'none', max: 'heavy', v: 30 }, { k: 'contrast', l: 'Contrast', min: 'soft', max: 'hard', v: 50 }, { k: 'warm', l: 'Warmth', min: 'cold', max: 'warm', v: 60 }], keep: ['Candle and daylight', 'Period feel'], quick: ['Closer to my reference', 'Less orange'], vis: true, cost: 2, does: 'remake the sample of', touch: 'every picture once it is locked' },
  ref: { n: 'reference', offT: 'What should I take from this reference?', off: ['The colours', 'The light', 'The clothes', 'The buildings', 'Ignore it'], adj: [], keep: [], quick: [], vis: true, cost: 0, does: 'use', touch: 'the look' },
  face: { n: 'face', offT: 'What is off about this face?', off: ['Too young', 'Too old', 'Wrong period', 'Too modern', 'Wrong expression', 'Hair not covered', 'Not like the description'], adj: [{ k: 'age', l: 'Age', min: '20s', max: '60s', v: 35, fmt: (v) => `${Math.round((20 + v * 0.4) / 10) * 10}s` }, { k: 'wear', l: 'Weathering', min: 'clean', max: 'worn', v: 50 }, { k: 'expr', l: 'Expression', min: 'stern', max: 'warm', v: 30 }], keep: ['Face shape', 'Expression', 'Colouring', 'Clothing'], quick: ['Hair fully covered', 'More weathered', 'Less smiling', 'Older and more tired'], vis: true, cost: 3, does: 'make 3 new versions of', touch: 'everything built on the anchor face' },
  voice: { n: 'voice', offT: 'What is off about this voice?', off: ['Too young', 'Too old', 'Too soft', 'Too harsh', 'Wrong accent', 'Wrong feeling'], adj: [{ k: 'speed', l: 'Speed', min: 'slow', max: 'fast', v: 50 }, { k: 'energy', l: 'Energy', min: 'calm', max: 'urgent', v: 40 }], keep: ['Timbre'], quick: ['Lower and calmer'], vis: false, cost: 1, does: 'make 2 new samples of', touch: 'every line this person speaks' },
  place: { n: 'place', offT: 'What is off about this place?', off: ['Wrong era', 'Too clean', 'Wrong light', 'Objects missing', 'Wrong scale', 'Not like my photo'], adj: [{ k: 'time', l: 'Time of day', min: 'dawn', max: 'dusk', v: 80 }, { k: 'busy', l: 'Clutter', min: 'empty', max: 'busy', v: 55 }], keep: ['Main beam', 'Ropes', 'Layout'], quick: ['More scaffolding', 'Add dust in the air'], vis: true, cost: 2, does: 'make 2 new plates of', touch: 'the stage and pictures set here' },
  scene: { n: 'scene', offT: 'What is off about this scene?', off: ['Too long', 'Too short', 'Wrong order', 'Does not hook', 'Gives too much away', 'Unclear'], adj: [{ k: 'len', l: 'Length', min: '4 s', max: '20 s', v: 12, unit: ' s', lo: 4, hi: 20 }, { k: 'tense', l: 'Intensity', min: 'calm', max: 'tense', v: 60 }], keep: ['Its place', 'Its people'], quick: ['Cut the first second', 'Start on the beam'], vis: false, cost: 0, does: 're-plan', touch: 'its shots and the cut; the other scenes keep their time' },
  shot: { n: 'shot', offT: 'What is off about this shot?', off: ['Wrong angle', 'Too close', 'Too wide', 'Camera moves too much', 'Wrong person in frame'], adj: [{ k: 'lens', l: 'Lens', min: '24 mm', max: '85 mm', v: 35, unit: ' mm', lo: 24, hi: 85 }, { k: 'cam', l: 'Camera height', min: 'low', max: 'high', v: 30 }, { k: 'len', l: 'Length', min: '2 s', max: '8 s', v: 4, unit: ' s', lo: 2, hi: 8 }], keep: ['Who is in frame'], quick: ['Lower and closer'], vis: true, cost: 0, does: 're-frame', touch: 'its pictures once chosen' },
  obj: { n: 'object', offT: 'What is off about this?', off: ['In the wrong place', 'Facing the wrong way', 'Wrong size', 'Should not be here'], adj: [{ k: 'face', l: 'Facing', min: 'left', max: 'right', v: 40 }], keep: [], quick: [], vis: false, nudge: true, cost: 0, does: 'move', touch: 'the layout and the pictures made from it' },
  pic: { n: 'picture', offT: 'What is off about this picture?', off: ['Not the anchor face', 'Wrong period', 'Lighting', 'Artifacts', 'Composition off', 'Too clean'], adj: [], keep: ['Face', 'Pose', 'Camera angle', 'Light', 'Colours'], quick: ['Same picture, warmer light', 'Tighter on her eyes'], vis: true, cost: 3, does: 'make 3 new pictures from', touch: 'the video for this scene' },
  line: { n: 'line', offT: 'What is off about this line?', off: ['Too fast', 'Too slow', 'Flat', 'Too emotional', 'Mispronounced', 'Wrong voice'], adj: [{ k: 'speed', l: 'Speed', min: 'slow', max: 'fast', v: 50 }, { k: 'energy', l: 'Energy', min: 'calm', max: 'urgent', v: 55 }], keep: ['Words', 'Voice'], quick: ['Whispered', 'Say it as a question'], vis: false, words: true, cost: 1, does: 're-record', touch: 'the captions timing and the cut' },
  cue: { n: 'sound cue', offT: 'What is off about this sound?', off: ['Too loud', 'Too quiet', 'Starts late', 'Wrong sound', 'Too long'], adj: [{ k: 'level', l: 'Level', min: '0', max: '100', v: 60 }, { k: 'start', l: 'Start', min: '0 s', max: '30 s', v: 0, unit: ' s', lo: 0, hi: 30 }], keep: [], quick: ['Fade it in slowly'], vis: false, cost: 1, does: 'remake', touch: 'the mix' },
  beat: { n: 'beat', offT: 'What is off about this beat?', off: ['Cut earlier', 'Cut later', 'Too long', 'Wrong picture', 'Wrong order'], adj: [{ k: 'len', l: 'Length', min: '1 s', max: '10 s', v: 5, unit: ' s', lo: 1, hi: 10 }], keep: [], quick: ['Hold on her eyes a second longer'], vis: true, cost: 0, does: 're-cut', touch: 'the total runtime and the captions timing' },
  dir: { n: 'note', offT: 'What is off about this note?', off: ['Too vague', 'Missing a detail', 'Contradicts the look', 'Too much at once', 'Wrong mood'], adj: [{ k: 'detail', l: 'Level of detail', min: 'short', max: 'full', v: 60 }], keep: [], quick: ['Say who looks at whom', 'Name the light source', 'Say what the camera must not do'], vis: false, cost: 0, does: 'rewrite', touch: 'the prompt in the exported pack' },
  frame: { n: 'start or end picture', offT: 'What is off about this anchor picture?', off: ['Wrong moment', 'Composition off', 'Not the anchor face', 'Wrong light', 'Too clean', 'Different from the stage'], adj: [{ k: 'tight', l: 'Framing', min: 'wide', max: 'tight', v: 40 }], keep: ['Face', 'Pose', 'Camera angle', 'Light', 'Colours'], quick: ['Start one second earlier', 'Show the beam in frame'], vis: true, cost: 3, does: 'make 3 new variations of', touch: 'the exported pack for this scene' },
  take: { n: 'take', offT: 'What is off about this clip?', off: ['First frame does not match', 'Last frame drifts', 'Face changed', 'Wrong camera motion', 'Artifacts', 'Too fast'], adj: [], keep: ['Camera move', 'Light', 'Who is in frame'], quick: ['Hold the first frame longer', 'Say the face must stay the same'], vis: true, cost: 0, does: 'write a revised pack for', touch: 'the pack prompt for this clip. Nothing is generated here.' },
  pack: { n: 'pack', offT: 'What is off about this pack?', off: ['Prompt too long', 'Prompt too short', 'A file is missing', 'Wrong target', 'Wrong length'], adj: [], keep: ['Camera move', 'Light'], quick: ['Say who looks at whom'], vis: false, cost: 0, does: 'write a revised pack for', touch: 'the files and prompt for this clip. Nothing is generated here.' },
};

// Which margin-card kind an artifact gets when the element does not say (data-kind).
const BY_REF = { bible: 'reading', 'canon.cast': 'ent', 'canon.voice': 'voice', 'canon.world': 'place', 'canon.style': 'look', scene: 'scene', keyframe: 'frame', take: 'take', reference: 'ref', shot: 'shot', stage: 'obj', dialogue: 'line', sfx: 'cue', music: 'cue' };
export const kindFor = (ref, explicit) => (explicit && CFG[explicit] ? explicit : BY_REF[String(ref).slice(0, String(ref).indexOf(':'))] || 'ent');

export const emptyDraft = () => ({ tags: [], pins: [], keeps: [], v: {}, note: '', mis: [] });
export const fmtV = (a, v) => (a.fmt ? a.fmt(v) : a.unit ? v + a.unit : v < 34 ? a.min : v > 66 ? a.max : 'mid');

// The plan sentence and price for one or several items sharing the same feedback. items: [{name, kind}], draft: emptyDraft() shape.
export function planOf(items, draft, cfg, cost) {
  const f = items[0], n = items.length, s = draft;
  const ch = cfg.adj.filter((a) => s.v[a.k] !== undefined && s.v[a.k] !== a.v).map((a) => `${a.l.toLowerCase()} ${fmtV(a, s.v[a.k])}`);
  if (s.v.dx || s.v.dz) ch.push(`moved ${[s.v.dx && `${Math.abs(s.v.dx * 0.2).toFixed(1)} m ${s.v.dx < 0 ? 'left' : 'right'}`, s.v.dz && `${Math.abs(s.v.dz * 0.2).toFixed(1)} m ${s.v.dz < 0 ? 'back' : 'forward'}`].filter(Boolean).join(', ')}`);
  const parts = [];
  if (s.tags.length) parts.push(`${cfg.offT.startsWith('What should I do') || cfg.offT === 'Is this right?' ? 'Do' : 'Fix'}: ${s.tags.join(', ').toLowerCase()}.`);
  if (s.mis.length) parts.push(`Mispronounced: ${s.mis.join(', ')}.`);
  if (s.pins.length) parts.push(`Pins: ${s.pins.map((p) => `${p.n} ${p.note || '(no note yet)'}`).join('; ')}.`);
  if (ch.length) parts.push(`Change: ${ch.join(', ')}.`);
  if (s.keeps.length) parts.push(`Keep: ${s.keeps.join(', ').toLowerCase()}.`);
  if (s.note && s.note.trim()) parts.push(`Your words: "${s.note.trim()}"`);
  const lead = `I will ${cfg.does} ${n > 1 ? `${n} ${cfg.n}s` : f.name}.`;
  return { text: [lead, ...parts].join(' '), instruction: parts.join(' '), cost: (cost === undefined ? cfg.cost : cost) * n, touch: cfg.touch, empty: !parts.length };
}

// A pin list as anchor text: pin:1@0.50,0.20;pin:2@0.10,0.80
export const pinAnchor = (pins) => pins.map((p) => `pin:${p.n}@${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';');
export const anchorOf = (part, pins) => [part ? `part:${part}` : '', pins && pins.length ? pinAnchor(pins) : ''].filter(Boolean).join(';');

export const plural = (n, one, many) => (n === 1 ? one : many);
export function readoutText(chars, files) {
  if (!chars && !files) return 'Nothing yet.';
  return [chars ? `${chars.toLocaleString('en')} character${chars === 1 ? '' : 's'}` : 'no text', files ? `${files} file${files === 1 ? '' : 's'}` : 'no files'].join(' · ');
}
export function startReason(hasInput, busy) { return busy ? 'Reading your story...' : hasInput ? 'Ready. I will read your text and your files together.' : 'Write, paste, or add something first.'; }

// "Step 4 of 7 · Scene 2 · Brief · 3 of 6 reviewed"
export function progressText({ n, total = 7, scene, sub, okN, itemsN }) {
  return [`Step ${n} of ${total}`, scene ? `Scene ${scene}${sub ? ` · ${sub}` : ''}` : '', itemsN ? `${okN} of ${itemsN} reviewed` : ''].filter(Boolean).join(' · ');
}
// The reason the forward button is off, in words. todo: items not approved; chg: items that need a change; noun: [one, many].
export function gateReason({ empty, todo, chg, noun = ['item', 'items'], n }) {
  if (empty) return 'Add your story in Start first.';
  if (todo > 0) return `Review ${todo} more ${plural(todo, noun[0], noun[1])}${chg ? ` (${chg} need${chg === 1 ? 's' : ''} a change)` : ''}. Or choose "Approve all".`;
  return n ? 'Everything is approved. You can go on.' : 'Nothing to review here. You can go on.';
}
// The sentence marks: click cycles none -> keep -> cut -> none.
export const nextMark = (m) => (m === 'keep' ? 'cut' : m === 'cut' ? null : 'keep');
export const MARK_LABEL = { keep: 'keep word for word', cut: 'cut' };
export const LENGTHS = [['Teaser', 60, 'Teaser · 60 s'], ['Short film', 300, 'Short film · 5 min'], ['Episode', 1200, 'Episode · 20 min']];
export const kindOfFile = (n) => (/\.(jpe?g|png|webp|gif|heic)$/i.test(n) ? 'photo' : /\.(m4a|mp3|wav|ogg|aac)$/i.test(n) ? 'voice' : 'doc');
export const isTextFile = (n, type = '') => /\.(txt|md|markdown|text)$/i.test(n) || type.startsWith('text/');

// Every value a format field may take. The chips show the common ones; the person can also type anything or pick from the full list.
export const ALL_LANGS = ['Afrikaans', 'Albanian', 'Amharic', 'Arabic', 'Armenian', 'Azerbaijani', 'Basque', 'Bengali', 'Bosnian', 'Bulgarian', 'Burmese', 'Catalan', 'Chinese (Mandarin)', 'Chinese (Cantonese)', 'Croatian', 'Czech', 'Danish', 'Dutch', 'English', 'Estonian', 'Filipino', 'Finnish', 'French', 'Galician', 'Georgian', 'German', 'Greek', 'Gujarati', 'Hausa', 'Hebrew', 'Hindi', 'Hungarian', 'Icelandic', 'Indonesian', 'Irish', 'Italian', 'Japanese', 'Kannada', 'Kazakh', 'Khmer', 'Korean', 'Kurdish', 'Lao', 'Latin', 'Latvian', 'Lithuanian', 'Macedonian', 'Malay', 'Malayalam', 'Maltese', 'Marathi', 'Mongolian', 'Nepali', 'Norwegian', 'Pashto', 'Persian', 'Polish', 'Portuguese', 'Punjabi', 'Romanian', 'Russian', 'Serbian', 'Sinhala', 'Slovak', 'Slovenian', 'Somali', 'Spanish', 'Swahili', 'Swedish', 'Tamil', 'Telugu', 'Thai', 'Turkish', 'Ukrainian', 'Urdu', 'Uzbek', 'Vietnamese', 'Welsh', 'Yoruba', 'Zulu', 'No speech'];
export const ASPECT_PRESETS = ['9:16', '16:9', '1:1', '4:5', '21:9'];
// "4:5" -> '4:5'; anything that is not two whole numbers between 1 and 99, or is more extreme than 4:1, is refused with null.
export function cleanAspect(s) {
  const m = /^\s*(\d{1,2})\s*[:x/]\s*(\d{1,2})\s*$/i.exec(String(s || '')); if (!m) return null;
  const w = +m[1], h = +m[2]; return w > 0 && h > 0 && w / h <= 4 && h / w <= 4 ? `${w}:${h}` : null;
}
// A length typed by the person: a number and a unit -> whole seconds (1 s to 3 hours), or null.
export function cleanSeconds(n, unit) {
  const v = Number(String(n).replace(',', '.')); if (!Number.isFinite(v) || v <= 0) return null;
  const s = Math.round(v * (unit === 'minutes' ? 60 : 1)); return s >= 1 && s <= 10800 ? s : null;
}
export const lengthLabel = (s) => (s % 60 === 0 && s >= 60 ? `${s / 60} min` : s > 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);
