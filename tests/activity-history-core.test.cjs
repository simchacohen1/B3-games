const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../activity-history/core.js');

const who = { sid: 's1', name: 'Dovid', classId: 'c1', className: 'Class One' };
const people = { s1: { name: 'Dovid', classId: 'c1', className: 'Class One' }, s2: { name: 'Moshe', classId: 'c2', className: 'Class Two' } };

test('posuk attempts become one row per try with the report scoring', () => {
  const rows = C.posukRows(who, { '3_4': { a: { timestamp: 1000, hebrewScore: 90, translationScore: 80 }, b: { timestamp: 2000 } } });
  assert.equal(rows.length, 2);
  const a = rows.find(r => r.when === 1000);
  assert.equal(a.what, 'Perek 3:4');
  assert.equal(a.result, 'Reading 90% · Translation 80%');
  assert.equal(a.status, 'Scored');
  assert.equal(rows.find(r => r.when === 2000).status, 'Not scored yet');
});

test('chazara skips unsaved events and marks removed/rejected', () => {
  const rows = C.chazaraRows(who, {
    e1: { reviewApplied: true, perek: 1, posuk: 2, createdAt: 5, reviewNumber: 3, recorded: true, storagePath: 'x/y.webm' },
    e2: { reviewApplied: false, createdAt: 6 },
    e3: { reviewApplied: true, perek: 1, posuk: 3, createdAt: 7, teacherRejected: true }
  });
  assert.equal(rows.length, 2);
  assert.equal(rows.find(r => r.what === 'Perek 1:2').audioPath, 'x/y.webm');
  assert.equal(rows.find(r => r.what === 'Perek 1:3').status, 'Rejected');
});

test('shorashim, chayus and quiz rows', () => {
  assert.equal(C.shorashimRows(who, { cards: { k: { word: 'אמר', learnedAt: 9 }, n: {} } }).length, 1);
  const ch = C.chayusRows(who, { students: { s1: { days: { '2026-11-01': { level: 2, levelName: 'Strong', points: 3, minutes: 12 } } } } });
  assert.equal(ch[0].result, 'Level 2 · Strong · 3 points');
  const q = C.quizRows(who, { quizzes: [{ key: 'q', title: 'Quiz A', attempts: [{ status: 'completed', date: 4, correct: 8, total: 10, pct: 80 }, { status: 'not_started', date: 3 }] }] });
  assert.equal(q.length, 1);
  assert.equal(q[0].result, '8 / 10 (80%)');
});

test('reward rows: daily points, prize store, adjustments, rashi recordings only from requests', () => {
  const rows = C.rewardRows({
    dailyAwards: { s1: { c1: { '2026-11-02': { points: 3, savedAt: 100 } } } },
    pointRequests: {
      r1: { source: 'rashi-recording', rewardStudentId: 's1', classId: 'c1', status: 'approved', amount: 2, actualAmount: 2, createdAt: 50, reviewedAt: 60, reason: 'Recorded reading' },
      r2: { source: 'chazara', rewardStudentId: 's1', classId: 'c1', status: 'approved', amount: 1, createdAt: 70 }
    },
    pointAdjustments: { a1: { studentId: 's2', classId: 'c2', amount: -2, reason: 'Oops', createdAt: 80 } },
    redemptionsByStudent: { s1: { p1: { rewardId: 'w', cost: 20, requestedAt: 90, status: 'pending' } } },
    rewards: { w: { name: 'Pencil' } }
  }, people);
  const by = t => rows.filter(r => r.tool === t);
  assert.equal(by('daily')[0].result, '+3 ★');
  assert.equal(by('rashi').length, 1);
  assert.equal(by('rashi')[0].status, 'Approved');
  assert.equal(rows.filter(r => r.what === 'Recorded reading').length, 1);
  assert.equal(by('points')[0].result, '-2 ★');
  assert.equal(by('prize')[0].what, 'Pencil');
  assert.equal(by('prize')[0].status, 'Pending');
  assert.equal(rows.length, 4); /* chazara request is not duplicated here */
});

test('filters by student, class, tool and date range; newest first', () => {
  const day = s => new Date(s + 'T12:00:00').getTime();
  const rows = C.sortNewest([
    { id: '1', sid: 's1', student: 'A', classId: 'c1', tool: 'posuk', when: day('2026-11-01'), what: 'x', result: '', status: '' },
    { id: '2', sid: 's2', student: 'B', classId: 'c2', tool: 'chazara', when: day('2026-11-05'), what: 'y', result: '', status: '' },
    { id: '3', sid: 's1', student: 'A', classId: 'c1', tool: 'chazara', when: day('2026-11-09'), what: 'z', result: '', status: '' }
  ]);
  assert.deepEqual(rows.map(r => r.id), ['3', '2', '1']);
  assert.deepEqual(C.applyFilters(rows, { student: 's1' }).map(r => r.id), ['3', '1']);
  assert.deepEqual(C.applyFilters(rows, { classId: 'c2' }).map(r => r.id), ['2']);
  assert.deepEqual(C.applyFilters(rows, { tool: 'chazara' }).map(r => r.id), ['3', '2']);
  assert.deepEqual(C.applyFilters(rows, { from: '2026-11-05', to: '2026-11-05' }).map(r => r.id), ['2']);
  assert.deepEqual(C.applyFilters(rows, { from: '2026-11-02' }).map(r => r.id), ['3', '2']);
});

test('row links open the tool page on the class and student', () => {
  assert.equal(C.rowHref({ tool: 'chazara', classId: 'c 1', sid: 's1' }), 'chazara/teacher.html?class=c%201&student=s1');
  assert.equal(C.rowHref({ tool: 'daily', classId: 'c1', sid: 's1' }), 'student-rewards/teacher.html?tab=Daily%20Points&class=c1&student=s1');
});
