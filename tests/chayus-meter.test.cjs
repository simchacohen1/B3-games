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
  assert.equal(result.pauseCount, 1);
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
  assert.equal(rows[0].consistencyPercent, null);
  assert.equal(rows[1].consistencyPercent, null);
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

test('the page panel makes no network or recording calls and mounts on both ET and WT pages', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const panel = fs.readFileSync(path.join(root, 'chayus-meter', 'panel.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//, '');
  for (const banned of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'MediaRecorder', 'RTCPeerConnection', 'firebase', 'localStorage', 'sessionStorage']) {
    assert.equal(panel.includes(banned), false, `panel.js must not use ${banned}`);
  }
  for (const page of ['davening_student_app_et', 'davening_student_app_wt']) {
    const html = fs.readFileSync(path.join(root, page, 'index.html'), 'utf8');
    assert.ok(html.includes('../chayus-meter/core.js'), `${page} loads core.js`);
    assert.ok(html.includes('../chayus-meter/panel.js'), `${page} loads panel.js`);
    assert.ok(html.indexOf('chayus-meter/core.js') < html.indexOf('chayus-meter/panel.js'), 'core before panel');
  }
});

test('the on-screen meter follows steadiness and is identical for quiet and loud voices', () => {
  function run(level) {
    const m = createMeter({ calibrationMs: 0 });
    m.start(0);
    const seen = [];
    for (let t = 200; t <= 20000; t += 200) { m.sample(level, t); seen.push(m.live().steadiness); }
    return { seen, live: m.live() };
  }
  const comfortable = run(0.08);
  const shouting = run(0.9);
  assert.deepEqual(comfortable.seen, shouting.seen);
  assert.equal(comfortable.live.voiceHeard, true);
  assert.ok(comfortable.live.steadiness > 0.75 && comfortable.live.steadiness <= 1);
  // Loudness never appears in what the screen is given, only a gentle reminder flag.
  assert.deepEqual(Object.keys(comfortable.live).sort(), ['calibrating', 'gentleVolumeHint', 'steadiness', 'voiceHeard']);
  assert.equal(comfortable.live.gentleVolumeHint, false);
  assert.equal(shouting.live.gentleVolumeHint, true);
});

test('the meter builds gradually, fades in silence, and rests while paused', () => {
  const m = createMeter({ calibrationMs: 1000 });
  m.start(0);
  for (let t = 200; t <= 800; t += 200) m.sample(0.008, t);
  assert.equal(m.live().calibrating, true);
  m.sample(0.008, 1000);
  m.sample(0.1, 1200);
  assert.equal(m.live().calibrating, false);
  const early = m.live().steadiness;
  for (let t = 1400; t <= 13000; t += 200) m.sample(0.1, t);
  const built = m.live().steadiness;
  assert.ok(early < 0.05 && built > 0.6);
  for (let t = 13200; t <= 25000; t += 200) m.sample(0, t);
  assert.ok(m.live().steadiness < built / 2);
  assert.equal(m.live().voiceHeard, false);
  m.pause(25000);
  assert.deepEqual({ ...m.live(), steadiness: 0 }, { calibrating: false, voiceHeard: false, steadiness: 0, gentleVolumeHint: false });
});

test('a boy already davening when he turns the meter on is still heard', () => {
  const m = createMeter();
  m.start(0);
  // Speech-like input from the first moment: words at a comfortable level with short gaps.
  for (let t = 200; t <= 63000; t += 200) m.sample((t / 200) % 5 === 0 ? 0.006 : 0.06, t);
  const data = m.finish();
  assert.equal(data.measuredSeconds, 60);
  assert.ok(data.soundActivityPercent >= 75, `heard only ${data.soundActivityPercent}%`);
});

test('a constant hum is tuned out instead of counting as davening forever', () => {
  const m = createMeter({ calibrationMs: 0 });
  m.start(0);
  for (let t = 200; t <= 300000; t += 200) m.sample(0.05, t);
  assert.equal(m.live().voiceHeard, false);
  assert.ok(m.finish().soundActivityPercent < 50);
});

test('the student Chayus page has the meter but no Davening player, audio or controls, and respects the Davening lock', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'chayus-meter', 'index.html'), 'utf8');
  assert.ok(html.includes('../chayus-meter/core.js') && html.includes('../chayus-meter/panel.js'));
  assert.ok(html.indexOf('chayus-meter/core.js') < html.indexOf('chayus-meter/panel.js'));
  assert.match(html, /student-lock\.js[^>]*data-feature="chayus-meter"/);
  for (const banned of ['<audio', '<video', 'playBtn', 'davening_student_app', 'class-pointer', 'firebase']) {
    assert.equal(html.includes(banned), false, `index.html must not contain ${banned}`);
  }
  // The home tile exists and opens that page. It has its own class permission, its own per-student block and its own lock.
  const registry = fs.readFileSync(path.join(root, 'shared', 'home-tool-registry.js'), 'utf8');
  assert.match(registry, /id:"chayus-meter",title:"Chayus Meter"[^}]*href:"chayus-meter\/index\.html"/);
  const policy = require('../backend/functions/student-tool-policy.js');
  assert.equal(policy.granted({ toolGrants: { 'chayus-meter': true } }, 'chayus-meter'), true);
  assert.equal(policy.granted({ toolGrants: { davening: true } }, 'chayus-meter'), false, 'Davening Player does not open it');
  assert.equal(policy.allowed({ members: { s1: { toolAccess: { 'chayus-meter': false } } } }, 's1', 'chayus-meter'), false);
  assert.ok(policy.studentActivities.includes('chayus-meter'));
  // The student does not get the player: Davening itself is still not a student activity.
  assert.equal(policy.studentActivities.includes('davening'), false);
  assert.ok(require('../backend/functions/class-access-core.cjs').CLASS_TOOL_GRANTS.includes('chayus-meter'));
  assert.ok(require('../student-lock-core.js').FEATURES.some(x => x.id === 'chayus-meter'));
});

// A quiet davening voice on a laptop microphone is only about 1 to 3 percent of full scale.
function quietSession(voiceLevel, roomLevel = 0.003) {
  const m = createMeter(); // default 3 second room-sound measurement
  m.start(0);
  const seen = [];
  for (let t = 200; t <= 3000; t += 200) m.sample(roomLevel * (1 + (t / 200 % 3) * 0.1), t);
  for (let t = 3200; t <= 63000; t += 200) {
    // words with short breaths, like real davening: every fifth moment is a gap
    m.sample((t / 200) % 5 === 0 ? roomLevel : voiceLevel, t);
    seen.push(m.live().steadiness);
  }
  return { data: m.finish(), live: m.live(), seen };
}

test('a normal quiet davening voice registers on a quiet microphone', () => {
  const quiet = quietSession(0.016);
  assert.ok(quiet.data.soundActivityPercent >= 75, `heard only ${quiet.data.soundActivityPercent}%`);
  assert.equal(quiet.live.voiceHeard === true || quiet.live.steadiness > 0.6, true);
  assert.ok(quiet.live.steadiness > 0.6, `steadiness ${quiet.live.steadiness}`);
});

test('a very quiet voice still registers, and shouting looks exactly the same as a quiet voice', () => {
  const veryQuiet = quietSession(0.013);
  assert.ok(veryQuiet.data.soundActivityPercent >= 75, `heard only ${veryQuiet.data.soundActivityPercent}%`);
  const shout = quietSession(0.9);
  assert.deepEqual(quietSession(0.016).seen, shout.seen, 'the meter picture is identical for quiet and shouting');
  assert.equal(shout.data.soundActivityPercent, quietSession(0.016).data.soundActivityPercent);
});

test('room sound alone never counts as davening, however sensitive the meter is', () => {
  const roomOnly = quietSession(0.003);
  assert.ok(roomOnly.data.soundActivityPercent < 10, `room sound counted as ${roomOnly.data.soundActivityPercent}%`);
  assert.equal(roomOnly.live.voiceHeard, false);
  // A steady low sound from the speakers from the very first moment is learned as background, not heard as a voice.
  const speaker = createMeter();
  speaker.start(0);
  for (let t = 200; t <= 120000; t += 200) speaker.sample(0.015, t);
  assert.ok(speaker.finish().soundActivityPercent < 30);
});

test('a noisier room needs a clearer voice: the bar follows each microphone', () => {
  const noisyRoomQuietVoice = quietSession(0.03, 0.02);
  assert.ok(noisyRoomQuietVoice.data.soundActivityPercent < 40);
  const noisyRoomClearVoice = quietSession(0.2, 0.02);
  assert.ok(noisyRoomClearVoice.data.soundActivityPercent >= 75);
});
