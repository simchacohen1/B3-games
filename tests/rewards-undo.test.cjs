'use strict';
// BrightPath points: Undo. Nothing is deleted: an undo is a new history entry and the original is marked "undone".
const test = require('node:test'), assert = require('node:assert/strict');
const { rewardsTeacher } = require('../backend/functions/rewards-teacher-core.cjs');

function db(tree) {
  const parts = p => p.split('/').filter(Boolean);
  const get = async p => { const v = parts(p).reduce((o, k) => o?.[k], tree); return v === undefined ? null : structuredClone(v); };
  const set = (p, v) => { const k = parts(p), last = k.pop(); let o = tree; for (const x of k) o = o[x] ??= ({}); if (v === null) delete o[last]; else o[last] = structuredClone(v); };
  return { tree, get, update: async u => { for (const [p, v] of Object.entries(u)) set(p, v); },
    tx: async (p, f) => { const v = f(await get(p)); if (v !== undefined) set(p, v); return { committed: v !== undefined, snapshot: { val: () => v } }; } };
}
const google = (uid, email) => ({ uid, email, email_verified: true, firebase: { sign_in_provider: 'google.com' } });
const T = google('t1', 'teacher@school.test'), OTHER = google('t2', 'other@school.test');
function seed() {
  return db({
    b3Games: { workspaces: { 'b3-2026': {
      teachers: { t1: { active: true, classIds: { sc: true } }, t2: { active: true, classIds: { wt: true } } },
      classes: { sc: { name: 'SC', active: true, toolGrants: { 'student-rewards': true }, members: { moshe: { name: 'Moshe', active: true }, yoi: { name: 'Yoi', active: true } } },
        wt: { name: 'WT', active: true, toolGrants: { 'student-rewards': true }, members: { levi: { name: 'Levi', active: true } } } } } } },
    studentRewards: { categories: { c1: { name: 'Behavior', active: true } } }
  });
}
let clock = Date.parse('2026-10-02T15:00:00Z');
const call = (d, who, body) => { clock += 1000; return rewardsTeacher(d, who, body, clock); };
async function ready() {
  const d = seed(); const { root } = await call(d, T, { action: 'load' });
  const ids = Object.values(root.students).reduce((o, s) => ({ ...o, [s.b3StudentId]: s.id }), {});
  return { d, moshe: ids.moshe, yoi: ids.yoi, bal: id => d.tree.studentRewards.students[id].rewardBalance };
}
const adjust = (d, sid, amount, reason = 'Test') => call(d, T, { action: 'adjust', classId: 'b3_sc', studentId: sid, amount, reason });
const adjId = (d, n = 0) => Object.keys(d.tree.studentRewards.pointAdjustments).filter(k => d.tree.studentRewards.pointAdjustments[k].action !== 'undo')[n];

test('undo of added points takes exactly that back, logs the undo, marks the original, and keeps everything', async () => {
  const { d, moshe, bal } = await ready();
  await adjust(d, moshe, 12, 'Great week'); assert.equal(bal(moshe), 12);
  const id = adjId(d);
  const r = await call(d, T, { action: 'undo', kind: 'adjust', id });
  assert.equal(r.applied, -12); assert.equal(bal(moshe), 0);
  const all = d.tree.studentRewards.pointAdjustments;
  assert.equal(Object.keys(all).length, 2, 'the original is kept and the undo is a new entry');
  const undo = Object.values(all).find(x => x.action === 'undo');
  assert.equal(undo.amount, -12); assert.equal(undo.undoOf, 'adjust:' + id); assert.equal(undo.teacherEmail, 'teacher@school.test'); assert.match(undo.reason, /Undo: Great week/);
  assert.equal(all[id].undoneBy, undo.id); assert.equal(all[id].amount, 12, 'the original is unchanged');
});

test('undo of a deduction gives the points back (a purchase, a mistake)', async () => {
  const { d, moshe, bal } = await ready();
  await adjust(d, moshe, 20); await adjust(d, moshe, -8, 'Wrong student');
  assert.equal(bal(moshe), 12);
  await call(d, T, { action: 'undo', kind: 'adjust', id: adjId(d, 1) });
  assert.equal(bal(moshe), 20);
});

test('an entry can be undone once, and an undo cannot be undone', async () => {
  const { d, moshe } = await ready();
  await adjust(d, moshe, 5);
  const id = adjId(d);
  await call(d, T, { action: 'undo', kind: 'adjust', id });
  await assert.rejects(call(d, T, { action: 'undo', kind: 'adjust', id }), { code: 409 });
  const undoId = Object.values(d.tree.studentRewards.pointAdjustments).find(x => x.action === 'undo').id;
  await assert.rejects(call(d, T, { action: 'undo', kind: 'adjust', id: undoId }), { code: 400 });
});

test('undoing a gift the student already spent is blocked, and nothing changes', async () => {
  const { d, moshe, bal } = await ready();
  await adjust(d, moshe, 10); await adjust(d, moshe, -7, 'Prize');
  assert.equal(bal(moshe), 3);
  const id = adjId(d, 0);
  await assert.rejects(call(d, T, { action: 'undo', kind: 'adjust', id }), { code: 409, message: /too low/ });
  assert.equal(bal(moshe), 3);
  assert.equal(d.tree.studentRewards.pointAdjustments[id].undoneBy, undefined, 'the entry is not left marked');
  assert.equal(Object.keys(d.tree.studentRewards.pointAdjustments).length, 2);
});

test('a deduction that changed nothing (balance was already zero) has nothing to undo', async () => {
  const { d, moshe } = await ready();
  await adjust(d, moshe, -5);
  await assert.rejects(call(d, T, { action: 'undo', kind: 'adjust', id: adjId(d) }), { code: 409, message: /nothing to undo/ });
});

test('approved activity points are taken back by the amount that was actually given', async () => {
  const { d, moshe, bal } = await ready();
  d.tree.studentRewards.pointRequests = { r1: { rewardStudentId: moshe, amount: 5, status: 'pending', source: 'chazara', reason: 'Chazara' } };
  await call(d, T, { action: 'approve', requestId: 'r1' }); assert.equal(bal(moshe), 5);
  await call(d, T, { action: 'undo', kind: 'request', id: 'r1' });
  assert.equal(bal(moshe), 0); assert.ok(d.tree.studentRewards.pointRequests.r1.undoneBy);
  assert.equal(d.tree.studentRewards.pointRequests.r1.status, 'approved', 'history keeps what happened');
  await assert.rejects(call(d, T, { action: 'undo', kind: 'request', id: 'r1' }), { code: 409 });
  d.tree.studentRewards.pointRequests.r2 = { rewardStudentId: moshe, amount: 3, status: 'pending' };
  await assert.rejects(call(d, T, { action: 'undo', kind: 'request', id: 'r2' }), { code: 409 }, 'points never given cannot be undone');
});

test('a purchase is returned once, with who did it, and a declined or returned one cannot be returned again', async () => {
  const { d, moshe, bal } = await ready();
  d.tree.studentRewards.rewards = { w1: { id: 'w1', name: 'Pencil', cost: 15, ownerClassId: 'b3_sc' } };
  d.tree.studentRewards.students[moshe].rewardBalance = 5;
  d.tree.studentRewards.redemptionsByStudent = { [moshe]: { p1: { rewardId: 'w1', cost: 15, status: 'ready', requestedAt: '2026-10-02T10:00:00Z' }, p2: { rewardId: 'w1', cost: 15, status: 'declined' } } };
  const r = await call(d, T, { action: 'undo', kind: 'purchase', studentId: moshe, key: 'p1' });
  assert.equal(r.applied, 15); assert.equal(bal(moshe), 20);
  const p = d.tree.studentRewards.redemptionsByStudent[moshe].p1;
  assert.equal(p.status, 'refunded'); assert.equal(p.refundedBy, 'teacher@school.test'); assert.equal(p.statusBeforeRefund, 'ready');
  await assert.rejects(call(d, T, { action: 'undo', kind: 'purchase', studentId: moshe, key: 'p1' }), { code: 409 });
  await assert.rejects(call(d, T, { action: 'undo', kind: 'purchase', studentId: moshe, key: 'p2' }), { code: 409 });
  assert.equal(bal(moshe), 20);
});

test('daily points: each save is logged with what the day was before; undo restores the day and the balance', async () => {
  const { d, moshe, bal } = await ready();
  const date = '2026-10-02', day = () => d.tree.studentRewards.dailyAwards[moshe].b3_sc[date];
  const s1 = await call(d, T, { action: 'saveDaily', classId: 'b3_sc', date, rows: [{ studentId: moshe, ratings: { Behavior: 'Excellent' } }] });
  assert.match(s1.batchId, /^b_/); assert.equal(bal(moshe), 4);
  const s2 = await call(d, T, { action: 'saveDaily', classId: 'b3_sc', date, rows: [{ studentId: moshe, ratings: { Behavior: 'Fair' } }] });
  assert.equal(bal(moshe), 2);
  const logs = Object.values(d.tree.studentRewards.dailyAwardLog[moshe]);
  assert.equal(logs.length, 2); assert.equal(logs.find(l => l.batchId === s2.batchId).before.award.points, 4);
  const r = await call(d, T, { action: 'undo', kind: 'daily', classId: 'b3_sc', studentId: moshe, date });
  assert.equal(r.applied, 2); assert.equal(bal(moshe), 4); assert.equal(day().points, 4);
  const after = Object.values(d.tree.studentRewards.dailyAwardLog[moshe]);
  assert.equal(after.length, 3, 'the undo is a new log entry'); assert.ok(after.find(l => l.batchId === s2.batchId && l.kind === 'save').undoneAt);
  assert.ok(after.find(l => l.kind === 'undo'));
  await assert.rejects(call(d, T, { action: 'undo', kind: 'daily', classId: 'b3_sc', studentId: moshe, date }), { code: 409 }, 'the same save cannot be undone twice');
});

test('daily points: undoing the very first save removes the day; saving the same thing again makes no log entry', async () => {
  const { d, moshe, bal } = await ready();
  const date = '2026-10-03', row = { studentId: moshe, ratings: { Behavior: 'Good' } };
  await call(d, T, { action: 'saveDaily', classId: 'b3_sc', date, rows: [row] });
  await call(d, T, { action: 'saveDaily', classId: 'b3_sc', date, rows: [row] });
  assert.equal(Object.keys(d.tree.studentRewards.dailyAwardLog[moshe]).length, 1, 'no change, no log entry');
  await call(d, T, { action: 'undo', kind: 'daily', classId: 'b3_sc', studentId: moshe, date });
  assert.equal(bal(moshe), 0); assert.equal(d.tree.studentRewards.dailyAwards[moshe]?.b3_sc?.[date], undefined);
  assert.equal(d.tree.studentRewards.dailyAttendance[moshe]?.b3_sc?.[date], undefined);
});

test('daily points: a day changed after the save, or saved before Undo existed, is refused with a clear reason', async () => {
  const { d, moshe } = await ready();
  d.tree.studentRewards.dailyAwards = { [moshe]: { b3_sc: { '2026-09-01': { points: 3, savedAt: 'x' } } } };
  await assert.rejects(call(d, T, { action: 'undo', kind: 'daily', classId: 'b3_sc', studentId: moshe, date: '2026-09-01' }), { code: 404, message: /before Undo existed/ });
  const date = '2026-10-04';
  await call(d, T, { action: 'saveDaily', classId: 'b3_sc', date, rows: [{ studentId: moshe, ratings: { Behavior: 'Good' } }] });
  d.tree.studentRewards.dailyAwards[moshe].b3_sc[date].points = 99;
  await assert.rejects(call(d, T, { action: 'undo', kind: 'daily', classId: 'b3_sc', studentId: moshe, date }), { code: 409, message: /changed after/ });
});

test('daily points: taking back a day the student already spent is blocked', async () => {
  const { d, moshe, bal } = await ready();
  const date = '2026-10-05';
  await call(d, T, { action: 'saveDaily', classId: 'b3_sc', date, rows: [{ studentId: moshe, ratings: { Behavior: 'Excellent' } }] });
  d.tree.studentRewards.students[moshe].rewardBalance = 1;
  await assert.rejects(call(d, T, { action: 'undo', kind: 'daily', classId: 'b3_sc', studentId: moshe, date }), { code: 409, message: /too low/ });
  assert.equal(bal(moshe), 1); assert.equal(d.tree.studentRewards.dailyAwards[moshe].b3_sc[date].points, 4);
});

test('a whole class-wide save is undone in one action; a student whose day was changed later is skipped and reported', async () => {
  const { d, moshe, yoi, bal } = await ready();
  const date = '2026-10-06';
  const s = await call(d, T, { action: 'saveDaily', classId: 'b3_sc', date, rows: [{ studentId: moshe, ratings: { Behavior: 'Excellent' } }, { studentId: yoi, ratings: { Behavior: 'Good' } }] });
  assert.equal(bal(moshe), 4); assert.equal(bal(yoi), 3);
  await call(d, T, { action: 'saveDaily', classId: 'b3_sc', date, rows: [{ studentId: yoi, ratings: { Behavior: 'Fair' } }] });
  const r = await call(d, T, { action: 'undo', kind: 'batch', classId: 'b3_sc', batchId: s.batchId });
  assert.equal(r.undone, 1); assert.equal(r.skipped.length, 1); assert.equal(r.skipped[0].studentId, yoi); assert.match(r.skipped[0].reason, /changed after/);
  assert.equal(bal(moshe), 0); assert.equal(bal(yoi), 2);
});

test('a teacher can undo only entries for students in their own class', async () => {
  const { d, moshe } = await ready();
  await adjust(d, moshe, 5);
  await assert.rejects(call(d, OTHER, { action: 'undo', kind: 'adjust', id: adjId(d) }), { code: 403 });
  await assert.rejects(call(d, T, { action: 'undo', kind: 'adjust', id: '../x' }), { code: 400 });
  await assert.rejects(call(d, T, { action: 'undo', kind: 'daily', classId: 'b3_wt', studentId: moshe, date: '2026-10-02' }), { code: 403 });
  await assert.rejects(call(d, T, { action: 'undo', kind: 'something' }), { code: 400 });
});

test('the history the page shows includes the daily save log', async () => {
  const { d, moshe } = await ready();
  await call(d, T, { action: 'saveDaily', classId: 'b3_sc', date: '2026-10-07', rows: [{ studentId: moshe, ratings: { Behavior: 'Good' } }] });
  const { root } = await call(d, T, { action: 'load' });
  assert.equal(Object.keys(root.dailyAwardLog[moshe]).length, 1);
});

// ---------- the page: who, Undo buttons, undone marks (the real functions, run on sample data) ----------
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const pageSource = fs.readFileSync(path.join(__dirname, '../student-rewards/teacher.js'), 'utf8').replace(/\r\n/g, '\n');
function pageFns(state) {
  const start = pageSource.indexOf('function decorateLedger(rows){'), end = pageSource.indexOf('async function runUndo(spec){');
  assert.ok(start > 0 && end > start);
  const ctx = vm.createContext({ state, pointTime: v => Date.parse(v) || 0, C: { formatDate: d => d }, esc: s => String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;') });
  vm.runInContext(pageSource.slice(start, end) + '\nthis.api={decorateLedger,whoLabel,undoCell};', ctx);
  return ctx.api;
}
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));   // the page functions run in another realm
test('page: each row shows who did it, offers the right Undo, marks undone entries, and shows daily undos', () => {
  const state = { root: {
    pointAdjustments: { a1: { amount: 5, teacherEmail: 'me@school.test', action: 'teacher' }, a2: { amount: 4, teacherEmail: 'me@school.test', undoneBy: 'u1' }, u1: { amount: -4, action: 'undo', teacherEmail: 'me@school.test' } },
    pointRequests: { r1: { status: 'approved', actualAmount: 3, reviewedBy: 'Automatic: Posuk Practice milestone' }, r2: { status: 'approved', actualAmount: 2, reviewedBy: 'boss@school.test', undoneBy: 'u9' } },
    redemptionsByStudent: { s1: { p1: { status: 'ready', cost: 10 }, p2: { status: 'declined', cost: 10, reviewedBy: 'me@school.test' } } },
    dailyAwards: { s1: { c1: { '2026-10-01': { points: 4, teacherEmail: 'me@school.test', savedAt: 'T1' } } } },
    dailyAwardLog: { s1: { l1: { id: 'l1', classId: 'c1', date: '2026-10-01', batchId: 'b1', kind: 'save', after: { points: 4 }, savedAt: '2026-10-01T10:00:00Z' } }, s2: { l2: { id: 'l2', classId: 'c1', date: '2026-10-01', batchId: 'b1', kind: 'save', after: { points: 3 }, savedAt: '2026-10-01T10:00:00Z' },
      l3: { id: 'l3', classId: 'c1', date: '2026-09-30', kind: 'undo', appliedDelta: -2, teacherEmail: 'me@school.test', savedAt: '2026-10-02T10:00:00Z' } } }
  } };
  const api = pageFns(state);
  const row = (id, extra = {}) => ({ id, sid: 's1', studentName: 'A', studentInitials: 'A', studentColor: '#000', amount: 1, status: 'posted', counts: true, ...extra });
  const rows = [row('adjust:a1'), row('adjust:a2'), row('adjust:u1'), row('request:r1'), row('request:r2'), row('redeem:s1:p1:request'), row('redeem:s1:p2:request'), row('redeem:s1:p2:return'),
    row('daily:s1:c1:2026-10-01'), row('daily:s1:c1:2026-08-01'), row('class-contribution:s1:k1'), row('gap:s1', { isGap: true }), row('adjust:a1', { sid: 's2', studentName: 'B' })];
  api.decorateLedger(rows);
  const by = id => rows.find(r => r.id === id);
  same(by('adjust:a1').undo, { kind: 'adjust', id: 'a1' }); assert.equal(api.whoLabel(by('adjust:a1')), 'me@school.test');
  assert.equal(by('adjust:a2').status, 'undone'); assert.equal(by('adjust:a2').undo, undefined); assert.match(api.undoCell(by('adjust:a2')), /Undone/);
  assert.equal(by('adjust:u1').sourceLabel, 'Undo'); assert.equal(by('adjust:u1').undo, undefined, 'an undo has no Undo button');
  assert.equal(api.whoLabel(by('request:r1')), 'Automatic'); same(by('request:r1').undo, { kind: 'request', id: 'r1' });
  assert.equal(by('request:r2').status, 'undone'); assert.equal(api.whoLabel(by('request:r2')), 'boss@school.test');
  same(by('redeem:s1:p1:request').undo, { kind: 'purchase', studentId: 's1', key: 'p1' }); assert.equal(api.whoLabel(by('redeem:s1:p1:request')), 'Student');
  assert.equal(by('redeem:s1:p2:request').undo, undefined, 'a declined purchase was already returned');
  assert.equal(api.whoLabel(by('redeem:s1:p2:return')), 'me@school.test');
  const d = by('daily:s1:c1:2026-10-01');
  same(d.undo, { kind: 'daily', classId: 'c1', studentId: 's1', date: '2026-10-01' }); assert.equal(d.batch.count, 2);
  assert.match(api.undoCell(d), /Undo whole save \(2\)/); assert.match(api.undoCell(d), /data-undo=/);
  assert.match(api.undoCell(by('daily:s1:c1:2026-08-01')), /Saved before Undo existed/);
  assert.match(api.undoCell(by('class-contribution:s1:k1')), /data-refund-contribution="s1\|k1"/); assert.equal(by('redeem:s1:p1:request').prize, 'waiting'); assert.equal(by('redeem:s1:p2:return').prize, 'refunded');
  assert.equal(api.whoLabel(by('gap:s1')), '—');
  const dailyUndo = rows.find(r => String(r.id).startsWith('dailyundo:'));
  assert.ok(dailyUndo, 'a daily undo is shown in the history'); assert.equal(dailyUndo.counts, false, 'it does not change the running balance a second time'); assert.equal(dailyUndo.amount, -2);
});
test('page: Undo needs a confirmation, goes through the checked server action, and reloads the history', () => {
  assert.match(pageSource, /if\(!confirm\(question\)\)return;/);
  assert.match(pageSource, /"Undo this whole Daily Points save for the class\?/);
  assert.match(pageSource, /await teacherApi\("undo",spec\)/);
  assert.match(pageSource, /await loadRoot\(\);render\(\);\s*\}\s*document\.addEventListener\("click"/);
  assert.match(pageSource, /"classRewardRounds","dailyAwardLog"\]/, 'the owner view loads the daily save log too');
  assert.match(pageSource, /<th>Balance after<\/th><th>Who<\/th><th><\/th>/);
  assert.match(pageSource, /\$\{studentPointsPanel\(s\)\}/, 'a student\'s own history on the Students page');
});

test('the staging copy of the teacher rewards function uses the same core as the live one (only the origins and the production guard differ)', () => {
  const live = fs.readFileSync(path.join(__dirname, '../backend/functions/rewards-teacher-core.cjs'));
  const staging = fs.readFileSync(path.join(__dirname, '../backend/functions-staging/rewards-teacher-core.cjs'));
  assert.ok(live.equals(staging), 'rewards-teacher-core.cjs must be identical in both codebases');
  const wrapper = fs.readFileSync(path.join(__dirname, '../backend/functions-staging/rewards-teacher.js'), 'utf8');
  assert.match(wrapper, /assertNoProductionFirebaseTarget\(admin\.apps\[0\]\)/);
  assert.match(wrapper, /fun-torah-tools-staging\.web\.app/);
  assert.doesNotMatch(wrapper, /sols\.tools|funtorahtools\.com/);
  assert.match(fs.readFileSync(path.join(__dirname, '../backend/functions-staging/index.js'), 'utf8'), /exports\.studentRewardsTeacher = require\('\.\/rewards-teacher'\)\.studentRewardsTeacher;/);
  const html = fs.readFileSync(path.join(__dirname, '../student-rewards/teacher.html'), 'utf8');
  assert.match(html, /brightpath\.css\?v=20261127-spending/); assert.match(html, /teacher\.js\?v=20261127-spending/);
});

test('an undo claim left behind by a crash can be taken again after 2 minutes, but not while it is fresh', async () => {
  const { d, moshe, bal } = await ready();
  await adjust(d, moshe, 6);
  const id = adjId(d), item = () => d.tree.studentRewards.pointAdjustments[id];
  item().undoneBy = 'processing:' + clock;                       // another undo is running right now
  await assert.rejects(call(d, T, { action: 'undo', kind: 'adjust', id }), { code: 409 });
  assert.equal(bal(moshe), 6);
  item().undoneBy = 'processing:' + (clock - 200000);            // it crashed a few minutes ago
  await call(d, T, { action: 'undo', kind: 'adjust', id });
  assert.equal(bal(moshe), 0); assert.match(item().undoneBy, /^undo_/);
});

// ---- Quick award (several students or the whole class) and undoing the whole award ----
const award = (d, who, body) => call(d, who, { action: 'awardBatch', classId: 'b3_sc', ...body });
test('quick award gives each chosen student the points with their own history entry, sharing one batch id', async () => {
  const { d, moshe, yoi, bal } = await ready();
  const r = await award(d, T, { studentIds: [moshe, yoi], amount: 5, reason: 'Great davening' });
  assert.equal(r.awarded, 2); assert.deepEqual(r.failed, []);
  assert.equal(bal(moshe), 5); assert.equal(bal(yoi), 5);
  const rows = Object.values(d.tree.studentRewards.pointAdjustments);
  assert.equal(rows.length, 2); assert.ok(rows.every(x => x.batchId === r.batchId && x.amount === 5 && x.reason === 'Great davening' && x.teacherEmail === 'teacher@school.test'));
  assert.equal(d.tree.studentRewards.pointAdjustmentBatches[r.batchId].amount, 5);
});
test('whole class award reaches every enrolled student; a teacher cannot award outside their class', async () => {
  const { d, moshe, yoi, bal } = await ready();
  const r = await award(d, T, { wholeClass: true, amount: 10 }); assert.equal(r.awarded, 2); assert.equal(bal(moshe), 10); assert.equal(bal(yoi), 10);
  await assert.rejects(call(d, OTHER, { action: 'awardBatch', classId: 'b3_sc', studentIds: [moshe], amount: 5 }), { code: 403 });
  await assert.rejects(award(d, T, { studentIds: [], amount: 5 }), { code: 400 });
  await assert.rejects(award(d, T, { studentIds: [moshe], amount: 0 }), { code: 400 });
  await assert.rejects(award(d, T, { studentIds: [moshe], amount: 1001 }), { code: 400 });
});
test('one click undoes the whole award, once; nothing is deleted and the undo entries are logged', async () => {
  const { d, moshe, yoi, bal } = await ready();
  const r = await award(d, T, { wholeClass: true, amount: 5, reason: 'Pizza party' });
  const u = await call(d, T, { action: 'undo', kind: 'awardbatch', classId: 'b3_sc', batchId: r.batchId });
  assert.equal(u.undone, 2); assert.deepEqual(u.skipped, []); assert.equal(bal(moshe), 0); assert.equal(bal(yoi), 0);
  const all = Object.values(d.tree.studentRewards.pointAdjustments);
  assert.equal(all.length, 4, 'the two awards are kept and two undo entries were added'); assert.equal(all.filter(x => x.action === 'undo').length, 2);
  await assert.rejects(call(d, T, { action: 'undo', kind: 'awardbatch', classId: 'b3_sc', batchId: r.batchId }), { code: 409 });
  assert.equal(bal(moshe), 0, 'a second click never takes points twice');
});
test('whole-award undo skips a student who already spent the points, and names them; the others are undone', async () => {
  const { d, moshe, yoi, bal } = await ready();
  const r = await award(d, T, { studentIds: [moshe, yoi], amount: 5 });
  d.tree.studentRewards.students[moshe].rewardBalance = 2; // moshe spent 3
  const u = await call(d, T, { action: 'undo', kind: 'awardbatch', classId: 'b3_sc', batchId: r.batchId });
  assert.equal(u.undone, 1); assert.equal(u.skipped.length, 1); assert.equal(u.skipped[0].studentId, moshe);
  assert.equal(bal(moshe), 2); assert.equal(bal(yoi), 0);
});
test('a single entry of a quick award can still be undone on its own, and then the whole-award undo leaves it alone', async () => {
  const { d, moshe, yoi, bal } = await ready();
  const r = await award(d, T, { studentIds: [moshe, yoi], amount: 5 });
  const mosheAdj = d.tree.studentRewards.pointAdjustmentBatches[r.batchId].entries[moshe];
  await call(d, T, { action: 'undo', kind: 'adjust', id: mosheAdj }); assert.equal(bal(moshe), 0);
  const u = await call(d, T, { action: 'undo', kind: 'awardbatch', classId: 'b3_sc', batchId: r.batchId });
  assert.equal(u.undone, 1); assert.equal(bal(moshe), 0); assert.equal(bal(yoi), 0);
});

test('page: quick award bar, whole-award undo and the Refund button on purchases', () => {
  assert.match(pageSource, /function quickAwardPanel\(\)/);
  assert.match(pageSource, /QUICK_PRESETS=\[1,5,10\]/, 'presets +1, +5, +10');
  assert.match(pageSource, /id="qaCustom"[\s\S]*id="qaReason"/, 'custom amount and reason');
  assert.match(pageSource, /data-qa-student=/, 'pick several students');
  assert.match(pageSource, /id="qaWhole">Whole class/, 'whole class');
  assert.match(pageSource, /teacherApi\("awardBatch"/, 'goes through the checked server action');
  assert.match(pageSource, /if\(!confirm\(`Give /, 'asks before giving points');
  assert.match(pageSource, /kind:"awardbatch"[\s\S]*Undo whole award/, 'one click undoes the whole award');
  assert.match(pageSource, /class="points-undo refund"[\s\S]*↩ Refund/, 'purchases get a Refund button');
  assert.match(pageSource, /\$\{quickAwardPanel\(\)\}/, 'the bar is on the Points page');
});

test('refunding a purchase that reserved stock puts the stock back', async () => {
  const { d, moshe, bal } = await ready();
  d.tree.studentRewards.rewards = { w1: { id: 'w1', name: 'Pencil', cost: 15, quantity: 2, ownerClassId: 'b3_sc' } };
  d.tree.studentRewards.redemptionsByStudent = { [moshe]: { p1: { rewardId: 'w1', cost: 15, status: 'pending', quantityReserved: true }, p3: { rewardId: 'w1', cost: 15, status: 'pending', quantityReserved: false } } };
  await call(d, T, { action: 'undo', kind: 'purchase', studentId: moshe, key: 'p1' });
  assert.equal(d.tree.studentRewards.rewards.w1.quantity, 3);
  await call(d, T, { action: 'undo', kind: 'purchase', studentId: moshe, key: 'p3' });
  assert.equal(d.tree.studentRewards.rewards.w1.quantity, 3, 'no stock was reserved, so none is returned');
});

test('a teacher Decline puts the reserved stock back, once, and never for unlimited prizes', async () => {
  const { d, moshe, bal } = await ready();
  d.tree.studentRewards.rewards = { w1: { id: 'w1', name: 'Pencil', cost: 15, quantity: 2, ownerClassId: 'b3_sc' }, w2: { id: 'w2', name: 'Sticker', cost: 5, quantity: -1, ownerClassId: 'b3_sc' } };
  d.tree.studentRewards.redemptionsByStudent = { [moshe]: {
    p1: { rewardId: 'w1', cost: 15, status: 'pending', quantityReserved: true },
    p2: { rewardId: 'w1', cost: 15, status: 'pending', quantityReserved: false },
    p3: { rewardId: 'w1', cost: 15, status: 'pending' },
    p4: { rewardId: 'w2', cost: 5, status: 'pending' } } };
  const before = bal(moshe);
  await call(d, T, { action: 'review', studentId: moshe, key: 'p1', decision: 'decline' });
  assert.equal(d.tree.studentRewards.rewards.w1.quantity, 3); assert.equal(bal(moshe), before + 15);
  await assert.rejects(call(d, T, { action: 'review', studentId: moshe, key: 'p1', decision: 'decline' }), { code: 409 });
  assert.equal(d.tree.studentRewards.rewards.w1.quantity, 3, 'a second decline changes nothing');
  await call(d, T, { action: 'review', studentId: moshe, key: 'p2', decision: 'decline' });
  assert.equal(d.tree.studentRewards.rewards.w1.quantity, 3, 'no stock was reserved');
  await call(d, T, { action: 'review', studentId: moshe, key: 'p3', decision: 'decline' });
  assert.equal(d.tree.studentRewards.rewards.w1.quantity, 4, 'older request with no marker follows the cancel rule');
  await call(d, T, { action: 'review', studentId: moshe, key: 'p4', decision: 'decline' });
  assert.equal(d.tree.studentRewards.rewards.w2.quantity, -1, 'unlimited stays unlimited');
});

test('page: the owner Decline and approved refund requests also put the reserved stock back', () => {
  const js = fs.readFileSync('student-rewards/teacher.js', 'utf8');
  assert.match(js, /async function returnStock\(item\)/);
  const decline = js.slice(js.indexOf('async function review('), js.indexOf('function reportRows'));
  assert.match(decline, /await returnStock\(item\);/);
  const refund = js.slice(js.indexOf('async function decideRefund'), js.indexOf('let balanceAfter=null'));
  assert.match(refund, /await returnStock\(info\.record\);/);
});
