// Pure helpers behind the wizard page: words for progress and reasons, the margin card's plan sentence, anchors.
import { cleanAspect, cleanSeconds, lengthLabel, ALL_LANGS, legacyHash } from '../public/js/w-pure.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG, kindFor, emptyDraft, planOf, anchorOf, readoutText, startReason, progressText, gateReason, nextMark } from '../public/js/w-pure.js';

test('readout and start reason', () => {
  assert.equal(readoutText(0, 0), 'Nothing yet.');
  assert.equal(readoutText(272, 3), '272 characters · 3 files');
  assert.match(startReason(false, false), /Write, paste/);
  assert.match(startReason(true, true), /Reading your story/);
});
test('progress and gate reason in words', () => {
  assert.equal(progressText({ n: 4, okN: 3, itemsN: 6 }), 'Step 4 of 7 · 3 of 6 reviewed');
  assert.match(gateReason({ todo: 2, chg: 1, noun: ['face', 'faces'] }), /Review 2 more faces \(1 needs a change\)/);
  assert.match(gateReason({ todo: 0, n: 3 }), /Everything is approved/);
});
test('plan sentence, price and anchors', () => {
  const d = emptyDraft(); d.tags = ['Too young']; d.pins = [{ n: 1, x: 0.5, y: 0.2, note: 'hair' }]; d.note = 'older';
  const p = planOf([{ name: 'Ines' }], d, CFG.face);
  assert.equal(p.cost, 3); assert.match(p.text, /^I will make 3 new versions of Ines\./); assert.match(p.instruction, /Pins: 1 hair/);
  assert.equal(planOf([{ name: 'a' }], emptyDraft(), CFG.face).empty, true);
  assert.equal(anchorOf('s3', d.pins), 'part:s3;pin:1@0.50,0.20');
  assert.equal(kindFor('canon.cast:x'), 'ent'); assert.equal(kindFor('canon.cast:x', 'face'), 'face');
  assert.equal(nextMark(null), 'keep'); assert.equal(nextMark('cut'), null);
});

test('free entry: shapes, lengths and the language list are checked', () => {
  assert.equal(cleanAspect('4:5'), '4:5'); assert.equal(cleanAspect(' 3 x 4 '), '3:4'); assert.equal(cleanAspect('21/9'), '21:9');
  for (const bad of ['', 'wide', '0:5', '5:0', '1:9', '9:1', '100:100', '4:']) assert.equal(cleanAspect(bad), null, bad);
  assert.equal(cleanSeconds('45', 'seconds'), 45); assert.equal(cleanSeconds('1,5', 'minutes'), 90); assert.equal(cleanSeconds('12', 'minutes'), 720);
  for (const bad of ['', '0', '-3', 'abc', '200']) assert.equal(bad === '200' ? cleanSeconds(bad, 'minutes') : cleanSeconds(bad, 'seconds'), null, bad);
  assert.deepEqual([lengthLabel(45), lengthLabel(60), lengthLabel(90), lengthLabel(300)], ['45 s', '1 min', '1 min 30 s', '5 min']);
  assert.ok(ALL_LANGS.length > 70 && ALL_LANGS.includes('Persian') && ALL_LANGS.includes('Japanese') && new Set(ALL_LANGS).size === ALL_LANGS.length);
});

test('old studio addresses lead into the wizard', () => {
  assert.equal(legacyHash('#/credits'), '#/w/credits'); assert.equal(legacyHash('#/ledger'), '#/w/credits');
  for (const h of ['#/overview', '#/cast', '#/shots', '#/shot/abc', '#/feedback', '#/approvals', '#/tools', '#/cut/x', '#/staging']) assert.equal(legacyHash(h), '#/w', h);
  for (const h of ['', '#', '#/', '#/w', '#/w/credits', '#/w/scenes/a/stage', '#/stage/the-gap']) assert.equal(legacyHash(h), null, h);
});
