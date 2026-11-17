const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

// Pull one top-level function out of a page's script so it can run here without a browser.
function grab(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert(i >= 0, name + ' not found');
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

const teacher = read('record_pesukim/teacher.html');

// ---- bug 2: older translation results saved only as one percentage ----
{
  const code = grab(teacher, 'legacyTranslationScore');
  const legacyTranslationScore = new Function(code + '; return legacyTranslationScore;')();
  assert.strictEqual(legacyTranslationScore({ translationScore: '75%' }), 75);
  assert.strictEqual(legacyTranslationScore({ translationScore: 80 }), 80);
  assert.strictEqual(legacyTranslationScore({ translationScore: 250 }), 100);
  assert.strictEqual(legacyTranslationScore({}), null);
  assert.strictEqual(legacyTranslationScore({ translationScore: 'x' }), null);
  assert(/effTranslationScore[\s\S]{0,400}legacyTranslationScore\(record\)/.test(teacher), 'effTranslationScore must fall back to the saved total');
}

// ---- bug 2: a posuk practiced inside a range counts for each posuk in it ----
{
  const code = grab(teacher, 'rangeAttemptsFor');
  const rangeAttemptsFor = new Function(code + '; return rangeAttemptsFor;')();
  const att = { 'Bereishis_1_5-7': { a: { id: 'r' } }, 'Bereishis_1_8': { b: { id: 'single' } }, 'Bereishis_2_5-7': { c: { id: 'other perek' } } };
  assert.deepStrictEqual(rangeAttemptsFor(att, 'Bereishis', 1, 6).map(a => a.id), ['r']);
  assert.deepStrictEqual(rangeAttemptsFor(att, 'Bereishis', 1, 8), []);
  assert.deepStrictEqual(rangeAttemptsFor(att, 'Bereishis', 1, 4), []);
}

// ---- Read & Translate is one result; scores are never averaged ----
{
  const code = ['pctTier', 'readTranslateCell'].map(n => { try { return grab(teacher, n); } catch (e) { return ''; } }).join('\n');
  const mk = new Function('attemptHasResult', 'bestNumericScore', 'effHebrewScore', 'effTranslationScore', 'pctTier0', code.replace('function pctTier(', 'function pctTier(') + '; return readTranslateCell;');
  const attemptHasResult = a => !!a;
  const bestNumericScore = (list, f) => list.reduce((b, a) => { const v = f(a); return typeof v === 'number' && (b === null || v > b) ? v : b; }, null);
  const cell = mk(attemptHasResult, bestNumericScore, a => a.r, a => a.t);
  assert.strictEqual(cell([], null), null);
  assert.strictEqual(cell([{ r: 90, t: 40 }], { status: 'gold' }).tier, 'high');
  assert.strictEqual(cell([{ r: 90, t: 90 }], { status: 'retry' }).tier, 'low');
  assert.strictEqual(cell([{ r: 90, t: 90 }], { status: 'pending' }).tier, 'mid');
  const older = cell([{ r: 90, t: 40 }], null);
  assert.strictEqual(older.read, 90);
  assert.strictEqual(older.translate, 40);   // side by side, not 65
}

// ---- no old split in the teacher page's tab buttons / headings ----
assert(!/id="classReadingBtn"|id="classTranslateBtn"|id="studentReadingBtn"|id="studentTranslateBtn"/.test(teacher), 'old three-way tabs are gone');
assert(/id="classReadTranslateBtn"/.test(teacher) && /id="studentReadTranslateBtn"/.test(teacher));
assert(/Chumash חידון/.test(teacher), 'comprehension is named as Chumash חידון');
assert(teacher.includes('<th>Pesukim</th><th>Read &amp; Translate</th>'), 'roster has one Read & Translate column');
assert(/Latest Read &amp; Translate|Latest Read & Translate/.test(teacher) && /Latest Chumash חידון/.test(teacher), 'overview separates the two lists');

// ---- Chazara teacher page counts gold recordings ----
{
  const ct = read('chazara/teacher.html');
  assert(/posukPractice\/reviews',G/.test(ct), 'loads the teacher grades');
  assert(/function goldKeys\(id\)/.test(ct) && /concat\(goldKeys\(id\)\)/.test(ct), 'gold unlocks a posuk');
  assert(/older result/.test(ct), 'old milestone rows are named as older');
}

// ---- Chazara student page / labels ----
{
  const ci = read('chazara/index.html');
  assert(/100% in Chumash חידון/.test(ci));
  assert(!/100% Understand needed after 10/.test(ci));
  assert(/Read &|Read and Translate/.test(read('index.html')) || /Read and Translate grade/.test(read('index.html')));
  assert(/Read & Translate \(teacher grade\)/.test(read('student-rewards/teacher.js')));
  assert(/older results/.test(read('student-report/index.html')));
}

console.log('posuk-display-cleanup: ok');
