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
  assert.match(page, /id="changeLearningPerekBtn"[^>]*>🔀 Switch list/);
});
test('Review page lists tracing, multiple choice, matching and all four games', () => {
  const side = page.slice(page.indexOf('id="reviewMoreWays"'), page.indexOf('</aside>', page.indexOf('id="reviewMoreWays"')));
  for (const k of ['trace', 'mc', 'match']) assert.match(side, new RegExp('data-more-practice="' + k + '"'));
  for (const k of ['match', 'shoot', 'whack', 'race']) assert.match(side, new RegExp('data-more-game="' + k + '"'));
  assert.match(page, /How many do you want to review now\?/);
});
