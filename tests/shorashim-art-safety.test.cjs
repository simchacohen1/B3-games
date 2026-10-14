'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('shorashim/teacher.js', 'utf8');
const perekStart = source.indexOf('const PEREK19_SHORASHIM=');
const perekEnd = source.indexOf('function perekOf(', perekStart);
const artStart = source.indexOf('const GENERIC_ART_CHOICES=');
const artEnd = source.indexOf('function splitKey(', artStart);
assert(perekStart >= 0 && perekEnd > perekStart && artStart >= 0 && artEnd > artStart);

const pureCode = source.slice(perekStart, perekEnd) + '\n' +
  source.slice(artStart, artEnd) +
  '\n({ fallbacks: PEREK19_SHORASHIM.map(item => ({ id:item.id, english:item.english, art:smartArtFor(item.english,item.front) })), smartArtCandidatesFor, fillArtForShorashim, mergeCatalogWithoutReplacingPictures });';
const loaded = vm.runInNewContext(pureCode);

test('Perek 19 still offers semantic teacher-only picture suggestions', () => {
  assert.equal(loaded.fallbacks.length, 84);
  assert(loaded.fallbacks.every(i => i.art.length > 0));
  assert(loaded.fallbacks.every(i => i.art.length <= 4));
  const man = [...loaded.smartArtCandidatesFor('man', 'אִישׁ')];
  assert(man.includes('👨'), 'the man icon must no longer be blocked');
  assert(man.includes('🧔'), 'the beard emoji must no longer be blocked');
  assert(!source.includes('UNSUITABLE_ART_CHOICES'), 'no custom people/couple ban remains');
});

test('automatic picture repair cannot put suggestions into student-visible art', async () => {
  const item = { id:'man', front:'אִישׁ', english:'man', art:[], artPool:[], teacherApproved:true };
  const repaired = await loaded.fillArtForShorashim([item]);
  assert.equal(repaired, 1);
  assert.deepEqual([...item.art], [], 'teacher approval of a word is not picture approval');
  assert(item.artPool.includes('👨'), 'new picture is pending in teacher-only pool');
  assert.equal(await loaded.fillArtForShorashim([item]), 0, 'reloading does not recreate suggestions');
  const selected = { id:'selected', front:'אִישׁ', english:'man', art:['👨'], artPool:[] };
  assert.equal(await loaded.fillArtForShorashim([selected]), 0);
  assert.deepEqual([...selected.art], ['👨']);
});

test('catalog seed/migration preserves existing teacher approvals but never publishes pending pictures', () => {
  const current = {shorashim:[
    { id:'approved', front:'רָאָה', english:'see', art:['👀'], teacherApproved:true, order:1 },
    { id:'missing', front:'סוּר', english:'turn aside', art:[], teacherApproved:false, order:2 }
  ], prefix:[{id:'keep-prefix'}]};
  const local = {shorashim:[
    { id:'approved', front:'רָאָה', english:'changed', art:['✨'], teacherApproved:false, order:99 },
    { id:'missing', front:'סוּר', english:'turn aside', artPool:['↪️'], aiArtGenerated:false },
    { id:'new', front:'חָדָשׁ', english:'new', art:['🆕'] }
  ]};
  const merged = loaded.mergeCatalogWithoutReplacingPictures(current, local);
  assert.deepEqual(JSON.parse(JSON.stringify(merged.shorashim[0])), current.shorashim[0]);
  assert.deepEqual([...merged.shorashim[1].art], []);
  assert.deepEqual([...merged.shorashim[1].artPool], ['↪️']);
  assert.equal(merged.shorashim[1].order, 2);
  assert.deepEqual([...merged.shorashim[2].art], [], 'new seed starts unapproved');
  assert.deepEqual([...merged.shorashim[2].artPool], ['🆕']);
  assert.deepEqual(JSON.parse(JSON.stringify(merged.prefix)), current.prefix);
});
