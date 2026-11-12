'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

function loadCore() {
  const ctx = vm.createContext({ window: {}, location: { search: '' }, sessionStorage: { getItem: () => null }, localStorage: { getItem: () => null, setItem() {} },
    URLSearchParams, Date, setTimeout: () => 1, clearTimeout() {}, CustomEvent: class {} });
  ctx.window = ctx;
  vm.runInContext(read('word-bank/bank-core.js'), ctx);
  return ctx.FTTWordBank;
}
const w = (h, e) => ({ id: 'word:' + h, hebrew: h, english: e });

test('a lone word is padded to at least four distinct pairs', () => {
  const bank = loadCore();
  const pool = [w('אב', 'father'), w('אם', 'mother'), w('מֶלֶךְ', 'king'), w('סוסים', 'horses'), w('נידה', 'niddah')];
  for (let i = 0; i < 25; i++) {
    const set = bank.matchSet([w('תורה', 'Torah')], pool);
    assert.ok(set.length >= 4);
    assert.equal(set[0].english, 'Torah');
    assert.equal(new Set(set.map(x => x.hebrew)).size, set.length);
    assert.equal(new Set(set.map(x => x.english.toLowerCase())).size, set.length);
  }
});

test('padding never adds a duplicate Hebrew spelling or an identical English meaning', () => {
  const bank = loadCore();
  const pool = [w('תּוֹרָה', 'Torah'), w('חוק', 'torah'), w('בית', 'house'), w('דלת', 'door'), w('שלחן', 'table')];
  const set = bank.matchSet([w('תורה', 'Torah')], pool);
  assert.equal(set.filter(x => x.english.toLowerCase() === 'torah').length, 1);
  assert.equal(set.length, 4);
});

test('a lesson already big enough is kept whole; too small a pool degrades gracefully', () => {
  const bank = loadCore();
  const own = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x, i) => w('ע' + x, 'meaning' + i));
  assert.equal(bank.matchSet(own, [w('xx', 'extra')]).length, 8);
  const small = bank.matchSet([w('תורה', 'Torah')], []);
  assert.equal(small.length, 1); // caller shows it; nothing invented
});

test('Sefer HaMitzvos activity and My Word Bank matching use the padding helper', () => {
  assert.match(read('word-bank/sefer-activity.js'), /matchSet\(/);
  assert.match(read('word-bank/sefer-activity.js'), /matched\.size===matchTotal/);
  assert.match(read('word-bank/student.js'), /bank\.matchSet/);
  assert.match(read('word-bank/sefer-vocabulary-catalog.js'), /forRef,all/);
});

test('Rashi: finished missions reopen for practice and never reset saved progress', () => {
  const html = read('rashi-letters/student.html');
  assert.match(html, /Practice again: /);
  assert.match(html, /scrollIntoView/);
  // practice mode must not write the guided position
  const fn = html.slice(html.indexOf("if(mode==='continue'){"), html.indexOf('// Keep question transitions responsive'));
  assert.match(fn, /currentUnitIndex/);
  assert.ok(fn.indexOf("else if(practiceModeType==='mixed')") > fn.indexOf('currentUnitIndex'), 'progress write sits only in the continue branch');
  // mastered flags are only ever set, never cleared
  assert.match(html, /if\(chainFlags\[key\]\) return false;/);
  assert.doesNotMatch(html, /chainFlags\[[^\]]+\]\s*=\s*false/);
});
