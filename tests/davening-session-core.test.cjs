const test = require('node:test');
const assert = require('node:assert/strict');
const { newSession, spin, setPlayback, setChazzanSpeed } =
  require('../backend/functions/davening-session-core.cjs');

function signup(session, studentId, requestId) {
  return spin(session, { studentId, requestId, name: studentId, entropy: 0 });
}

test('serialized spins assign the final part once and replay without another assignment', () => {
  const initial = newSession('session', ['ashrei']);
  const assigned = signup(initial, 'boy-a', 'request-a');
  assert.equal(signup(assigned, 'boy-a', 'request-a'), assigned);
  assert.throws(() => signup(assigned, 'boy-b', 'request-b'), /All parts/);
  assert.equal(initial.parts.ashrei.studentId, undefined);
});

test('two parts per student and teacher start closes signup', () => {
  let session = newSession('session', ['ashrei', 'shema', 'aleinu']);
  session = signup(signup(session, 'boy-a', 'a'), 'boy-a', 'b');
  assert.throws(() => signup(session, 'boy-a', 'c'), /two parts/);
  session = setPlayback(session, { part: 'ashrei', speed: 1 });
  assert.throws(() => signup(session, 'boy-b', 'd'), /closed/);
});

test('speed is scoped to the active chazzan and persisted separately per part', () => {
  let session = newSession('session', ['ashrei', 'shema']);
  session = signup(signup(session, 'boy-a', 'a'), 'boy-a', 'b');
  session = setPlayback(session, { part: 'ashrei', speed: 1 });
  const change = { studentId: 'boy-a', partId: 'ashrei', speed: 1.4, requestId: 'first' };
  assert.throws(() => setChazzanSpeed(session, { ...change, studentId: 'boy-b' }), /assigned/);
  assert.throws(() => setChazzanSpeed(session, { ...change, speed: 1.9 }), /speed from/);
  session = JSON.parse(JSON.stringify(setChazzanSpeed(session, change)));
  assert.equal(session.playback.speed, 1.4);
  assert.equal(setChazzanSpeed(session, change), session);
  session = setChazzanSpeed(session, { ...change, requestId: 'second', speed: 1.5 });
  assert.throws(() => setChazzanSpeed(session, { ...change, requestId: 'third' }), /both speed/);
  session = setPlayback(session, { part: 'shema', speed: 1 });
  assert.throws(() => setChazzanSpeed(session, { ...change, requestId: 'third' }), /no longer active/);
  session = setChazzanSpeed(session, { ...change, partId: 'shema' });
  assert.equal(session.parts.shema.changes, 1);
  assert.equal(session.parts.ashrei.changes, 2);
});
