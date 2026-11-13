// Posuk Practice teacher review (Issue #694): one recording, teacher grading,
// gold-standard lock, and points that may take a balance below zero.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const core = require('../backend/functions/posuk-review-core.cjs');

function fakeDb(initial = {}){
  const root = JSON.parse(JSON.stringify(initial));
  const parts = p => p.split('/').filter(Boolean);
  const read = p => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), root);
  const write = (p, v) => {
    const ks = parts(p); let o = root;
    ks.slice(0, -1).forEach(k => { if(o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    if(v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  const snap = v => ({ val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))), exists: () => v !== undefined && v !== null });
  return { root, ref(p){ return {
    async get(){ return snap(read(p)); },
    async set(v){ write(p, v); },
    async update(v){ Object.entries(v).forEach(([k, x]) => write(p + '/' + k, x)); },
    async transaction(fn){
      // Like the Admin SDK: first call may see null (cold cache), then the real value.
      const cur = read(p);
      if(cur !== undefined && cur !== null){ const guess = fn(null); if(guess === undefined){ /* aborted on null guess: retry with real */ } }
      const next = fn(cur === undefined ? null : JSON.parse(JSON.stringify(cur)));
      if(next === undefined) return { committed:false, snapshot: snap(read(p)) };
      write(p, next); return { committed:true, snapshot: snap(read(p)) };
    }
  }; } };
}

const SID = 'stu1', KEY = 'Vayeitzei_29_5';
function setup({ balance = 0, now = 1_000_000, attempt = true, keyOverride } = {}){
  const key = keyOverride || KEY;
  const init = { studentRewards: { students: { rw1: { rewardBalance: balance, name: 'Dovid' } } }, posukPractice: { attempts: {} } };
  if(attempt) init.posukPractice.attempts[SID] = { [key]: { a1: { combinedAudioStoragePath: `posukPractice/${SID}/${key}_combined_a1.webm`, combinedDurationMs: 9000 } } };
  const db = fakeDb(init);
  let t = now;
  const review = core.createPosukReview({ rtdb: db, now: () => t, resolveRewardStudentId: async () => 'rw1',
    studentInfo: async id => ({ name: 'Dovid', classId: 'et' }), fileExists: async () => true });
  return { db, review, key, setNow: v => { t = v; }, balance: () => db.root.studentRewards.students.rw1.rewardBalance };
}
const teacherScope = { students: { [SID]: { classId: 'et', classIds: ['et'] } }, selected: 'et', owner: false };

test('selection keys expand to every posuk', () => {
  assert.deepEqual(core.posukKeysForSelection('Vayeitzei_29_5-7').keys, ['Vayeitzei_29_5', 'Vayeitzei_29_6', 'Vayeitzei_29_7']);
  assert.deepEqual(core.posukKeysForSelection('Chayei_Sarah_23_1').keys, ['Chayei_Sarah_23_1']);
  assert.equal(core.posukKeysForSelection('../x_1_1'), null);
  assert.equal(core.posukKeysForSelection('Bereishis_1_9-3'), null);
});

test('points: gold = 10 minus mistakes (not below 0) plus bonus; not gold = 0', () => {
  assert.equal(core.pointsForGrade({ gold: true, mistakes: 0, bonus: 0 }), 10);
  assert.equal(core.pointsForGrade({ gold: true, mistakes: 3, bonus: 0 }), 7);
  assert.equal(core.pointsForGrade({ gold: true, mistakes: 14, bonus: 0 }), 0);
  assert.equal(core.pointsForGrade({ gold: true, mistakes: 1, bonus: 25 }), 34);
  assert.equal(core.pointsForGrade({ gold: false, mistakes: 0, bonus: 0 }), 0);
});

test('submit charges 5 points and the balance may go negative', async () => {
  const s = setup({ balance: 2 });
  const r = await s.review.submit({ studentId: SID, classId: 'et', selectionKey: s.key, attemptId: 'a1', hebrewText: 'וַיְהִי' });
  assert.equal(r.ok, true); assert.equal(r.pointsCharged, 5);
  assert.equal(s.balance(), -3);
  assert.equal(s.db.root.posukPractice.reviews[SID][KEY].status, 'pending');
  assert.equal(s.db.root.posukPractice.submissions[SID].a1.status, 'pending');
  const pr = s.db.root.studentRewards.pointRequests[`posuksubmit_${SID}_a1`];
  assert.equal(pr.status, 'approved'); assert.equal(pr.actualAmount, -5); assert.equal(pr.source, 'posuk-submit');
});

test('submitting the same attempt twice charges once', async () => {
  const s = setup({ balance: 10 });
  await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' });
  const again = await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' });
  assert.equal(again.alreadySubmitted, true); assert.equal(s.balance(), 5);
});

test('no new submission while one is waiting for the teacher', async () => {
  const s = setup({ balance: 10 });
  await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' });
  s.db.root.posukPractice.attempts[SID][KEY].a2 = { combinedAudioStoragePath: `posukPractice/${SID}/${KEY}_combined_a2.webm` };
  await assert.rejects(s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a2' }), /waiting for your teacher/);
  assert.equal(s.balance(), 5);
  // A range that overlaps the pending posuk is blocked too.
  s.db.root.posukPractice.attempts[SID]['Vayeitzei_29_4-6'] = { r1: { combinedAudioStoragePath: `posukPractice/${SID}/x_r1.webm` } };
  await assert.rejects(s.review.submit({ studentId: SID, selectionKey: 'Vayeitzei_29_4-6', attemptId: 'r1' }), /waiting/);
});

test('a recording must be the student\'s own saved file', async () => {
  const s = setup();
  s.db.root.posukPractice.attempts[SID][KEY].a1.combinedAudioStoragePath = 'posukPractice/otherKid/x.webm';
  await assert.rejects(s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' }), /does not belong/);
  const s2 = setup({ attempt: false });
  await assert.rejects(s2.review.submit({ studentId: SID, selectionKey: s2.key, attemptId: 'a1' }), /not saved/);
});

test('not gold: no points, student may retry', async () => {
  const s = setup({ balance: 10 });
  await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' });
  const g = await s.review.grade({ teacherEmail: 't@x', scope: teacherScope, studentId: SID, submissionId: 'a1', gold: false, mistakes: 4 });
  assert.equal(g.points, 0); assert.equal(s.balance(), 5);
  assert.equal(s.db.root.posukPractice.reviews[SID][KEY].status, 'retry');
  s.db.root.posukPractice.attempts[SID][KEY].a2 = { combinedAudioStoragePath: `posukPractice/${SID}/${KEY}_combined_a2.webm` };
  const again = await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a2' });
  assert.equal(again.ok, true); assert.equal(s.balance(), 0);
});

test('gold: +10 −mistakes +bonus from a negative balance, locked for a month', async () => {
  const s = setup({ balance: 0 });
  await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' });
  assert.equal(s.balance(), -5);
  const g = await s.review.grade({ teacherEmail: 't@x', scope: teacherScope, studentId: SID, submissionId: 'a1', gold: true, mistakes: 2, bonus: 50 });
  assert.equal(g.points, 58); assert.equal(s.balance(), 53);
  const row = s.db.root.posukPractice.reviews[SID][KEY];
  assert.equal(row.status, 'gold'); assert.equal(row.bonus, 50);
  assert.equal(row.lockedUntil, 1_000_000 + core.LOCK_MS);
  s.db.root.posukPractice.attempts[SID][KEY].a2 = { combinedAudioStoragePath: `posukPractice/${SID}/${KEY}_combined_a2.webm` };
  await assert.rejects(s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a2' }), /locked until/);
  s.setNow(1_000_000 + core.LOCK_MS + 1);
  const later = await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a2' });
  assert.equal(later.ok, true);
});

test('a grade is saved once; bonus only with gold; teacher must have the student', async () => {
  const s = setup({ balance: 0 });
  await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' });
  await assert.rejects(s.review.grade({ scope: teacherScope, studentId: SID, submissionId: 'a1', gold: false, bonus: 5 }), /only be given with gold/);
  await assert.rejects(s.review.grade({ scope: { students: {}, selected: 'wt' }, studentId: SID, submissionId: 'a1', gold: true }), /does not belong/);
  await assert.rejects(s.review.grade({ scope: teacherScope, studentId: SID, submissionId: 'a1', gold: true, mistakes: -1 }), /Mistakes/);
  await s.review.grade({ scope: teacherScope, studentId: SID, submissionId: 'a1', gold: true });
  await assert.rejects(s.review.grade({ scope: teacherScope, studentId: SID, submissionId: 'a1', gold: true }), /already graded/);
  assert.equal(s.balance(), 5);
});

test('word marks: saved with the grade as [{i, word, mark}]; nothing tapped = none (Issue #749)', async () => {
  const s = setup({ balance: 0 });
  await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1', hebrewText: '  וַיֹּאמֶר  לָהֶם יַעֲקֹב אַחַי ' });
  const bad = m => s.review.grade({ scope: teacherScope, studentId: SID, submissionId: 'a1', gold: true, wordMarks: m });
  await assert.rejects(bad({ 4: 'incorrect' }), /does not match the posuk/);
  await assert.rejects(bad({ 0: 'made-up' }), /Unknown word mark/);
  await assert.rejects(bad({ '-1': 'incorrect' }), /does not match the posuk/);
  await assert.rejects(bad(['incorrect']), /not valid/);
  assert.equal(s.db.root.posukPractice.submissions[SID].a1.status, 'pending');
  const g = await s.review.grade({ teacherEmail: 't@x', scope: teacherScope, studentId: SID, submissionId: 'a1', gold: true, mistakes: 2,
    wordMarks: { 3: 'skipped', 1: 'readOkTransWrong' } });
  assert.equal(g.points, 8);
  assert.deepEqual(s.db.root.posukPractice.submissions[SID].a1.wordMarks,
    [{ i: 1, word: 'לָהֶם', mark: 'readOkTransWrong' }, { i: 3, word: 'אַחַי', mark: 'skipped' }]);

  const none = setup({ balance: 0 });
  await none.review.submit({ studentId: SID, selectionKey: none.key, attemptId: 'a1', hebrewText: 'וַיֹּאמֶר לָהֶם' });
  const all = await none.review.grade({ scope: teacherScope, studentId: SID, submissionId: 'a1', gold: true, mistakes: 0, wordMarks: {} });
  assert.equal(all.points, 10);
  assert.equal(none.db.root.posukPractice.submissions[SID].a1.status, 'gold');
  assert.equal(none.db.root.posukPractice.submissions[SID].a1.wordMarks ?? null, null);
});

test('word marks: the page and the server agree on the mark ids, staging copy included', () => {
  const page = require('../record_pesukim/word-marks.js');
  assert.deepEqual(page.MARKS.map(m => m.id), [...core.WORD_MARKS]);
  assert.equal(page.MARKS[0].id, 'incorrect');
  assert.equal(new Set(page.MARKS.map(m => m.color)).size, page.MARKS.length);
  assert.deepEqual(page.splitWords('  א  ב\tג '), ['א', 'ב', 'ג']);
  assert.equal(fs.readFileSync('backend/functions-staging/posuk-review-core.cjs', 'utf8'), fs.readFileSync('backend/functions/posuk-review-core.cjs', 'utf8'));
  for(const f of ['backend/functions/student-rewards-auto-award.js', 'backend/functions-staging/student-rewards-auto-award.js'])
    assert.match(fs.readFileSync(f, 'utf8'), /wordMarks:body\.wordMarks/);
  const teacher = fs.readFileSync('record_pesukim/teacher.html', 'utf8');
  assert.match(teacher, /word-marks\.js/);
  assert.match(teacher, /wordMarks: marks/);
  assert.match(teacher, /let choice = 'gold'/);
});

test('word marks: tapping a word means read wrong, tapping its T means translation wrong', () => {
  const page = require('../record_pesukim/word-marks.js');
  assert.equal(page.markFor(false, false), '');
  assert.equal(page.markFor(true, false), 'readWrongTransOk');
  assert.equal(page.markFor(false, true), 'readOkTransWrong');
  assert.equal(page.markFor(true, true), 'bothWrong');
  // Every mark the page can produce is one the server accepts, and it round-trips.
  for(const [read, trans] of [[true, false], [false, true], [true, true]]){
    const id = page.markFor(read, trans);
    assert.ok(core.WORD_MARKS.includes(id));
    assert.deepEqual(page.flags(id), { read, trans });
  }
  assert.deepEqual(page.flags(''), { read: false, trans: false });
  const teacher = fs.readFileSync('record_pesukim/teacher.html', 'utf8');
  assert.match(teacher, /class="grade-word" data-word=/);
  assert.match(teacher, /class="grade-t" data-trans=/);
  assert.ok(teacher.includes('PosukWordMarks.markFor(readWrong.has(n), transWrong.has(n))'));
  // The marking-mode dropdown is gone.
  assert.doesNotMatch(teacher, /data-field="mode"|Marking mode|legendHtml/);
});

test('word marks: the student sees the whole posuk in order with the marked words flagged', () => {
  const page = require('../record_pesukim/word-marks.js');
  const hebrew = 'וַיֹּאמֶר לָהֶם יַעֲקֹב אַחַי מֵאַיִן אַתֶּם';
  const words = page.splitWords(hebrew);
  const marks = core.cleanWordMarks({ 1: 'readWrongTransOk', 3: 'readOkTransWrong', 4: 'bothWrong' }, hebrew);
  const html = page.feedbackHtml(hebrew, marks);
  // Right to left, every word present once, in posuk order, nikud untouched.
  assert.match(html, /class="wm-fb-posuk" dir="rtl" lang="he"/);
  let at = -1;
  for(const w of words){ const next = html.indexOf('>' + w, at + 1); assert.ok(next > at, w + ' is in order'); at = next; }
  assert.equal((html.match(/class="wm-fb-word/g) || []).length, words.length);
  // Reading and translation are told apart; a word can have both.
  assert.match(html, new RegExp('wm-fb-read"[^>]*>' + words[1]));
  assert.match(html, new RegExp('wm-fb-trans"[^>]*>' + words[3]));
  assert.match(html, new RegExp('wm-fb-both"[^>]*>' + words[4]));
  assert.match(html, /2 words read wrong · 2 words translated wrong/);
  assert.doesNotMatch(html, new RegExp('wm-fb-(read|trans|both)"[^>]*>' + words[0]));
  // Nothing marked, or a grade saved before word marks existed: nothing extra shown.
  assert.equal(page.feedbackHtml(hebrew, null), '');
  assert.equal(page.feedbackHtml(hebrew, undefined), '');
  assert.equal(page.feedbackHtml(hebrew, []), '');
  // Marks that do not line up with the saved Hebrew fall back to chips, never a wrong highlight.
  const off = page.feedbackHtml('אחד שתים', [{ i: 5, word: 'שלש', mark: 'bothWrong' }]);
  assert.match(off, /wm-chip/); assert.doesNotMatch(off, /wm-fb-posuk/);
  // Text is escaped.
  assert.doesNotMatch(page.feedbackHtml('<b>x</b> y', [{ i: 0, word: '<b>x</b>', mark: 'incorrect' }]), /<b>x/);
  const student = fs.readFileSync('record_pesukim/student.html', 'utf8');
  assert.match(student, /<script src="word-marks\.js\?v=/);
  assert.match(student, /PosukWordMarks\.feedbackHtml\(x\.hebrewText, x\.wordMarks\)/);
});

test('rules: students and the browser can never write submissions or reviews', () => {
  for(const file of ['firebase-rules.json', 'firebase-rules.hardened.json', 'staging/database.rules.json']){
    const pp = JSON.parse(fs.readFileSync(file, 'utf8')).rules.posukPractice;
    for(const node of ['submissions', 'reviews']){
      assert.ok(pp[node], file + ' has ' + node);
      assert.equal(pp[node].$studentId['.write'], false, file + ' ' + node + ' is server-only');
      assert.match(pp[node].$studentId['.read'], /b3StudentId == \$studentId/);
    }
  }
});

test('the rewards function routes the new actions with the right checks', () => {
  const src = fs.readFileSync('backend/functions/student-rewards-auto-award.js', 'utf8');
  assert.match(src, /action==="posuk-submit"[\s\S]{0,200}requirePracticeStudent/);
  assert.match(src, /'posuk-grade'\]/);
  assert.match(src, /act\.startsWith\('posuk-'\)\?'posuk-practice-scroll'/);
  assert.equal(require('../backend/functions/student-practice-auth.cjs').toolForSource('posuk-submit'), 'posuk-practice-scroll');
});

test('pages: Posuk Practice has no AI grading calls on its path; Chumash חידון keeps Understand', () => {
  const html = fs.readFileSync('record_pesukim/student.html', 'utf8');
  // Quiz mode (the live Chumash חידון tile, #693) is the one Understand mode; old ?tool=test-me links map to it.
  assert.match(html, /B3_QUIZ_MODE = p\.get\('mode'\) === 'quiz' \|\| p\.get\('tool'\) === 'test-me'/);
  assert.match(html, /POSUK_TOOL_MODE = window\.B3_QUIZ_MODE \? 'test-me' : 'practice'/);
  assert.match(html, /if\(window\.POSUK_TOOL_MODE === 'practice'\) return;\s*\n\s*\n\s*const msg = document\.getElementById\('comprehensionGradingMsg'\)/);
  assert.doesNotMatch(html, /\n\s*loadOrGenerateTranslationChunks\(\);\n\}/);
  assert.doesNotMatch(html, /\n  wakeScorer\(\);/);
  assert.match(html, /action:'posuk-submit'/);
  const index = fs.readFileSync('index.html', 'utf8');
  assert.match(index, /href="record_pesukim\/student\.html\?mode=quiz"[^>]*>.*Chumash חידון/);
  assert.doesNotMatch(index, /Chumash Test Me/);
});

test('staging functions carry the same Posuk review actions and never use the production bucket', () => {
  const norm = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(norm('backend/functions-staging/posuk-review-core.cjs'), norm('backend/functions/posuk-review-core.cjs'));
  const staging = norm('backend/functions-staging/student-rewards-auto-award.js');
  assert.match(staging, /action==="posuk-submit"/);
  assert.match(staging, /action==="posuk-grade"/);
  assert.match(staging, /'teacher-set-recording-full-review','posuk-grade'\]/);
  assert.match(staging, /act\.startsWith\('posuk-'\)\?'posuk-practice-scroll'/);
  assert.doesNotMatch(staging, /b3-games\.firebasestorage\.app/);
  assert.equal(require('../backend/functions-staging/student-practice-auth.cjs').toolForSource('posuk-submit'), 'posuk-practice-scroll');
});
