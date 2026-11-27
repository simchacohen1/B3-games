'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const page = fs.readFileSync('shorashim/index.html', 'utf8');
const app = fs.readFileSync('shorashim/app.js', 'utf8');
const skin = fs.readFileSync('shorashim/shorashim-skin.js', 'utf8');
const home = page.slice(page.indexOf('id="studentHome"'), page.indexOf('id="shorashimPerekScreen"'));

test('home has only New Shorashim and Review, no controller icon on Review', () => {
  assert.equal((home.match(/class="hub-card /g) || []).length, 2);
  assert.match(home, /data-learn-direct/);
  assert.ok(!home.includes('🎮'));
});
test('tracker shows Learned and Mastered, no x / y or percent bar', () => {
  assert.match(skin, /LEARNED/); assert.match(skin, /MASTERED/);
  assert.ok(!skin.includes('sk-bar') && !skin.includes('sk-pct'));
  assert.match(skin, /summarizeStudent/);
});
test('Learn New Words goes straight to the last list, with a Switch list button', () => {
  assert.match(app, /function openLearnDirect/);
  assert.match(app, /localStorage\.setItem\(lastListKey\(\)/);
  assert.match(page, /id="changeLearningPerekBtn"[^>]*>Switch list ▾/);
});
test('Review page lists tracing, multiple choice, matching and all four games', () => {
  const side = page.slice(page.indexOf('id="reviewMoreWays"'), page.indexOf('</aside>', page.indexOf('id="reviewMoreWays"')));
  for (const k of ['trace', 'mc', 'match']) assert.match(side, new RegExp('data-more-practice="' + k + '"'));
  for (const k of ['match', 'shoot', 'whack', 'race']) assert.match(side, new RegExp('data-more-game="' + k + '"'));
  assert.match(page, /How many do you want to review now\?/);
});

test('every Chumash Vocab word gets emoji suggestions, wired into the Art Lab and the Block list', () => {
  global.window = {};
  require('../shorashim/chumash-vocab.js'); require('../shorashim/chumash-emoji.js');
  const words = window.FTT_CHUMASH_VOCAB, S = window.FTT_CHUMASH_EMOJI;
  assert.ok(words.length >= 689);
  for (const w of words) assert.ok(S.suggest(w).length >= 3, w.english);
  assert.ok(S.suggest(words.find(w => w.english === 'Camel')).includes('🐪'));
  assert.match(app, /unblockedArt\(chumashEmojiArt\(item\)\)/);
  assert.match(page, /chumash-emoji\.js\?v=/);
  assert.ok(page.indexOf('chumash-emoji.js') < page.indexOf('app.js?v='));
  delete global.window;
});
test('learning page shows the current list as a big tag next to Switch list', () => {
  assert.match(page, /id="learnListBar"[\s\S]*id="learnListTag"[\s\S]*id="changeLearningPerekBtn"[^>]*>Switch list ▾/);
  assert.match(app, /function updateLearnListTag/);
});
test('the Art Lab renderer that is actually live adds Chumash suggestions and honors the Block list', () => {
  const rc = fs.readFileSync('shorashim/review-categories.js', 'utf8');
  assert.match(rc, /FTT_CHUMASH_EMOJI\.suggest\(item\)/);
  assert.match(rc, /blockedArtList\(\)/);
  assert.match(rc, /art\.filter\(v => !blocked\.includes\(v\)\)/);
});

test('Switch list is a dropdown under the button that switches lists on the same screen', () => {
  assert.match(page, /id="switchListMenu"/);
  assert.match(app, /function toggleSwitchListMenu/);
  assert.match(app, /learned`:'No words assigned yet'/);
  assert.ok(!/changePerek\.onclick=\(\)=>goScreen\('shorashimPerekScreen'\)/.test(app));
});
