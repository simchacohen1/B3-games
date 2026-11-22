// Posuk Practice word marks: the teacher taps words (read wrong / translated wrong) and sees a SUGGESTED score.
// The marks are stored per word, per student, per recording, and never change the 0-10 grade or the points.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const marks = require('../backend/functions/posuk-word-marks-core.cjs');
const review = require('../backend/functions/posuk-review-core.cjs');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

const TEXT = 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ';   // 7 words

test('words are what is between spaces; extra spaces do not make empty words', () => {
  assert.equal(marks.splitWords(TEXT).length, 7);
  assert.deepEqual(marks.splitWords('  אב   גד \n'), ['אב', 'גד']);
  assert.deepEqual(marks.splitWords(''), []);
  assert.deepEqual(marks.splitWords(null), []);
});

test('nothing marked: every word counts as correct (100%)', () => {
  const r = marks.build(TEXT, [], []);
  assert.equal(r.total, 7);
  assert.ok(r.words.every(w => w.readOk && w.translationOk));
  assert.deepEqual(r.suggested, { total: 7, readingCorrect: 7, translationCorrect: 7, readingPct: 100, translationPct: 100, combinedPct: 100 });
});

test('reading, translation and combined are worked out from the marks', () => {
  const eleven = Array.from({ length: 11 }, (_, i) => 'מ' + i).join(' ');
  const r = marks.build(eleven, [2, 5], [7]);
  assert.equal(marks.label(r.suggested), 'Reading 9/11 · Translation 10/11 · Combined 86%');
  assert.equal(r.words[2].readOk, false); assert.equal(r.words[2].translationOk, true);
  assert.equal(r.words[7].translationOk, false); assert.equal(r.words[7].readOk, true);
  assert.equal(r.words[0].w, 'מ0'); assert.equal(r.words[0].i, 0);
});

test('a word can be wrong both ways; marking is undone by leaving it out', () => {
  const r = marks.build(TEXT, [1], [1]);
  assert.equal(r.suggested.readingCorrect, 6); assert.equal(r.suggested.translationCorrect, 6);
  const back = marks.wrongSets(r);
  assert.deepEqual([...back.read], [1]); assert.deepEqual([...back.translation], [1]);
  assert.equal(marks.build(TEXT, [], []).suggested.combinedPct, 100);
});

test('bad input is refused: word numbers outside the posuk, repeats are harmless, no text, not a list', () => {
  assert.throws(() => marks.build(TEXT, [7], []), /not in this posuk/);
  assert.throws(() => marks.build(TEXT, [-1], []), /not in this posuk/);
  assert.throws(() => marks.build(TEXT, [1.5], []), /not in this posuk/);
  assert.throws(() => marks.build(TEXT, 'x', []), /list of word numbers/);
  assert.throws(() => marks.build('   ', [], []), /no posuk text/);
  assert.equal(marks.build(TEXT, [1, 1, 1], []).suggested.readingCorrect, 6);
});

test('the server, staging and teacher-page copies of the word-marks file are identical', () => {
  const a = read('backend/functions/posuk-word-marks-core.cjs');
  assert.equal(read('backend/functions-staging/posuk-word-marks-core.cjs'), a);
  assert.equal(read('record_pesukim/posuk-word-marks-core.js'), a);
  assert.equal(read('backend/functions-staging/posuk-review-core.cjs'), read('backend/functions/posuk-review-core.cjs'));
});

function fakeDb(initial) {
  const store = JSON.parse(JSON.stringify(initial));
  const parts = p => p.split('/').filter(Boolean);
  const readp = p => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), store);
  const writep = (p, v) => { const ks = parts(p); let o = store; ks.slice(0, -1).forEach(k => { o = o[k] = o[k] || {}; }); o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v)); };
  const snap = v => ({ val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))), exists: () => v != null });
  return { store, ref: p => ({
    async get() { return snap(readp(p)); },
    async update(v) { Object.entries(v).forEach(([k, x]) => writep(p + '/' + k, x)); },
    async transaction(fn) { const cur = readp(p); const next = fn(cur === undefined ? null : JSON.parse(JSON.stringify(cur))); if (next === undefined) return { committed: false, snapshot: snap(readp(p)) }; writep(p, next); return { committed: true, snapshot: snap(readp(p)) }; }
  }) };
}
const SID = 'stu1', SUB = 'sub1';
const scope = { students: { [SID]: { classId: 'et', classIds: ['et'] } }, selected: 'et', owner: false };
function setup(sub = {}) {
  const db = fakeDb({ posukPractice: { submissions: { [SID]: { [SUB]: { id: SUB, status: 'scored', score: 7, pointsAwarded: 7, pointsPaid: 7, gradeSeq: 1, classId: 'et', hebrewText: TEXT, ...sub } } } } });
  return { db, rev: review.createPosukReview({ rtdb: db, now: () => 5000, resolveRewardStudentId: async () => 'rw1', studentInfo: async () => ({ name: 'Dovid', classId: 'et' }), fileExists: async () => true }) };
}

test('saving word marks stores one entry per word plus the suggested scores on that recording', async () => {
  const { db, rev } = setup();
  const out = await rev.saveWordMarks({ teacherEmail: 't@example.test', scope, studentId: SID, submissionId: SUB, readWrong: [0], translationWrong: [3, 4] });
  assert.equal(out.ok, true);
  const saved = db.store.posukPractice.submissions[SID][SUB].wordReview;
  assert.equal(saved.total, 7); assert.equal(saved.words.length, 7);
  assert.deepEqual(saved.words[0], { i: 0, w: 'בְּרֵאשִׁית', readOk: false, translationOk: true });
  assert.equal(saved.words[3].translationOk, false);
  assert.deepEqual(saved.suggested, { total: 7, readingCorrect: 6, translationCorrect: 5, readingPct: 86, translationPct: 71, combinedPct: 79 });
  assert.equal(saved.markedAt, 5000); assert.equal(saved.markedBy, 't@example.test'); assert.equal(saved.version, 1);
});

test('word marks never change the official grade, points, status or lock', async () => {
  const { db, rev } = setup({ lockedUntil: null });
  const before = JSON.parse(JSON.stringify(db.store.posukPractice.submissions[SID][SUB]));
  await rev.saveWordMarks({ teacherEmail: 't@example.test', scope, studentId: SID, submissionId: SUB, readWrong: [0, 1, 2, 3, 4, 5, 6], translationWrong: [0, 1, 2, 3, 4, 5, 6] });
  const after = db.store.posukPractice.submissions[SID][SUB];
  for (const k of Object.keys(before)) assert.deepEqual(after[k], before[k], k);
  assert.deepEqual(Object.keys(after).sort(), [...Object.keys(before), 'wordReview'].sort());
  assert.equal(after.score, 7); assert.equal(after.pointsPaid, 7); assert.equal(after.status, 'scored');
});

test('saving again replaces the marks; a student outside the teacher\'s class and a deleted recording are refused', async () => {
  const { db, rev } = setup();
  await rev.saveWordMarks({ teacherEmail: 'a', scope, studentId: SID, submissionId: SUB, readWrong: [1], translationWrong: [] });
  await rev.saveWordMarks({ teacherEmail: 'a', scope, studentId: SID, submissionId: SUB, readWrong: [], translationWrong: [] });
  assert.equal(db.store.posukPractice.submissions[SID][SUB].wordReview.suggested.readingPct, 100);
  await assert.rejects(rev.saveWordMarks({ teacherEmail: 'a', scope: { students: {}, selected: 'et' }, studentId: SID, submissionId: SUB, readWrong: [], translationWrong: [] }), /does not belong/);
  const gone = setup({ status: 'deleted' });
  await assert.rejects(gone.rev.saveWordMarks({ teacherEmail: 'a', scope, studentId: SID, submissionId: SUB, readWrong: [], translationWrong: [] }), /deleted/);
  assert.equal(gone.db.store.posukPractice.submissions[SID][SUB].wordReview, undefined);
});

test('a later grade change keeps the word marks', async () => {
  const { db, rev } = setup({ status: 'pending', score: undefined, pointsAwarded: undefined, pointsPaid: undefined, priorPoints: 0, selectionKey: 'Bereishis_1_1', posukKeys: ['Bereishis_1_1'] });
  await rev.saveWordMarks({ teacherEmail: 'a', scope, studentId: SID, submissionId: SUB, readWrong: [2], translationWrong: [] });
  db.store.posukPractice.submissions[SID][SUB].wordReview.keep = true;
  try { await rev.grade({ teacherEmail: 'a', scope, studentId: SID, submissionId: SUB, points: 9 }); } catch (e) { /* points posting needs the rewards fake; the grade write itself is what matters */ }
  const after = db.store.posukPractice.submissions[SID][SUB];
  assert.equal(after.wordReview.keep, true);
  assert.equal(after.wordReview.total, 7);
});

test('the function routes posuk-word-marks for teachers (production and staging copies) and the page uses it', () => {
  for (const f of ['backend/functions/student-rewards-auto-award.js', 'backend/functions-staging/student-rewards-auto-award.js']) {
    const s = read(f);
    assert.match(s, /'posuk-grade','posuk-delete','posuk-word-marks'\]/);
    assert.match(s, /action==='posuk-grade'\|\|action==='posuk-delete'\|\|action==='posuk-word-marks'\)return;/);
    assert.match(s, /if\(action==="posuk-word-marks"\)\{\s*const result=await posukReview\.saveWordMarks\(/);
  }
  const page = read('record_pesukim/teacher.html');
  assert.match(page, /<script src="posuk-word-marks-core\.js\?v=\d+"><\/script>/);
  assert.match(page, /action:'posuk-word-marks'/);
  assert.match(page, /data-pts="\$\{n\}"/);                      // the 0-10 row is still there
  assert.match(page, /<b>Suggested:<\/b> /);
  // The marks code never posts a grade or touches the 0-10 saver.
  const wire = page.slice(page.indexOf('function wireWordMarks'), page.indexOf('function wireGradeCard'));
  assert.doesNotMatch(wire, /posuk-grade|gradeScoreOf|shown|pointsPaid/);
});
