'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('../shared/weekly-practice-marks-core.js');

test('a week is Sunday to Saturday in New York time, dated Friday', () => {
  const r = C.weekRange('2026-11-18'); // Wednesday
  assert.equal(r.start, '2026-11-15'); assert.equal(r.end, '2026-11-21'); assert.equal(r.friday, '2026-11-20');
  assert.equal(C.weekRange('2026-11-15').start, '2026-11-15');
  assert.equal(C.weekRange('2026-11-21').start, '2026-11-15');
  assert.equal(C.weekRange('nope'), null);
});
test('week boundaries follow New York midnight, including the daylight-saving change', () => {
  const r = C.weekRange('2026-11-01'); // clocks go back that Sunday
  assert.equal(C.nyDateIso(r.from), '2026-11-01');
  assert.equal(C.nyDateIso(r.from - 1), '2026-10-31');
  assert.equal(C.nyDateIso(r.to - 1), '2026-11-07');
  assert.equal(C.nyDateIso(r.to), '2026-11-08');
  assert.equal((r.to - r.from) / 3600000, 7 * 24 + 1);
});
test('posuk grade: 0-10 score x10, old gold/retry grades map the same way', () => {
  assert.equal(C.posukPercent({ status: 'gold', score: 10 }), 100);
  assert.equal(C.posukPercent({ status: 'scored', score: 6 }), 60);
  assert.equal(C.posukPercent({ status: 'gold', mistakes: 2 }), 80);
  assert.equal(C.posukPercent({ status: 'gold', mistakes: 0, bonus: 5, pointsAwarded: 15 }), 100);
  assert.equal(C.posukPercent({ status: 'retry' }), 0);
  assert.equal(C.posukPercent({ status: 'pending' }), null);
  assert.equal(C.posukPercent({ status: 'deleted' }), null);
});
test('averages every graded item of the week, skips other weeks, and counts ungraded', () => {
  const range = C.weekRange('2026-11-18'), mid = range.from + 3 * 86400000;
  const res = C.collectStudent({
    submissions: { a: { status: 'gold', score: 10, gradedAt: mid }, b: { status: 'scored', score: 6, gradedAt: mid },
      old: { status: 'gold', score: 10, gradedAt: range.from - 1000 }, wait: { status: 'pending', submittedAt: mid } },
    attempts: { k1: { x: { timestamp: mid, comprehensionScore: 80 }, y: { timestamp: mid, comprehensionScore: 100 }, z: { timestamp: range.to, comprehensionScore: 0 }, n: { timestamp: mid } } },
    rashi: [{ grade: 90, gradedAt: mid }, { grade: 70, gradedAt: mid }, { grade: 10, gradedAt: range.to + 5 }], rashiPending: 2
  }, range);
  assert.deepEqual(res.posuk, { n: 2, mark: 80 });
  assert.deepEqual(res.chidon, { n: 2, mark: 90 });
  assert.deepEqual(res.rashi, { n: 2, mark: 80 });
  assert.equal(res.ungraded, 3);
});
test('a tool with no activity gives no mark', () => {
  const res = C.collectStudent({}, C.weekRange('2026-11-18'));
  assert.equal(res.posuk.mark, null); assert.equal(res.chidon.mark, null); assert.equal(res.rashi.mark, null);
});
test('Nigri bodies: right topic, homework, Friday date, only boys with a mark, empty mark skipped', () => {
  const range = C.weekRange('2026-11-18');
  const names = { a: 'Boy A', b: 'Boy B' };
  const rows = [
    { sid: 'a', result: { posuk: { n: 2, mark: 80 }, chidon: { n: 1, mark: 100 }, rashi: { n: 0, mark: null } } },
    { sid: 'b', result: { posuk: { n: 0, mark: null }, chidon: { n: 0, mark: null }, rashi: { n: 0, mark: null } } }];
  const bodies = C.nigriBodies(rows, range, 'B3 ET', names);
  assert.deepEqual(bodies.map(b => b.kind), ['posuk', 'chidon']);
  const p = bodies[0].body;
  assert.equal(p.topic, 'Chumash'); assert.equal(p.type, 'homework'); assert.equal(p.date, '2026-11-20'); assert.equal(p.class_section, 'B3 ET');
  assert.deepEqual(p.students.map(s => [s.name, s.mark]), [['Boy A', 80]]);
  assert.equal(bodies[1].body.topic, 'Chumash Comprehension');
});
test('matching practice students to the roster by id or by name words', () => {
  const roster = ['chaim_chaikin', 'yossi_gourarie'], names = { chaim_chaikin: 'Chaikin Mayer Chaim', yossi_gourarie: 'Gourarie Yossi' };
  assert.equal(C.matchRosterId('yossi_gourarie', 'x', roster, names), 'yossi_gourarie');
  assert.equal(C.matchRosterId('abc123', 'Yossi Gourarie', roster, names), 'yossi_gourarie');
  assert.equal(C.matchRosterId('abc124', 'Somebody Else', roster, names), null);
});
test('wiring: page loads the helpers; staging gets no real roster; rules block a second send', () => {
  const page = fs.readFileSync(__dirname + '/../record_pesukim/teacher.html', 'utf8');
  ['nigri-connect.js', 'weekly-practice-marks-core.js', 'weekly-nigri-roster.js', 'weekly-nigri.js'].forEach(f => assert.ok(page.includes(f), f));
  assert.ok(fs.readFileSync(__dirname + '/../staging/prepare-site.cjs', 'utf8').includes("record_pesukim/weekly-nigri-roster.js"));
  const ui = fs.readFileSync(__dirname + '/../record_pesukim/weekly-nigri.js', 'utf8');
  assert.ok(!/1qaz/.test(ui), 'the key lives only in the roster file, which staging replaces with a stub');
  assert.match(ui, /NigriAuth\.request\('\/sync-marks'[\s\S]*?ROSTER && ROSTER\.syncKey\)/);
  assert.ok(!/1qaz/.test('window.WEEKLY_NIGRI_ROSTER = null;'));
  for (const f of ['firebase-rules.json', 'firebase-rules.hardened.json']) {
    const r = JSON.parse(fs.readFileSync(__dirname + '/../' + f, 'utf8')).rules.b3Quiz.weeklyPracticeNigri.$classId.$week.$kind;
    assert.match(r['.write'], /!data\.exists\(\)/);
  }
});

test('both roster copies (weekly quiz sync and weekly practice marks) list the same boys and Nigri names', () => {
  const quiz = fs.readFileSync(__dirname + '/../weekly-quiz/nigri-sync.js', 'utf8');
  const grab = re => { const m = re.exec(quiz); return m && m[1]; };
  const rosters = new Function('return ' + grab(/const NIGRI_ROSTERS = (\{[\s\S]*?\});\s*const NIGRI_NAMES/))();
  const names = new Function('return ' + grab(/const NIGRI_NAMES = (\{[\s\S]*?\});/))();
  global.window = {}; eval(fs.readFileSync(__dirname + '/../record_pesukim/weekly-nigri-roster.js', 'utf8'));
  const R = global.window.WEEKLY_NIGRI_ROSTER; delete global.window;
  assert.deepEqual(R.rosters, rosters);
  assert.deepEqual(R.names, names);
  assert.ok(R.rosters.et.includes('berel_raichik') && R.names.berel_raichik === 'Raichik Berel');
});

test('owner send: sign-in first, old key only as the 401 fallback, same key as the Weekly Quiz', () => {
  const quiz = fs.readFileSync(__dirname + '/../weekly-quiz/nigri-sync.js', 'utf8');
  const quizKey = /const SYNC_KEY = '([^']+)'/.exec(quiz)[1];
  global.window = {}; eval(fs.readFileSync(__dirname + '/../record_pesukim/weekly-nigri-roster.js', 'utf8'));
  const R = global.window.WEEKLY_NIGRI_ROSTER; delete global.window;
  assert.equal(R.syncKey, quizKey);
});
