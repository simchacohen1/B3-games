'use strict';
// Regression coverage for the kept #404 -> #426 Chazara stack.
// This ports the collision invariant from superseded #451 without importing
// its competing implementation or changing production behavior.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('chazara/teacher.html', 'utf8');
const source = html.match(/^function recordingKey\(e\)\{[^\r\n]*\}/m)?.[0];
assert.ok(source, 'Chazara recordingKey must exist');
const recordingKey = vm.runInNewContext(source + ';recordingKey', {});

test('recording row identity does not collide between fictional students', () => {
  const a = recordingKey({studentId: 'shared__x', id: 'y'});
  const b = recordingKey({studentId: 'shared', id: 'x__y'});
  assert.notEqual(a, b, 'delimiter-joined identifiers can alias distinct recordings');
  assert.equal(a, JSON.stringify(['shared__x', 'y']));
  assert.equal(b, JSON.stringify(['shared', 'x__y']));
});

test('recording identity is stable and distinguishes quoted identifiers', () => {
  const e = {studentId: 'fictional_"student"', id: 'event__42'};
  assert.equal(recordingKey(e), recordingKey({...e}));
  assert.notEqual(recordingKey(e), recordingKey({...e, studentId: 'fictional_student'}));
  assert.notEqual(recordingKey(e), recordingKey({...e, id: 'event_42'}));
});

test('pending queue and recording DOM use matching tuple identities', () => {
  const pendingKey = (studentId, eventId) => JSON.stringify([String(studentId), String(eventId)]);
  const tuples = [
    ['shared__x', 'y'],
    ['shared', 'x__y'],
    ['fictional_"student"', 'event__42'],
  ];
  for (const [studentId, eventId] of tuples) {
    assert.equal(recordingKey({studentId, id: eventId}), pendingKey(studentId, eventId));
  }
  assert.match(html, /pendingRecordingKeys=new Set\(Object\.values\(pendingPointRequests\)/);
  assert.ok(html.includes('map(item=>JSON.stringify([String(item.practiceStudentId),String(item.eventId)]))'),
    'pending queue must use collision-safe tuple keys');
  assert.ok(html.includes('row.dataset.eventKey=recordingKey(e)'),
    'recording DOM rows must use the same identity');
  assert.ok(html.includes('const wanted=new Set(visible.map(recordingKey))'),
    'DOM reconciliation must use collision-safe keys');
  assert.ok(html.includes('const key=recordingKey(e)'),
    'row lookup must use collision-safe keys');
});
