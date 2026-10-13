const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../shorashim/teacher.js'), 'utf8');
const perekStart = source.indexOf('const PEREK19_SHORASHIM=');
const perekEnd = source.indexOf('function perekOf(', perekStart);
const artStart = source.indexOf('const GENERIC_ART_CHOICES=');
const artEnd = source.indexOf('function splitKey(', artStart);
assert(perekStart >= 0 && perekEnd > perekStart && artStart >= 0 && artEnd > artStart);

const pureCode = source.slice(perekStart, perekEnd) + '\n' + source.slice(artStart, artEnd) + `\n({ fallbacks: PEREK19_SHORASHIM.map(item => ({ id: item.id, english: item.english, art: smartArtFor(item.english, item.front) })), mergeCatalogWithoutReplacingPictures });`;
const loaded = vm.runInNewContext(pureCode);
assert.equal(loaded.fallbacks.length, 84, 'all seeded Perek 19 words are covered');
assert(loaded.fallbacks.every(item => item.art.length > 0), 'every seeded word gets meaning-matched picture choices');
assert(loaded.fallbacks.every(item => item.art.length <= 4), 'picture choices remain within the display limit');

const current = { shorashim: [
  { id: 'approved', front: 'רָאָה', english: 'see', art: ['👀'], teacherApproved: true, order: 1 },
  { id: 'missing', front: 'סוּר', english: 'turn aside', art: [], teacherApproved: false, order: 2 }
], prefix: [{ id: 'keep-prefix' }] };
const local = { shorashim: [
  { id: 'approved', front: 'רָאָה', english: 'new meaning', art: ['✨'], teacherApproved: false, order: 99 },
  { id: 'missing', front: 'סוּר', english: 'turn aside', art: ['↪️'], aiArtGenerated: true },
  { id: 'new', front: 'חָדָשׁ', english: 'new', art: ['🆕'] }
] };
const merged = loaded.mergeCatalogWithoutReplacingPictures(current, local);
assert.deepEqual(merged.shorashim[0], current.shorashim[0], 'approved/existing pictures and word data are untouched');
assert.deepEqual([...merged.shorashim[1].art], ['↪️'], 'a missing picture set is filled');
assert.equal(merged.shorashim[1].order, 2, 'existing word order/data is preserved');
assert.equal(merged.shorashim[2].id, 'new', 'new words append to the existing list');
assert.deepEqual(JSON.parse(JSON.stringify(merged.prefix)), current.prefix, 'other Shorashim tracks are preserved');

const bulk = source.slice(source.indexOf('async function fillArtForShorashim'), source.indexOf('function mergeCatalogWithoutReplacingPictures'));
assert.match(bulk, /!sanitizeClassArt\(i\.art\)\.length/, 'bulk process only targets missing art');
assert.match(bulk, /teacherApproved!==true/, 'bulk process skips approved catalog entries');
console.log('Shorashim art safety tests passed.');
