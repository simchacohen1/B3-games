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

test('points: the grade is the points, minus what was already earned on the posuk', () => {
  assert.equal(core.pointsForGrade({ score: 10 }), 10);
  assert.equal(core.pointsForGrade({ score: 7 }), 7);
  assert.equal(core.pointsForGrade({ score: 10, prior: 6 }), 4);
  assert.equal(core.pointsForGrade({ score: 4, prior: 6 }), 0);
  assert.equal(core.statusForScore(10), 'gold'); assert.equal(core.statusForScore(3), 'scored'); assert.equal(core.statusForScore(0), 'retry');
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

async function sendAttempt(s, id){
  s.db.root.posukPractice.attempts[SID][s.key] = { ...(s.db.root.posukPractice.attempts[SID][s.key] || {}), [id]: { combinedAudioStoragePath: `posukPractice/${SID}/${s.key}_combined_${id}.webm` } };
  return s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: id });
}
const grade = (s, id, points) => s.review.grade({ teacherEmail: 't@x', scope: teacherScope, studentId: SID, submissionId: id, points });

test('0: no points, student may retry', async () => {
  const s = setup({ balance: 10 });
  await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' });
  const g = await grade(s, 'a1', 0);
  assert.equal(g.points, 0); assert.equal(s.balance(), 5);
  const sub = s.db.root.posukPractice.submissions[SID].a1;
  assert.equal(sub.score, 0); assert.equal(s.db.root.posukPractice.reviews[SID][KEY].status, 'retry');
  const again = await sendAttempt(s, 'a2');
  assert.equal(again.ok, true); assert.equal(s.balance(), 0);
});

test('10: +10 points from a negative balance, locked for a month', async () => {
  const s = setup({ balance: 0 });
  await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' });
  assert.equal(s.balance(), -5);
  const g = await grade(s, 'a1', 10);
  assert.equal(g.points, 10); assert.equal(s.balance(), 5);
  const row = s.db.root.posukPractice.reviews[SID][KEY];
  assert.equal(row.status, 'gold'); assert.equal(row.score, 10);
  assert.equal(row.lockedUntil, 1_000_000 + core.LOCK_MS);
  await assert.rejects(sendAttempt(s, 'a2'), /locked until/);
  s.setNow(1_000_000 + core.LOCK_MS + 1);
  assert.equal((await sendAttempt(s, 'a2')).ok, true);
});

test('1-9: points equal the grade, no lock', async () => {
  const s = setup({ balance: 5 });
  await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' });
  const g = await grade(s, 'a1', 7);
  assert.equal(g.points, 7); assert.equal(g.status, 'scored'); assert.equal(s.balance(), 7);
  const row = s.db.root.posukPractice.reviews[SID][KEY];
  assert.equal(row.status, 'scored'); assert.equal(row.lockedUntil, null);
  assert.equal((await sendAttempt(s, 'a2')).ok, true);
});

test('the teacher can change a grade: only the difference moves, the lock follows', async () => {
  const s = setup({ balance: 5 });
  await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' });   // balance 0
  await grade(s, 'a1', 6);  assert.equal(s.balance(), 6);
  await grade(s, 'a1', 10); assert.equal(s.balance(), 10);
  assert.equal(s.db.root.posukPractice.reviews[SID][KEY].status, 'gold');
  const lower = await grade(s, 'a1', 8); assert.equal(lower.points, -2); assert.equal(s.balance(), 8);
  const row = s.db.root.posukPractice.reviews[SID][KEY];
  assert.equal(row.status, 'scored'); assert.equal(row.lockedUntil, null);   // lock removed
  const same = await grade(s, 'a1', 8); assert.equal(same.points, 0); assert.equal(s.balance(), 8);
  await grade(s, 'a1', 0); assert.equal(s.balance(), 0);
  assert.equal(s.db.root.posukPractice.submissions[SID].a1.score, 0);
  assert.equal(s.db.root.posukPractice.submissions[SID].a1.pointsPaid, 0);
});

test('re-record pays only the difference from the best earlier grade', async () => {
  const s = setup({ balance: 20 });
  await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' });   // 15
  await grade(s, 'a1', 6); assert.equal(s.balance(), 21);
  await sendAttempt(s, 'a2'); assert.equal(s.balance(), 16);
  const g = await grade(s, 'a2', 10); assert.equal(g.points, 4); assert.equal(s.balance(), 20);
  await grade(s, 'a2', 5); assert.equal(s.balance(), 16);   // 5 is below the 6 already earned: nothing paid for this recording
  await grade(s, 'a2', 9); assert.equal(s.balance(), 19);   // 9 - 6 = 3
});

test('grade checks: whole number 0-10, teacher must have the student, deleted cannot be graded', async () => {
  const s = setup({ balance: 0 });
  await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' });
  await assert.rejects(grade(s, 'a1', 11), /0 to 10/);
  await assert.rejects(grade(s, 'a1', -1), /0 to 10/);
  await assert.rejects(grade(s, 'a1', 7.5), /0 to 10/);
  await assert.rejects(s.review.grade({ scope: { students: {}, selected: 'wt' }, studentId: SID, submissionId: 'a1', points: 5 }), /does not belong/);
  assert.equal(s.balance(), -5);
});

test('Delete: refunds the 5 points, no lock, only while ungraded', async () => {
  const s = setup({ balance: 5 });
  await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' });
  const d = await s.review.discard({ teacherEmail: 't@x', scope: teacherScope, studentId: SID, submissionId: 'a1' });
  assert.equal(d.refunded, 5); assert.equal(s.balance(), 5);
  assert.equal(s.db.root.posukPractice.submissions[SID].a1.status, 'deleted');
  assert.equal(s.db.root.posukPractice.reviews && s.db.root.posukPractice.reviews[SID], undefined);
  await assert.rejects(grade(s, 'a1', 5), /deleted/);
  await sendAttempt(s, 'a2');
  await grade(s, 'a2', 3);
  await assert.rejects(s.review.discard({ scope: teacherScope, studentId: SID, submissionId: 'a2' }), /already graded/);
});

test('old cached pages (gold + mistakes) still grade', async () => {
  const s = setup({ balance: 0 });
  await s.review.submit({ studentId: SID, selectionKey: s.key, attemptId: 'a1' });
  const g = await s.review.grade({ scope: teacherScope, studentId: SID, submissionId: 'a1', gold: true, mistakes: 2 });
  assert.equal(g.points, 8); assert.equal(g.score, 8);
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
  assert.match(src, /'posuk-grade','posuk-delete'\]/);
  assert.match(src, /action==="posuk-delete"[\s\S]{0,200}posukReview\.discard/);
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
  const index = require('./render-home-html.cjs')();
  assert.match(index, /href="record_pesukim\/student\.html\?mode=quiz"[^>]*>.*Chumash חידון/);
  assert.doesNotMatch(index, /Chumash Test Me/);
});

test('staging functions carry the same Posuk review actions and never use the production bucket', () => {
  const norm = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(norm('backend/functions-staging/posuk-review-core.cjs'), norm('backend/functions/posuk-review-core.cjs'));
  const staging = norm('backend/functions-staging/student-rewards-auto-award.js');
  assert.match(staging, /action==="posuk-submit"/);
  assert.match(staging, /action==="posuk-grade"/);
  assert.match(staging, /'teacher-set-recording-full-review','posuk-grade','posuk-delete'\]/);
  assert.match(staging, /action==="posuk-delete"/);
  assert.match(staging, /act\.startsWith\('posuk-'\)\?'posuk-practice-scroll'/);
  assert.doesNotMatch(staging, /b3-games\.firebasestorage\.app/);
  assert.equal(require('../backend/functions-staging/student-practice-auth.cjs').toolForSource('posuk-submit'), 'posuk-practice-scroll');
});
