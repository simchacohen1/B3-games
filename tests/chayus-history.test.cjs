'use strict';
// Teacher dashboard + full student report for the Chayus Meter: read-only history, no change to counting or awards.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../backend/functions/chayus-points-core.cjs');
const H = require('../chayus-meter/history.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const NOW = Date.parse('2026-11-25T14:00:00Z'); // Wednesday 9am New York

function storeWith(rows) {
  const reads = [];
  return { reads, get: async p => { reads.push(p); return rows[p] === undefined ? null : JSON.parse(JSON.stringify(rows[p])); } };
}
const students = { a: { name: 'Test Student A1' }, b: { name: 'Test Student A2' }, c: { name: 'Test Student A3' } };

test('dayKeys counts back school days from New York today, newest first, across a month end', () => {
  assert.deepEqual(core.dayKeys(NOW, 3), ['2026-11-25', '2026-11-24', '2026-11-23']);
  assert.deepEqual(core.dayKeys(Date.parse('2026-12-02T03:00:00Z'), 3), ['2026-12-01', '2026-11-30', '2026-11-29']); // still Dec 1 in New York
});

test('classHistory returns level, counted minutes and points per recorded day, and only reads', async () => {
  const s = storeWith({
    'studentRewards/chayusDaily/a': {
      '2026-11-25': { countedSeconds: 450, awardedLevel: 3 },   // 7.5 min -> level 4 (7 min)
      '2026-11-24': { countedSeconds: 1860, awardedLevel: 10 },
      '2026-09-01': { countedSeconds: 600, awardedLevel: 5 }    // older than the window
    },
    'studentRewards/chayusDaily/b': { '2026-11-25': { countedSeconds: 20, awardedLevel: 0 } }
  });
  const h = await core.classHistory({ get: s.get, students, days: 7, nowMs: NOW });
  assert.equal(h.today, '2026-11-25');
  assert.equal(h.days.length, 7);
  assert.deepEqual(h.students.a.days['2026-11-25'], { countedSeconds: 450, minutes: 7.5, level: 4, levelName: 'Steady Flame', points: 3 });
  assert.equal(h.students.a.days['2026-11-24'].level, 10);
  assert.equal(h.students.a.days['2026-11-24'].levelName, 'Chayus Champion');
  assert.equal(h.students.a.days['2026-09-01'], undefined);
  assert.equal(h.students.b.days['2026-11-25'].level, 0);
  assert.equal(h.students.b.days['2026-11-25'].levelName, '');
  assert.deepEqual(h.students.c.days, {});
  assert.equal(h.students.c.name, 'Test Student A3');
  assert.ok(s.reads.every(p => p.startsWith('studentRewards/chayusDaily/')), 'only reads chayusDaily');
});

test('classHistory clamps days, ignores unsafe student ids and bad records', async () => {
  const s = storeWith({ 'studentRewards/chayusDaily/a': { '2026-11-25': { countedSeconds: 999999, awardedLevel: 99 }, '2026-11-24': 'junk', '2026-11-23': null } });
  const huge = await core.classHistory({ get: s.get, students: { a: students.a, '../x': { name: 'bad' } }, days: 100000, nowMs: NOW });
  assert.equal(huge.days.length, 90);
  assert.deepEqual(Object.keys(huge.students), ['a']);
  assert.equal(huge.students.a.days['2026-11-25'].countedSeconds, core.MAX_DAY_SECONDS);
  assert.equal(huge.students.a.days['2026-11-25'].points, 10);
  assert.deepEqual(Object.keys(huge.students.a.days), ['2026-11-25']);
  assert.equal((await core.classHistory({ get: s.get, students, days: 'abc', nowMs: NOW })).days.length, 30);
  assert.equal((await core.classHistory({ get: s.get, students, days: 0, nowMs: NOW })).days.length, 30);
});

test('history helpers: recent week, student summary for a period, class day totals', async () => {
  const s = storeWith({
    'studentRewards/chayusDaily/a': { '2026-11-25': { countedSeconds: 450, awardedLevel: 3 }, '2026-11-23': { countedSeconds: 70, awardedLevel: 1 }, '2026-11-10': { countedSeconds: 200, awardedLevel: 1 } },
    'studentRewards/chayusDaily/b': { '2026-11-25': { countedSeconds: 100, awardedLevel: 1 } }
  });
  const h = await core.classHistory({ get: s.get, students, days: 30, nowMs: NOW });
  const week = H.recentDays(h, 'a', '2026-11-25', 7);
  assert.equal(week.length, 7);
  assert.equal(week[0].day, '2026-11-25');
  assert.equal(week[0].entry.level, 4);
  assert.equal(week[1].entry, null);
  assert.equal(week[2].entry.level, 1);
  assert.equal(H.recentDays(h, 'a', '2026-11-25', 7).length, 7);
  const near = H.summarizeStudent(h, 'a', '2026-11-19');
  assert.equal(near.activeDays, 2);
  assert.equal(near.bestLevel, 4);
  assert.equal(near.totalPoints, 4);
  assert.equal(near.totalMinutes, 8.7);
  assert.equal(H.summarizeStudent(h, 'a', '').activeDays, 3);
  assert.equal(H.summarizeStudent(h, 'c', ''), null);
  const day = H.classDay(h, '2026-11-25');
  assert.deepEqual(day, { students: 3, used: 2, avgMinutes: 4.6, points: 4, topLevel: 4 });
  assert.equal(H.classDay(h, '2026-11-20').used, 0);
  assert.equal(H.minutesText({ minutes: 7.5 }), '7.5 min');
  assert.equal(H.minutesText({ minutes: 3 }), '3 min');
  assert.equal(H.minutesText(null), '—');
  assert.equal(H.levelText({ level: 2, levelName: 'Kindling' }), 'Level 2 · Kindling');
  assert.equal(H.schoolDayOf(Date.parse('2026-12-02T03:00:00Z')), '2026-12-01');
});

test('fetchHistory sends only the class and day count with the teacher token, and explains failures', async () => {
  let seen;
  const ok = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ ok: true, days: [], students: {} }) }; };
  await H.fetchHistory({ idToken: 'tok', classId: 'cls', days: 60, projectId: 'fun-torah-tools-staging', fetchImpl: ok });
  assert.equal(seen.url, 'https://us-central1-fun-torah-tools-staging.cloudfunctions.net/studentRewardsAutoAward');
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(seen.init.body), { action: 'chayus-class-history', classId: 'cls', days: 60 });
  const no = async () => ({ ok: false, status: 401, json: async () => ({ error: 'Teacher sign-in expired. Please sign in again.' }) });
  await assert.rejects(() => H.fetchHistory({ idToken: 'tok', classId: 'cls', projectId: 'p', fetchImpl: no }), /Chayus Meter may not be turned on/);
  await assert.rejects(() => H.fetchHistory({ classId: 'cls', projectId: 'p', fetchImpl: ok }), /sign-in required/);
});

test('the server action is teacher-only, class-scoped and wired the same in live and staging functions', () => {
  for (const dir of ['backend/functions', 'backend/functions-staging']) {
    const src = read(dir + '/student-rewards-auto-award.js');
    assert.match(src, /'rashi-letter-stats','chayus-class-history'/, 'non-owner teachers may call it');
    assert.match(src, /act\.startsWith\('chayus-'\)\?\(\['et','wt'\]\.includes\(classId\)\?'chazara':'chayus-meter'\)/, 'class must have the Chayus Meter tool');
    assert.match(src, /action==="chayus-class-history"[\s\S]*teacher\.scope\.students/, 'uses the selected class roster');
    // It sits behind requireTeacher, after the student actions.
    assert.ok(src.indexOf('action==="chayus-class-history"') > src.indexOf('const teacher=await requireTeacher(req);'));
  }
  assert.equal(read('backend/functions/chayus-points-core.cjs').replace(/\r/g, ''), read('backend/functions-staging/chayus-points-core.cjs').replace(/\r/g, ''));
});

test('counting and awarding are untouched: the history code never writes', () => {
  const src = read('backend/functions/chayus-points-core.cjs').replace(/\r/g, '');
  const history = src.slice(src.indexOf('async function classHistory'), src.indexOf('module.exports'));
  assert.doesNotMatch(history, /store\.tx|\.set\(|\.update\(|award\(/);
  const panel = read('chayus-meter/panel.js') + read('chayus-meter/points.js');
  assert.doesNotMatch(panel, /chayus-class-history|ChayusHistory/, 'the student pages know nothing about teacher history');
});

test('dashboard page and student report are wired up', () => {
  const page = read('chayus-meter/teacher.html');
  assert.match(page, /B3ClassGate\.choose/);
  assert.match(page, /type="date"/);
  assert.match(page, /ChayusHistory\.fetchHistory|H\.fetchHistory/);
  assert.match(page, /recentDays\(history,r\.id,day,7\)/, 'last 7 days per student');
  const report = read('student-report/index.html');
  assert.match(report, /chayus-meter\/history\.js/);
  assert.match(report, /chayusEnabledFor\(c,legacy\)/);
  assert.doesNotMatch(report, /TOOL_IDS=\{[^}]*chayus/, 'not one of the counted tools');
  assert.match(report, /chayusBox\(d,t\.chayus,pl\)/);
  assert.match(report, /\['Chayus Meter',x\.day/);
  assert.match(read('shared/home-tool-registry.js'), /chayus-meter\/teacher\.html/);
});
