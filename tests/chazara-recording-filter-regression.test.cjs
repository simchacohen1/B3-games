'use strict';
// Execute the real Chazara teacher recording-filter functions against fictional
// events. No browser, Firebase connection, or production records are required.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('chazara/teacher.html', 'utf8');
function section(start, end) {
  const a = html.indexOf(start);
  const b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Expected Chazara filter implementation: ' + start);
  return html.slice(a, b);
}
function filters(pending) {
  const source = [
    section('function startOfLocalDay(', 'function applyRecordingFilters('),
    section('function recordingStatus(', 'function formatAudioLength('),
    section('function recordingKey(', 'function updateRecordingRow(')
  ].join('\n');
  return new Function('pendingRecordingKeys', source +
    '\nreturn {recordingMatches,recordingDateMatch};')(pending);
}
const key = (studentId, id) => JSON.stringify([studentId, id]);
const base = {studentId:'fictional_a',id:'pending1',perek:18,posuk:3,
  recorded:true,reviewApplied:true,pointRequestStatus:'pending',
  createdAt:new Date(2026,9,27,12,0,0).getTime()};

test('pending filter includes only the exact queued student/event pair', () => {
  const {recordingMatches: match} = filters(new Set([key('fictional_a','pending1')]));
  assert.equal(match(base,{review:'pending'}),true);
  assert.equal(match({...base,id:'older'},{review:'pending'}),false);
  assert.equal(match({...base,studentId:'fictional_b'},{review:'pending'}),false);
  assert.equal(match({...base,pointRequestStatus:'rejected'},{review:'pending'}),false);
  assert.equal(match({...base,teacherRejected:true},{review:'pending'}),false);
});

test('full-review filters distinguish needs, checked, and rejected', () => {
  const {recordingMatches: match} = filters(new Set());
  assert.equal(match(base,{review:'needs'}),true);
  assert.equal(match(base,{review:'checked'}),false);
  assert.equal(match({...base,teacherFullyChecked:true},{review:'needs'}),false);
  assert.equal(match({...base,teacherFullyChecked:true},{review:'checked'}),true);
  assert.equal(match({...base,teacherFullyChecked:true,pointRequestStatus:'rejected'},{review:'checked'}),false);
  assert.equal(match({...base,teacherRejected:true},{review:'needs'}),false);
});

test('student, perek and pasuk filters combine without cross-student leakage', () => {
  const {recordingMatches: match} = filters(new Set([key('fictional_a','pending1')]));
  assert.equal(match(base,{review:'pending',student:'fictional_a',perek:'18',pasuk:'3'}),true);
  assert.equal(match(base,{review:'pending',student:'fictional_b'}),false);
  assert.equal(match(base,{review:'pending',perek:'19'}),false);
  assert.equal(match(base,{review:'pending',pasuk:'4'}),false);
  assert.equal(match(base,{review:'pending',perek:'18',pasuk:'4'}),false);
});

test('date filters use inclusive local calendar boundaries and exclude undated rows', () => {
  const {recordingDateMatch: match} = filters(new Set());
  const onDay = {...base};
  assert.equal(match(onDay,{date:'custom',dateFrom:'2026-10-27',dateTo:'2026-10-27'}),true);
  assert.equal(match({...base,createdAt:new Date(2026,9,27,0,0,0).getTime()},
    {date:'custom',dateFrom:'2026-10-27',dateTo:'2026-10-27'}),true);
  assert.equal(match({...base,createdAt:new Date(2026,9,27,23,59,59,999).getTime()},
    {date:'custom',dateFrom:'2026-10-27',dateTo:'2026-10-27'}),true);
  assert.equal(match(onDay,{date:'custom',dateFrom:'2026-10-28'}),false);
  assert.equal(match(onDay,{date:'custom',dateTo:'2026-10-26'}),false);
  assert.equal(match({...base,createdAt:0},{date:'custom',dateFrom:'2026-10-27'}),false);
  assert.equal(match({...base,createdAt:Date.now()},{date:'today'}),true);
  assert.equal(match({...base,createdAt:Date.now()},{date:'week'}),true);
  assert.equal(match({...base,createdAt:Date.now()},{date:'last7'}),true);
  assert.equal(match({...base,createdAt:Date.now()},{date:'month'}),true);
});

test('returning to pending mode cancels lazy history generation', () => {
  assert.match(html,/if\(recordingFilters\(\)\.review==='pending'\)\{historyGeneration\+\+;historyLoading=false;renderRecordings\(\);return\}/);
  assert.match(html,/if\(generation!==scopeGeneration\|\|request!==historyGeneration\)return/);
  assert.match(html,/teacherApi\('list-chazara-history',\{studentId:id\}\)/);
});
