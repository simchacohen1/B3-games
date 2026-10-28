'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('chazara/teacher.html', 'utf8');
const source = html.match(/^function recordingKey\(e\)\{[^\r\n]*\}/m)?.[0];
assert.ok(source, 'Chazara recording row key function must exist');
const recordingKey = vm.runInNewContext(source + ';recordingKey', {});

test('recording DOM keys keep student and event identifiers separate', () => {
  const first = recordingKey({studentId: 'shared__x', id: 'y'});
  const second = recordingKey({studentId: 'shared', id: 'x__y'});
  assert.notEqual(first, second,
    'delimiter-concatenated keys would reuse a different student recording row');
  assert.equal(first, JSON.stringify(['shared__x', 'y']));
  assert.equal(second, JSON.stringify(['shared', 'x__y']));
});

test('recording keys are stable for the same tuple, including punctuation', () => {
  const event = {studentId: 'fictional_"student"', id: 'event__42'};
  assert.equal(recordingKey(event), recordingKey({...event}));
  assert.notEqual(recordingKey(event),
    recordingKey({...event, studentId: 'fictional_student'}));
  assert.notEqual(recordingKey(event),
    recordingKey({...event, id: 'event_42'}));
});

test('recording row rendering and audio identity use the shared collision-safe key', () => {
  for (const name of ['updateRecordingRow', 'makeRecordingRow', 'renderRecordings', 'applyRecordingFilters']) {
    const start = html.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name + ' must exist');
    const end = html.indexOf('\nfunction ', start + 9);
    const body = html.slice(start, end < 0 ? undefined : end);
    assert.ok(body.includes('recordingKey('), name + ' must use the shared tuple key');
  }
});
