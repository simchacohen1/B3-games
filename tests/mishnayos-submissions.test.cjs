const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const core = require('../backend/functions/mishnayos-submissions-core.cjs');
const scopeLib = require('../backend/functions/teacher-class-scope.js');

const NOW = Date.parse('2026-11-09T15:00:00Z');
const KEY = 'berachos_1_2'; // 6 lines

function db(tree) {
  const parts = p => p.split('/').filter(Boolean);
  const get = async p => { const v = parts(p).reduce((o, k) => o?.[k], tree); return v === undefined ? null : structuredClone(v); };
  const set = (p, v) => { const k = parts(p), last = k.pop(); let o = tree; for (const x of k) o = o[x] ??= {}; if (v === null || v === undefined) delete o[last]; else o[last] = structuredClone(v); };
  return { tree, get, update: async u => { for (const [p, v] of Object.entries(u)) set(p, v); },
    tx: async (p, f) => { const v = f(await get(p)); if (v !== undefined) set(p, v); return { committed: v !== undefined, snapshot: { val: () => v } }; } };
}
function bucket(paths = []) {
  const set = new Set(paths);
  return { set, exists: async p => set.has(p), copy: async (a, b) => { if (!set.has(a)) throw new Error('missing'); set.add(b); }, remove: async p => { set.delete(p); } };
}
const google = (uid, email) => ({ uid, email, email_verified: true, firebase: { sign_in_provider: 'google.com' } });
const T = google('t1', 'rebbi@school.test'), OTHER = google('t2', 'other@school.test');
const STUDENT = { role: 'student', studentId: 'moshe', classId: 'sc' };

function draftLines(sid, key, n) {
  const lines = {}, paths = [];
  for (let i = 0; i < n; i++) { const p = 'posukPractice/' + sid + '/mishnayosDrafts/' + key + '/line' + (i + 1) + '_1.webm'; lines[i] = { path: p, mime: 'audio/webm', durationMs: 4000, savedAt: NOW }; paths.push(p); }
  return { lines, paths };
}
function seed(lineCount = 6) {
  const d = draftLines('moshe', KEY, lineCount);
  const store = db({
    b3Games: { students: { moshe: { profile: { name: 'Moshe', classId: 'sc' } } },
      workspaces: { 'b3-2026': {
        teachers: { t1: { active: true, classIds: { sc: true } }, t2: { active: true, classIds: { wt: true } } },
        classes: { sc: { name: 'SC', active: true, toolGrants: { 'posuk-practice-scroll': true }, members: { moshe: { name: 'Moshe', active: true } } },
          wt: { name: 'WT', active: true, toolGrants: { 'posuk-practice-scroll': true }, members: { levi: { name: 'Levi', active: true } } } } } } },
    studentRewards: { students: { r_moshe: { id: 'r_moshe', b3StudentId: 'moshe', name: 'Moshe', rewardBalance: 20, active: true } } },
    posukPractice: { mishnayos: { drafts: { moshe: { [KEY]: { lines: d.lines } } } } }
  });
  return { store, files: bucket(d.paths) };
}
const run = (s, who, body, now = NOW) => core.mishnayosSubmissions({ store: s.store, files: s.files, scopeLib, who, body, now });
const sub = s => s.store.tree.posukPractice.mishnayos.submissions?.moshe?.[KEY];
const balance = s => s.store.tree.studentRewards.students.r_moshe.rewardBalance;
const notices = s => Object.values(s.store.tree.posukPractice.mishnayos.notices?.moshe || {});

test('the server line counts match the mishna text the student page shows', () => {
  const he = JSON.parse(fs.readFileSync(path.join(__dirname, '../record-mishnayos/data/berachos.he.json'), 'utf8'));
  const counts = require('../backend/functions/mishnayos-line-counts.json');
  assert.deepEqual(counts.berachos, he.perakim.map(p => p.mishnayos.map(m => m.lines.length)));
  assert.equal(core.parseKey(KEY).lineCount, 6);
  assert.equal(core.parseKey('berachos_1_99'), null);
  assert.equal(core.parseKey('../x_1_1'), null);
});

test('Submit sends every line to the teacher, clears the drafts and pays 5 points', async () => {
  const s = seed();
  const r = await run(s, STUDENT, { action: 'submit', key: KEY });
  assert.equal(r.status, 'submitted'); assert.equal(r.points, 5); assert.equal(r.attempt, 1);
  const row = sub(s);
  assert.equal(row.status, 'submitted'); assert.equal(Object.keys(row.lines).length, 6);
  assert.ok(Object.values(row.lines).every(l => l.path.startsWith('mishnayosSubmitted/moshe/' + KEY + '/a1/line')));
  assert.ok(Object.values(row.lines).every(l => s.files.set.has(l.path)));
  assert.equal(s.store.tree.posukPractice.mishnayos.drafts.moshe[KEY], undefined);
  assert.ok(![...s.files.set].some(p => p.includes('mishnayosDrafts')));
  assert.equal(balance(s), 25);
  assert.equal(notices(s)[0].kind, 'submitted'); assert.equal(notices(s)[0].points, 5);
});

test('the student does not have to record every line: Submit sends only the recorded ones', async () => {
  const s = seed();
  const lines = s.store.tree.posukPractice.mishnayos.drafts.moshe[KEY].lines;
  delete lines[1]; delete lines[3]; delete lines[4];
  const r = await run(s, STUDENT, { action: 'submit', key: KEY });
  assert.equal(r.status, 'submitted'); assert.equal(r.points, 5);
  const row = sub(s);
  // Each recording keeps its own place in the mishna, so the teacher sees which lines they are.
  assert.deepEqual(Object.keys(row.lines).sort(), ['0', '2', '5']);
  assert.equal(row.recordedCount, 3); assert.equal(row.lineCount, 6);
  assert.match(row.lines[2].path, /\/a1\/line3\.webm$/);
  assert.match(row.lines[5].path, /\/a1\/line6\.webm$/);
  assert.equal(balance(s), 25);
  const list = await run(s, { role: 'teacher', identity: T }, { action: 'teacher-list', classId: 'sc' });
  assert.equal(list.submissions[0].recordedCount, 3);
  // Gold standard needs every line: a partial submission cannot be marked gold.
  const teacher = { role: 'teacher', identity: T };
  const grade = { action: 'teacher-grade', classId: 'sc', studentId: 'moshe', key: KEY, attempt: 1, mistakes: 0, bonus: 0 };
  await assert.rejects(run(s, teacher, { ...grade, gold: true }), { code: 400, message: /every line/ });
  assert.equal(sub(s).status, 'submitted'); assert.equal(balance(s), 25);
  // "Not yet" still works, pays the bonus, and lets him record again.
  const g = await run(s, teacher, { ...grade, gold: false, bonus: 2 });
  assert.equal(g.gradePoints, 0); assert.equal(g.lockedUntil, null); assert.equal(balance(s), 27);
  assert.equal(core.blockedReason(sub(s), NOW + 1), '');
});

test('Submit is refused when no line is recorded', async () => {
  const s = seed();
  s.store.tree.posukPractice.mishnayos.drafts.moshe[KEY].lines = {};
  await assert.rejects(run(s, STUDENT, { action: 'submit', key: KEY }), { code: 400, message: /at least one line/ });
  assert.equal(sub(s), undefined); assert.equal(balance(s), 20);
});

test('a recorded line whose file is missing is refused, not silently skipped', async () => {
  const s = seed();
  s.files.set.delete(s.store.tree.posukPractice.mishnayos.drafts.moshe[KEY].lines[3].path);
  await assert.rejects(run(s, STUDENT, { action: 'submit', key: KEY }), { code: 400, message: /Line 4 did not save/ });
  assert.equal(sub(s), undefined); assert.equal(balance(s), 20);
});

test('a draft that points at another student\'s file is refused', async () => {
  const s = seed();
  s.store.tree.posukPractice.mishnayos.drafts.moshe[KEY].lines[0].path = 'posukPractice/levi/mishnayosDrafts/' + KEY + '/x.webm';
  s.files.set.add('posukPractice/levi/mishnayosDrafts/' + KEY + '/x.webm');
  await assert.rejects(run(s, STUDENT, { action: 'submit', key: KEY }), { code: 400 });
});

test('a second Submit while waiting for the teacher is refused and pays nothing', async () => {
  const s = seed();
  await run(s, STUDENT, { action: 'submit', key: KEY });
  await assert.rejects(run(s, STUDENT, { action: 'submit', key: KEY }), { code: 409 });
  assert.equal(balance(s), 25);
});

test('not gold standard: no grade points, bonus still paid, he can retry, and the retry pays 5 again', async () => {
  const s = seed();
  await run(s, STUDENT, { action: 'submit', key: KEY });
  const g = await run(s, { role: 'teacher', identity: T }, { action: 'teacher-grade', classId: 'sc', studentId: 'moshe', key: KEY, attempt: 1, gold: false, mistakes: 4, bonus: 2, comment: 'Read line 3 again' });
  assert.equal(g.gradePoints, 0); assert.equal(g.bonus, 2); assert.equal(g.lockedUntil, null);
  assert.equal(balance(s), 27);
  assert.equal(core.blockedReason(sub(s), NOW + 1000), '');
  const n = notices(s).find(x => x.kind === 'graded'); assert.equal(n.gold, false); assert.equal(n.comment, 'Read line 3 again');
  // Retry: record again, submit again.
  const d = draftLines('moshe', KEY, 6);
  s.store.tree.posukPractice.mishnayos.drafts = { moshe: { [KEY]: { lines: d.lines } } }; d.paths.forEach(p => s.files.set.add(p));
  const r2 = await run(s, STUDENT, { action: 'submit', key: KEY }, NOW + 60000);
  assert.equal(r2.attempt, 2); assert.equal(balance(s), 32);
  assert.ok(s.store.tree.posukPractice.mishnayos.submissionHistory.moshe[KEY][1].grade);
});

test('gold standard: 10 minus mistakes, uncapped bonus, locked for one month', async () => {
  const s = seed();
  await run(s, STUDENT, { action: 'submit', key: KEY });
  const g = await run(s, { role: 'teacher', identity: T }, { action: 'teacher-grade', classId: 'sc', studentId: 'moshe', key: KEY, attempt: 1, gold: true, mistakes: 3, bonus: 5000 });
  assert.equal(g.gradePoints, 7); assert.equal(g.bonus, 5000);
  assert.equal(balance(s), 25 + 7 + 5000);
  assert.equal(sub(s).lockedUntil, NOW + 30 * 24 * 60 * 60 * 1000);
  assert.equal(core.blockedReason(sub(s), NOW + 29 * 24 * 3600 * 1000), 'locked');
  assert.equal(core.blockedReason(sub(s), NOW + 31 * 24 * 3600 * 1000), '');
  // Locked: Submit is refused even with drafts present.
  const d = draftLines('moshe', KEY, 6);
  s.store.tree.posukPractice.mishnayos.drafts = { moshe: { [KEY]: { lines: d.lines } } }; d.paths.forEach(p => s.files.set.add(p));
  await assert.rejects(run(s, STUDENT, { action: 'submit', key: KEY }, NOW + 1000), { code: 409, message: /locked/ });
});

test('gold standard with 12 mistakes never takes points away', async () => {
  const s = seed();
  await run(s, STUDENT, { action: 'submit', key: KEY });
  const g = await run(s, { role: 'teacher', identity: T }, { action: 'teacher-grade', classId: 'sc', studentId: 'moshe', key: KEY, attempt: 1, gold: true, mistakes: 12, bonus: 0 });
  assert.equal(g.gradePoints, 0); assert.equal(balance(s), 25);
});

test('grading twice pays once', async () => {
  const s = seed();
  await run(s, STUDENT, { action: 'submit', key: KEY });
  const body = { action: 'teacher-grade', classId: 'sc', studentId: 'moshe', key: KEY, attempt: 1, gold: true, mistakes: 0, bonus: 1 };
  await run(s, { role: 'teacher', identity: T }, body);
  await assert.rejects(run(s, { role: 'teacher', identity: T }, body), { code: 409 });
  assert.equal(balance(s), 25 + 10 + 1);
});

test('teachers only see and grade their own class; bad numbers are refused', async () => {
  const s = seed();
  await run(s, STUDENT, { action: 'submit', key: KEY });
  const list = await run(s, { role: 'teacher', identity: T }, { action: 'teacher-list', classId: 'sc' });
  assert.equal(list.submissions.length, 1); assert.equal(list.submissions[0].status, 'submitted');
  await assert.rejects(run(s, { role: 'teacher', identity: OTHER }, { action: 'teacher-list', classId: 'sc' }), { code: 403 });
  await assert.rejects(run(s, { role: 'teacher', identity: OTHER }, { action: 'teacher-grade', classId: 'wt', studentId: 'moshe', key: KEY, attempt: 1, gold: true }), { code: 403 });
  await assert.rejects(run(s, { role: 'teacher', identity: T }, { action: 'teacher-grade', classId: 'sc', studentId: 'moshe', key: KEY, attempt: 1, gold: true, bonus: -3 }), { code: 400 });
  await assert.rejects(run(s, { role: 'teacher', identity: T }, { action: 'teacher-grade', classId: 'sc', studentId: 'moshe', key: KEY, attempt: 1, gold: true, mistakes: 1.5 }), { code: 400 });
  await assert.rejects(run(s, { role: 'teacher', identity: { ...T, firebase: { sign_in_provider: 'password' } } }, { action: 'teacher-list', classId: 'sc' }), { code: 403 });
  assert.equal(balance(s), 25);
});

test('students cannot call teacher actions', async () => {
  const s = seed();
  await assert.rejects(run(s, STUDENT, { action: 'teacher-grade', classId: 'sc', studentId: 'moshe', key: KEY, attempt: 1, gold: true, bonus: 100 }), { code: 400 });
});

test('a failed copy puts everything back and keeps the drafts', async () => {
  const s = seed();
  s.files.copy = async () => { throw new Error('storage down'); };
  await assert.rejects(run(s, STUDENT, { action: 'submit', key: KEY }), /storage down/);
  assert.equal(sub(s), undefined);
  assert.equal(Object.keys(s.store.tree.posukPractice.mishnayos.drafts.moshe[KEY].lines).length, 6);
  assert.equal(balance(s), 20);
});

test('database rules: drafts are blocked while submitted or locked; submissions are server-only', () => {
  for (const f of ['firebase-rules.json', 'firebase-rules.hardened.json']) {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).rules.posukPractice.mishnayos;
    const w = rules.drafts.$studentId.$mishnaKey['.write'];
    assert.match(w, /auth\.token\.b3StudentId == \$studentId/);
    assert.match(w, /'submitted'/); assert.match(w, /'submitting'/); assert.match(w, /lockedUntil/);
    assert.equal(rules.submissions['.write'] ?? false, false);
    assert.equal(rules.submissions.$studentId['.write'] ?? false, false);
    assert.equal(rules.submissionHistory['.write'] ?? false, false);
    assert.match(rules.notices.$studentId.$noticeId.seen['.write'], /newData\.val\(\) == true/);
  }
});

test('teachers can open submitted recordings through private media', () => {
  const src = fs.readFileSync(path.join(__dirname, '../backend/functions/private-media-url.js'), 'utf8');
  assert.match(src, /parts\[0\]==='mishnayosSubmitted'/);
});
