'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMeter, feedbackFor, rmsFromFloatSamples, teacherRows } = require('../chayus-meter/core.js');

test('RMS is bounded and treats non-finite samples as silence', () => {
  assert.equal(rmsFromFloatSamples([]), 0);
  assert.ok(Math.abs(rmsFromFloatSamples([1, 0, -1, 0]) - Math.sqrt(0.5)) < 1e-12);
  assert.equal(rmsFromFloatSamples([NaN, Infinity]), 0);
});

test('only consented active sampling counts and paused time is excluded', () => {
  const m = createMeter({ calibrationMs: 0 });
  m.sample(0.4, 200);
  assert.equal(m.snapshot().measuredSeconds, 0);
  m.start(0);
  m.sample(0.15, 200);
  m.pause();
  m.sample(0.15, 80000);
  m.start(80000);
  m.sample(0.15, 80200);
  const result = m.finish();
  assert.equal(result.measuredSeconds, 0.4);
  assert.equal(result.activeSeconds, 0.4);
  assert.equal(result.soundActivityPercent, 100);
  assert.equal(result.status, 'ended');
  assert.throws(() => m.start(90000), /ended/);
});

test('calibration is excluded from reported measured duration', () => {
  const m = createMeter({ calibrationMs: 1000 });
  m.start(0);
  for (let t = 200; t <= 1000; t += 200) m.sample(0.008, t);
  assert.equal(m.snapshot().measuredSeconds, 0);
  m.sample(0.1, 1200);
  assert.equal(m.snapshot().measuredSeconds, 0.2);
});

test('silent and measured sessions differ from no-mic data', () => {
  const noData = createMeter().finish();
  assert.equal(noData.hasMeasuredActivity, false);
  const m = createMeter({ calibrationMs: 0 });
  m.start(0);
  m.sample(0, 200);
  const silent = m.finish();
  assert.equal(silent.hasMeasuredActivity, true);
  assert.equal(silent.soundActivityPercent, 0);
});

test('sound loudness gives no extra credit beyond activity', () => {
  function run(level) {
    const m = createMeter({ calibrationMs: 0 });
    m.start(0);
    for (let t = 200; t <= 1000; t += 200) m.sample(level, t);
    return m.finish();
  }
  const normal = run(0.1);
  const loud = run(0.95);
  assert.equal(normal.activeSeconds, loud.activeSeconds);
  assert.equal(normal.soundActivityPercent, loud.soundActivityPercent);
  assert.ok(!('points' in loud));
  assert.ok(!('audio' in loud));
});

test('feedback is periodic, gentle and does not reveal scores', () => {
  const m = createMeter({ calibrationMs: 0, feedbackEveryMs: 1000 });
  m.start(0);
  const msgs = [];
  for (let t = 200; t <= 2200; t += 200) {
    const msg = m.sample(t <= 1200 ? 0.1 : 0, t);
    if (msg) msgs.push(msg);
  }
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0], feedbackFor(1));
  assert.match(msgs[1], /effort matters|Every word counts/);
  assert.equal(m.snapshot().feedbackCount, 2);
});

test('clock gaps and invalid samples do not create false activity', () => {
  const m = createMeter({ calibrationMs: 0 });
  m.start(0);
  assert.equal(m.sample(NaN, 200), null);
  m.sample(0.1, 30000);
  assert.equal(m.snapshot().measuredSeconds, 0.6);
  m.sample(0.1, -100);
  assert.equal(m.snapshot().measuredSeconds, 0.6);
});

test('teacher rows distinguish unavailable data and never compute point awards', () => {
  const rows = teacherRows([
    { studentId: 'fictional-2', studentName: 'Zev Example', metrics: null },
    { studentId: 'fictional-1', studentName: 'Ari Example', metrics: { measuredSeconds: 120, activeSeconds: 60, soundActivityPercent: 999 } }
  ]);
  assert.equal(rows[0].studentName, 'Ari Example');
  assert.equal(rows[0].soundActivityPercent, 50);
  assert.equal(rows[0].measuredMinutes, 2);
  assert.equal(rows[1].soundActivityPercent, null);
  assert.equal(rows[1].status, 'No microphone data');
  assert.ok(rows.every(row => !('points' in row) && !('recommendedPoints' in row)));
});

test('overlong or bad reports are bounded by a maximum of two hours', () => {
  const [row] = teacherRows([{ studentId: 'fictional', studentName: 'Example', metrics: { measuredSeconds: 999999, activeSeconds: 999999 } }]);
  assert.equal(row.measuredMinutes, 120);
  assert.equal(row.soundActivityPercent, 100);
});

test('consistency counts activity across measured intervals, excluding paused time', () => {
  const m = createMeter({ calibrationMs: 0 });
  m.start(0);
  for (let at = 500; at <= 150000; at += 500) m.sample(0.2, at);
  m.pause();
  m.start(200000);
  for (let at = 200500; at <= 350000; at += 500) m.sample(0, at);
  const data = m.finish();
  assert.equal(data.feedbackCount, 2);
  assert.equal(data.activeIntervals, 1);
  assert.equal(data.soundActivityPercent, 50);
});

test('server allowlists bounded aggregate metrics only', () => {
  const { validateMetrics } = require('../backend/functions/chayus-report-core.cjs');
  const metrics = { measuredSeconds: 300, activeSeconds: 150, calibrationSeconds: 3,
    feedbackCount: 2, activeIntervals: 1 };
  assert.deepEqual(validateMetrics({ ...metrics, studentId: 'spoof', audio: [0.2] }, 303), metrics);
  assert.throws(() => validateMetrics(metrics, 200), /Invalid/);
  assert.throws(() => validateMetrics({ ...metrics, activeIntervals: 3 }, 303), /Invalid/);
  assert.throws(() => validateMetrics({ ...metrics, activeSeconds: 301 }, 303), /Invalid/);
});
