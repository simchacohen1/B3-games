'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMeter, feedbackFor, rmsFromFloatSamples, teacherRows, levelInfo, voiceWeight, LEVELS } = require('../chayus-meter/core.js');

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

test('the meter panel itself makes no network or recording calls and mounts on both ET and WT pages', () => {
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
  // The picture itself only gets steadiness, voiceHeard and a gentle reminder flag, never the volume.
  assert.ok(!Object.keys(comfortable.live).some(key => /rms|^volume$|^loudness$/i.test(key)));
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
  const resting = m.live();
  assert.equal(resting.calibrating, false);
  assert.equal(resting.voiceHeard, false);
  assert.equal(resting.gentleVolumeHint, false);
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

// ---- Levels, counted time, class audio and the easier bar -----------------------------------------------

function feed(m, level, fromMs, toMs, aux) {
  for (let t = fromMs + 200; t <= toMs; t += 200) m.sample(level, t, aux);
  return toMs;
}
// Speech-like: a word every sample, with a short gap every sixth sample (so the room-sound estimate stays low).
function speak(m, level, fromMs, toMs) {
  for (let t = fromMs + 200; t <= toMs; t += 200) m.sample((t / 200) % 6 === 0 ? 0.002 : level, t);
  return toMs;
}
// A meter that has already learned a quiet room (a 0.2% room sound => the lowest bar, 0.007).
function calibrated() {
  const m = createMeter({ calibrationMs: 1000 });
  m.start(0);
  for (let t = 200; t <= 1000; t += 200) m.sample(0.002, t);
  return m;
}

test('10 levels at 1, 3, 5, 7, 10, 14, 18, 22, 26 and 30 counted minutes, each with its own name', () => {
  assert.deepEqual(LEVELS.map(row => row.minutes), [1, 3, 5, 7, 10, 14, 18, 22, 26, 30]);
  assert.deepEqual(LEVELS.map(row => row.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(new Set(LEVELS.map(row => row.name)).size, 10);
  assert.ok(LEVELS.every(row => row.name && row.cheer));
  assert.equal(levelInfo(0).level, 0);
  assert.equal(levelInfo(59.9).level, 0);
  assert.equal(levelInfo(60).level, 1);
  assert.equal(levelInfo(179).level, 1);
  assert.equal(levelInfo(180).level, 2);
  assert.equal(levelInfo(1799).level, 9);
  assert.equal(levelInfo(1800).level, 10);
  assert.equal(levelInfo(99999).level, 10);
  assert.equal(levelInfo(99999).points, 10);
});

test('level info shows how close the next level is', () => {
  const info = levelInfo(120); // level 1, halfway between 60s and 180s
  assert.equal(info.level, 1);
  assert.equal(info.nextLevel, 2);
  assert.equal(info.secondsToNext, 60);
  assert.equal(info.progressToNext, 0.5);
  const top = levelInfo(1800);
  assert.equal(top.nextLevel, null);
  assert.equal(top.progressToNext, 1);
  assert.equal(top.secondsToNext, 0);
});

test('only seconds a voice is heard count: quiet time, pauses and clock time do not', () => {
  const m = createMeter({ calibrationMs: 0 });
  m.start(0);
  let t = feed(m, 0.04, 0, 10000);      // 10 s of voice
  t = feed(m, 0.001, t, t + 20000);     // 20 s of quiet
  m.pause(t);
  m.start(t + 600000);                  // ten minutes paused
  assert.equal(m.snapshot().countedSeconds, 10);
  assert.equal(m.snapshot().activeSeconds, 10);
});

test('a normal voice counts 1x, a stronger voice up to 2x, and shouting adds nothing beyond that', () => {
  function counted(level) {
    const m = calibrated();
    feed(m, level, 1000, 11000);
    return m.snapshot().countedSeconds;
  }
  const bar = 0.007; // the lowest bar a microphone can have
  assert.equal(counted(0.015), 10);                              // normal voice: exactly 1x
  const between = counted(bar * 4.5);
  assert.ok(between > 10 && between < 20, 'in between was ' + between);
  // A strong voice is 2x. (The bar drifts up a hair under a continuous voice, hence the small tolerance.)
  for (const strong of [0.1, 0.3, 0.95]) {
    const seconds = counted(strong);
    assert.ok(seconds >= 19.5 && seconds <= 20, 'strong voice ' + strong + ' counted ' + seconds);
  }
  assert.equal(voiceWeight(0.001, 0.007), 0);
  assert.equal(voiceWeight(0.5, 0.007), 2);
});

test('counted time is bounded so a day cannot grow past the top level', () => {
  const m = createMeter({ calibrationMs: 0 });
  m.start(0);
  for (let t = 200; t <= 3600000; t += 200) m.sample(0.3, t);
  assert.ok(m.snapshot().countedSeconds <= 1860);
  assert.equal(m.live().level, 10);
});

test('reaching a level is reported once, and a server total is adopted without a celebration', () => {
  const m = calibrated();
  assert.equal(m.consumeLevelUp(), 0);
  speak(m, 0.04, 1000, 81000);
  assert.equal(m.live().level, 1);
  assert.equal(m.consumeLevelUp(), 1);
  assert.equal(m.consumeLevelUp(), 0);
  const fresh = createMeter({ calibrationMs: 0 });
  fresh.adoptCountedSeconds(500); // already past level 4 (7 minutes) earlier today
  fresh.start(0);
  assert.equal(fresh.live().level, 4);
  assert.equal(fresh.consumeLevelUp(), 0);
  speak(fresh, 0.04, 0, 5000);
  assert.equal(fresh.consumeLevelUp(), 0);
  fresh.adoptCountedSeconds(400); // an older total never lowers it
  assert.ok(fresh.live().countedSeconds >= 500);
});

test('a new day starts from zero', () => {
  const m = calibrated();
  speak(m, 0.04, 1000, 81000);
  assert.equal(m.live().level, 1);
  m.resetDay();
  assert.equal(m.live().level, 0);
  assert.equal(m.snapshot().countedSeconds, 0);
  speak(m, 0.04, 81000, 82000);
  assert.equal(m.consumeLevelUp(), 0);
});

test('class audio from the speakers alone earns no counted time, even when it is loud', () => {
  const m = createMeter({ calibrationMs: 0 });
  m.start(0);
  // The mic hears the class audio at about 70% of its level. It starts playing while he is silent.
  const t = feed(m, 0.0, 0, 2000);
  for (let at = t + 200; at <= 60000; at += 200) {
    const playback = 0.05 + 0.03 * Math.sin(at / 700);
    m.sample(0.7 * playback, at, { playing: true, playbackLevel: playback });
  }
  assert.equal(m.snapshot().countedSeconds, 0);
});

test('a voice clearly above the class audio still counts while it plays', () => {
  const m = createMeter({ calibrationMs: 0 });
  m.start(0);
  const t = feed(m, 0.0, 0, 2000);
  for (let at = t + 200; at <= 30000; at += 200) {
    m.sample(0.7 * 0.05, at, { playing: true, playbackLevel: 0.05 });
  }
  const before = m.snapshot().countedSeconds;
  for (let at = 30200; at <= 40000; at += 200) {
    m.sample(0.7 * 0.05 + 0.12, at, { playing: true, playbackLevel: 0.05 });
  }
  const counted = m.snapshot().countedSeconds - before;
  assert.equal(before, 0);
  assert.ok(counted >= 9, 'voice over class audio counted ' + counted);
});

test('when the page cannot report the class audio level, steady speaker sound is still not counted', () => {
  const m = createMeter({ calibrationMs: 0 });
  m.start(0);
  const t = feed(m, 0.0, 0, 2000);
  for (let at = t + 200; at <= 60000; at += 200) m.sample(0.04, at, { playing: true });
  assert.ok(m.snapshot().countedSeconds < 3, 'steady speaker sound counted ' + m.snapshot().countedSeconds);
});

test('the bar is easier for a normal quiet voice than it used to be', () => {
  // A quiet morning voice, about 1.2% of full scale (dipping to 0.85% between words), on a mic with a 0.4%
  // room sound. The old bar for that mic was 0.0128, so this voice was never heard at all.
  const m = createMeter({ calibrationMs: 1000 });
  m.start(0);
  for (let t = 200; t <= 1000; t += 200) m.sample(0.004, t);
  for (let t = 1200; t <= 11200; t += 200) m.sample((t / 200) % 4 === 0 ? 0.0085 : 0.012, t);
  const data = m.snapshot();
  assert.ok(data.soundActivityPercent >= 90, 'quiet voice heard only ' + data.soundActivityPercent + '%');
  assert.ok(data.countedSeconds >= 9);
});

test('room sound alone is still not counted as a voice', () => {
  const m = createMeter({ calibrationMs: 1000 });
  m.start(0);
  for (let t = 200; t <= 1000; t += 200) m.sample(0.004, t);
  for (let t = 1200; t <= 30000; t += 200) m.sample(0.004 + 0.0015 * Math.sin(t / 300), t);
  assert.equal(m.snapshot().countedSeconds, 0);
});

test('teachers are routed to the Chayus Meter teacher dashboard everywhere', () => {
  const fs = require('node:fs'); const path = require('node:path'); const root = path.join(__dirname, '..'); const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  assert.match(read('index.html'), /"chayus-meter":"chayus-meter\/teacher\.html"/, 'index.html teacher map');
  assert.match(read('teacher-preview-tool.html'), /"chayus-meter":\["Chayus Meter","chayus-meter\/teacher\.html"\]/, 'owner preview map');
  assert.match(read('shared/home-tool-registry.js'), /id:"chayus-meter"[^}]*teacherHref:"chayus-meter\/teacher\.html"/, 'Teacher Home tile');
  const student = read('chayus-meter/index.html');
  assert.match(student, /id="teacherReport"[^>]*href="teacher\.html"[^>]*hidden/, 'Teacher report link starts hidden');
  assert.match(student, /teacher-link\.js/, 'link script loaded');
  assert.match(read('chayus-meter/teacher-link.js'), /access\.role === 'admin' \|\| access\.role === 'teacher'/, 'shown only to teacher or admin');
});
