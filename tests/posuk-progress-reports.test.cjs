'use strict';
// Posuk Practice after the one-recording change (#694): the student's My Progress and the teacher's Reports must show
//   • older reading and translation scores side by side (never averaged),
//   • the teacher's new grade (gold / waiting / not gold) for the one-recording way,
//   • nothing for a recording that has no result and no grade yet,
//   • comprehension under the Understand tool.
// The real functions are cut out of the pages and run on sample records. No student data is read or written.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const teacherHtml = read('record_pesukim/teacher.html');
const progressHtml = read('record_pesukim/progress.html');

// Every top-level function of a page, by name, with the ones a target needs (found by name in the text).
function load(html, targets, globals) {
  const decls = {};
  const re = /^(?:async )?function ([A-Za-z0-9_]+)\(/gm;
  let m;
  while ((m = re.exec(html))) {
    const end = html.indexOf('\n}\n', m.index);
    decls[m[1]] = html.slice(m.index, end + 3);
  }
  const need = new Set(), queue = [...targets];
  while (queue.length) {
    const name = queue.pop();
    if (need.has(name) || !decls[name] || Object.prototype.hasOwnProperty.call(globals, name)) continue;
    need.add(name);
    for (const other of Object.keys(decls)) if (!need.has(other) && new RegExp('\\b' + other + '\\b').test(decls[name].replace(/^[^\n]*\n/, ''))) queue.push(other);
  }
  const context = vm.createContext({ ...globals });
  vm.runInContext([...need].map(n => decls[n]).join('\n') + '\nthis.api={' + targets.join(',') + '};', context);
  return context.api;
}

const T = (extra = {}) => load(teacherHtml, ['rowHasResult', 'buildReportRows', 'computeStudentStats', 'scoreShows', 'gradeBadge', 'gradePlain', 'attemptHasResult'], {
  studentsMap: { ann: 'Ann', ben: 'Ben' },
  inTeacherSefer: () => true,
  parshaDisplayName: slug => slug,
  VERDICT_INFO: { excellent: {}, correct: {}, partial: {}, incorrect: {} },
  ...extra
});

// An older attempt: reading 85% and translation 2 of 4 chunks right.
const oldAttempt = { timestamp: 1000, hebrewScore: 85, hebrewScoreIsPercent: true, translationTotal: 4,
  translationChunkResults: { 0: { verdict: 'correct' }, 1: { verdict: 'correct' }, 2: { verdict: 'incorrect' }, 3: { verdict: 'incorrect' } } };
// A new one-recording attempt: only the audio, until the teacher grades it.
const newAttempt = { timestamp: 5000, combinedAudioStoragePath: 'posukPractice/ann/x.webm', combinedSubmitted: false };
const comprehensionAttempt = { timestamp: 2000, questionTotal: 2, questionResults: { 0: { verdict: 'correct' }, 1: { verdict: 'incorrect' } } };

test('teacher report: an older result keeps its reading and translation scores, side by side, not averaged', () => {
  const api = T();
  const rows = api.buildReportRows({ ann: { Bereishis_1_1: { a: oldAttempt } } }, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hebrewScore, 85);
  assert.equal(rows[0].translationScore, 50);
  assert.equal(rows[0].review, null);
});

test('teacher report: a recording waiting to be sent or graded makes no empty row and does not move the date', () => {
  const api = T();
  const rows = api.buildReportRows({ ann: { Bereishis_1_1: { a: newAttempt }, Bereishis_1_2: { a: oldAttempt, b: newAttempt } } }, {});
  assert.deepEqual(Array.from(rows.map(r => r.posukNum)), [2], 'only the posuk with a result is a row');
  assert.equal(rows[0].timestamp, 1000, 'the date is the older result, not the unscored new recording (5000)');
});

test('teacher report: the teacher\'s grade shows for the posuk, gold and not gold, with a row even though the attempt has no scores', () => {
  const api = T();
  const reviews = { ann: { Bereishis_1_1: { status: 'gold', mistakes: 2, bonus: 3, pointsAwarded: 11, gradedAt: 7000 },
    Bereishis_1_3: { status: 'retry', mistakes: 1, gradedAt: 8000 } } };
  const rows = api.buildReportRows({ ann: { Bereishis_1_1: { a: newAttempt }, Bereishis_1_3: { a: newAttempt } } }, reviews);
  assert.equal(rows.length, 2);
  const gold = rows.find(r => r.posukNum === 1), retry = rows.find(r => r.posukNum === 3);
  assert.equal(gold.review.status, 'gold');
  assert.equal(gold.timestamp, 7000, 'the date is the grade date');
  assert.match(api.gradePlain(gold.review), /Gold · 2 mistakes · \+3 bonus/);
  assert.match(api.gradePlain(retry.review), /Not gold yet · 1 mistake$/);
  assert.match(api.gradeBadge(gold.review), /grade-gold/);
});

test('teacher report: a graded range shows its posukim (the grade is saved per posuk); a pending one shows as waiting', () => {
  const api = T();
  const reviews = { ben: { Bereishis_2_4: { status: 'pending', submittedAt: 9000 }, Bereishis_2_5: { status: 'pending', submittedAt: 9000 } } };
  const rows = api.buildReportRows({ ben: { 'Bereishis_2_4-5': { a: newAttempt } } }, reviews);
  assert.deepEqual(Array.from(rows.map(r => r.posukNum)).sort(), [4, 5]);
  assert.match(api.gradePlain(rows[0].review), /Waiting for grade/);
});

test('teacher report: comprehension is kept as it was and still shows', () => {
  const api = T();
  const rows = api.buildReportRows({ ann: { Bereishis_1_1: { a: comprehensionAttempt } } }, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].comprehensionScore, 50);
});

test('teacher stats: a posuk counts only when it has a result or a grade', () => {
  const api = T();
  const stats = api.computeStudentStats({ Bereishis_1_1: { a: newAttempt }, Bereishis_1_2: { a: oldAttempt } }, { Bereishis_1_1: { status: 'pending' }, Bereishis_1_9: { status: 'gold' } });
  assert.equal(stats.posukCount, 3, 'one with a result, one pending grade, one graded key with no attempt');
  assert.equal(api.computeStudentStats({ Bereishis_1_1: { a: newAttempt } }, {}).posukCount, 0);
});

test('teacher report: the Read & Translate tab shows reading, translation and the grade; Comprehension shows only comprehension', () => {
  const api = T();
  assert.ok(api.scoreShows('readtranslate', 'reading') && api.scoreShows('readtranslate', 'translation'));
  assert.ok(!api.scoreShows('readtranslate', 'comprehension'));
  assert.ok(api.scoreShows('comprehension', 'comprehension') && !api.scoreShows('comprehension', 'reading'));
  assert.ok(api.scoreShows('all', 'reading') && api.scoreShows('all', 'comprehension'));
  assert.match(teacherHtml, /data-skill="readtranslate" aria-selected="true">📖🌐 Read &amp; Translate/);
  assert.match(teacherHtml, /data-skill="comprehension" aria-selected="false">🧠 Comprehension \(Understand tool\)/);
  assert.doesNotMatch(teacherHtml, /data-skill="reading"/);
  assert.doesNotMatch(teacherHtml, /data-skill="translation"/);
  // the Teacher grade column is in the list, by-student, by-posuk, the CSV and the print view
  assert.ok((teacherHtml.match(/Teacher grade/g) || []).length >= 9);
  // by student: reading and translation get an average each, never one mixed number
  assert.match(teacherHtml, /'Read ' \+ \(avgOf\(g\.rows\.map\(r => r\.hebrewScore\)\)[\s\S]*?' · Translate ' \+ \(avgOf\(g\.rows\.map\(r => r\.translationScore\)\)/);
});

test('teacher grades are only read, from the same per-student path the To Grade tab uses', () => {
  assert.match(teacherHtml, /scopedStudentData\('posukPractice\/reviews'\)/);
  assert.doesNotMatch(teacherHtml, /ref\([^)]*posukPractice\/reviews[^)]*\)\.(set|update|remove)/);
  assert.doesNotMatch(progressHtml, /\.ref\([^)]*\)\.(set|update|remove|push)\(/, 'My Progress writes nothing');
});

// ---------- the student's My Progress ----------
const P = () => load(progressHtml, ['readTranslateCell', 'reviewFlag', 'tileHref', 'bestNumeric', 'effHebrewScore', 'effTranslationScore', 'bestComprehensionDisplay'], {
  VERDICT_INFO: { excellent: { tier: 'high', label: 'x' }, correct: { tier: 'high', label: 'x' }, partial: { tier: 'mid', label: 'x' }, incorrect: { tier: 'low', label: 'x' } },
  activeTab: 'readtranslate',
  Number, Math, Object, Array
});

test('My Progress: older reading and translation results are one tile with both scores, not averaged', () => {
  const api = P();
  const cell = api.readTranslateCell([oldAttempt, { timestamp: 1, hebrewScore: 60 }]);
  assert.equal(cell.read, 85, 'the best reading score');
  assert.equal(cell.translate, 50);
  assert.match(cell.html, /📖 Read 85%/);
  assert.match(cell.html, /🌐 Translate 50%/);
  assert.doesNotMatch(cell.html, /67|68%/, 'no average of 85 and 50');
  assert.equal(api.readTranslateCell([newAttempt]), null, 'a recording with no result has no tile');
  assert.equal(api.readTranslateCell([comprehensionAttempt]), null, 'comprehension is not part of this tab');
});

test('My Progress: only reading shows when there is no translation, and only translation when there is no reading', () => {
  const api = P();
  assert.doesNotMatch(api.readTranslateCell([{ hebrewScore: 90 }]).html, /Translate/);
  const onlyTranslate = api.readTranslateCell([{ translationTotal: 1, translationChunkResults: [{ verdict: 'correct' }] }]);
  assert.match(onlyTranslate.html, /Translate 100%/);
  assert.doesNotMatch(onlyTranslate.html, /Read /);
});

test('My Progress: the teacher\'s grade is marked on the posuk, and comprehension opens the Understand tool', () => {
  const api = P();
  assert.equal(api.reviewFlag({ status: 'gold' }), '🏅');
  assert.equal(api.reviewFlag({ status: 'pending' }), '⏳');
  assert.equal(api.reviewFlag({ status: 'retry' }), '🔁');
  assert.equal(api.reviewFlag(null), '');
  assert.match(progressHtml, /loadReviewProgress\(\)\.then\(loadProgress\)/, 'the earlier results are loaded too (they were hidden before)');
  assert.doesNotMatch(progressHtml, /<div id="perekList" class="hidden">/);
  assert.match(progressHtml, /student\.html\?tool=test-me&tab=comprehension&/);
  assert.match(progressHtml, /id="readTranslateTabBtn"/);
  assert.doesNotMatch(progressHtml, /readingTabBtn|translateTabBtn/);
  // old results are still read, never changed
  assert.match(progressHtml, /db\.ref\('posukPractice\/attempts\/' \+ studentId\)\.once\('value'\)/);
});

test('teacher report: each tab lists only the posukim that have something for it', () => {
  const api = T();
  const rows = api.buildReportRows({ ann: { Bereishis_1_1: { a: oldAttempt }, Bereishis_1_3: { a: comprehensionAttempt } } }, { ann: { Bereishis_1_4: { status: 'retry', mistakes: 1, gradedAt: 5 } } });
  const keep = type => Array.from(rows.filter(r => api.rowHasResult(r, type)).map(r => r.posukNum));
  assert.deepEqual(keep('readtranslate'), [1, 4]);
  assert.deepEqual(keep('comprehension'), [3]);
  assert.deepEqual(keep('all'), [1, 3, 4]);
  assert.equal(teacherHtml.split('rows = rows.filter(r => rowHasResult(r, scoreType));').length - 1, 2, 'the flat list and by-student views');
});
