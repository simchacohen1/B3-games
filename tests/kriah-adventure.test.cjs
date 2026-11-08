'use strict';
/* ============================================================
   tests/kriah-adventure.test.cjs
   Unit tests for adventure.js data and pure functions.
   Run with: node --test tests/kriah-adventure.test.cjs
   ============================================================ */

const { test } = require('node:test');
const assert   = require('assert/strict');

const { LETTERS, NEKUDOS, BLENDS, WORLDS, letterUnlockIndex, coinReward } =
  require('../kriah-assessment/adventure.js');

// 1. LETTERS array size
test('LETTERS has exactly 22 entries', () => {
  assert.equal(LETTERS.length, 22);
});

// 2. Every letter character is a single Hebrew Unicode code point
test('Every letter is a single Hebrew Unicode character (U+05D0–U+05EA)', () => {
  const hebrewRange = /^[א-ת]$/;
  for (const l of LETTERS) {
    assert.match(l.char, hebrewRange,
      'Expected "' + l.name + '" char "' + l.char + '" to be a single Hebrew letter');
  }
});

// 3. WORLDS covers all 22 letters with no duplicates
test('WORLDS covers all 22 letters with no duplicates', () => {
  const all = WORLDS.flatMap(w => w.letterIndices);
  assert.equal(all.length, 22, 'Total letter indices should be 22');
  const unique = new Set(all);
  assert.equal(unique.size, 22, 'No duplicate letter indices in WORLDS');
  for (let i = 0; i < 22; i++) {
    assert.ok(unique.has(i), 'Letter index ' + i + ' should appear in some world');
  }
});

// 4. letterUnlockIndex(0) = 1 (first world always unlocked)
test('letterUnlockIndex(0) returns 1', () => {
  assert.equal(letterUnlockIndex(0), 1);
});

// 5. letterUnlockIndex(2) = 2
test('letterUnlockIndex(2) returns 2', () => {
  assert.equal(letterUnlockIndex(2), 2);
});

// 6. letterUnlockIndex(100) = 5 (capped at WORLDS.length)
test('letterUnlockIndex(100) returns 5 (capped)', () => {
  assert.equal(letterUnlockIndex(100), 5);
});

// 7. letterUnlockIndex(1) = 1 (threshold for second world is 2)
test('letterUnlockIndex(1) returns 1 (threshold is 2)', () => {
  assert.equal(letterUnlockIndex(1), 1);
});

// 8. coinReward returns coinsPerCorrect * correct when correct > 0
test('coinReward(5, 5, 10) returns 50', () => {
  assert.equal(coinReward(5, 5, 10), 50);
});

// 9. coinReward returns 0 when correct is 0
test('coinReward(0, 5, 10) returns 0', () => {
  assert.equal(coinReward(0, 5, 10), 0);
});

// 10. BLENDS includes entries with BA, MA, SHA sounds
test('BLENDS includes BA, MA, SHA sounds', () => {
  const sounds = new Set(BLENDS.map(b => b.sound));
  assert.ok(sounds.has('BA'),  'BLENDS should include BA');
  assert.ok(sounds.has('MA'),  'BLENDS should include MA');
  assert.ok(sounds.has('SHA'), 'BLENDS should include SHA');
});
