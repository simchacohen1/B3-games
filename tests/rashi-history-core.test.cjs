const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../rashi-letters/history-core.js');

const at = (s) => new Date(s).getTime();
const NOW = at('2026-11-26T15:00:00'); /* a Thursday */

test('periods: today, yesterday, this week (from Sunday), this month, all', () => {
  assert.deepEqual(H.range('today', NOW), [at('2026-11-26T00:00:00'), at('2026-11-27T00:00:00')]);
  assert.deepEqual(H.range('yesterday', NOW), [at('2026-11-25T00:00:00'), at('2026-11-26T00:00:00')]);
  assert.equal(H.range('week', NOW)[0], at('2026-11-22T00:00:00'));
  assert.equal(H.range('month', NOW)[0], at('2026-11-01T00:00:00'));
  assert.deepEqual(H.range('all', NOW), [0, Infinity]);
});

const rows = [
  { id: 'a', sid: 's1', name: 'Dovid', kind: 'reading', when: at('2026-11-26T09:00:00'), label: 'Vayeira 18:1' },
  { id: 'b', sid: 's1', name: 'Dovid', kind: 'reading', when: at('2026-11-26T10:00:00'), label: 'Vayeira 18:2' },
  { id: 'c', sid: 's2', name: 'Moshe', kind: 'reading', when: at('2026-11-25T10:00:00'), label: 'Zayin' },
  { id: 'd', sid: 's2', name: 'Moshe', kind: 'practice', when: at('2026-11-26T11:00:00'), label: 'Practice' },
  { id: 'e', sid: 's3', name: 'Yossi', kind: 'reading', when: at('2026-11-10T10:00:00'), label: 'Bet' }
];

test('strip counts are Rashi readings only, per student, per period', () => {
  assert.deepEqual(H.counts(rows, H.range('today', NOW)), { s1: 2 }); /* practice does not count */
  assert.deepEqual(H.counts(rows, H.range('yesterday', NOW)), { s2: 1 });
  assert.deepEqual(H.counts(rows, H.range('week', NOW)), { s1: 2, s2: 1 });
});

test('chips list the whole class by name with counts', () => {
  const c = H.chips({ s2: 'Moshe', s1: 'Dovid', s3: 'Yossi' }, { s1: 2 });
  assert.deepEqual(c.map(x => [x.name, x.count, x.recorded]), [['Dovid', 2, true], ['Moshe', 0, false], ['Yossi', 0, false]]);
});

test('filter by student, range and posuk search', () => {
  assert.deepEqual(H.filter(rows, { sid: 's1' }).map(r => r.id), ['a', 'b']);
  assert.deepEqual(H.filter(rows, { range: H.range('yesterday', NOW) }).map(r => r.id), ['c']);
  assert.deepEqual(H.filter(rows, { text: '18:2' }).map(r => r.id), ['b']);
  assert.deepEqual(H.filter(rows, { sid: 's2', range: H.range('today', NOW) }).map(r => r.id), ['d']);
});

test('grouping: newest first with Today, Yesterday, then dates', () => {
  const g = H.groupByDay(rows, NOW);
  assert.equal(g[0].heading, 'Today');
  assert.deepEqual(g[0].rows.map(r => r.id), ['d', 'b', 'a']);
  assert.equal(g[1].heading, 'Yesterday');
  assert.match(g[2].heading, /Nov 10/);
  assert.equal(g.length, 3);
});

test('server rows win over the same reading from the history; label comes from the reason', () => {
  const m = H.mergeReadings([{ id: 'x', status: 'Marked', result: 'Reading 90%' }], [{ id: 'x', sid: 's1', label: 'L', status: 'Waiting to mark' }, { id: 'y', sid: 's1' }]);
  assert.equal(m.length, 2);
  const x = m.find(r => r.id === 'x');
  assert.equal(x.status, 'Marked'); assert.equal(x.label, 'L'); assert.equal(x.sid, 's1');
  assert.equal(H.labelFromReason('Rashi Letters reading — Vayeira 18:1'), 'Vayeira 18:1');
});
