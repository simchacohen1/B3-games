'use strict';
// Fictional-data regression of the actual Chazara teacher lazy-history loader.
// No Firebase connection, credentials, live records, or production writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('chazara/teacher.html', 'utf8');
const start = html.indexOf('async function loadRecordingHistory(){');
const end = html.indexOf('\nfunction eventForRequest(', start);
assert.ok(start >= 0 && end > start, 'extract real lazy-history and filter-change functions');
const source = html.slice(start, end);

function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return {promise, release};
}

function fixture({students = ['student_a', 'student_b', 'student_c'], events = {}, api} = {}) {
  const calls = [], messages = [];
  let renders = 0, refreshes = 0, review = 'checked';
  const studentFilter = {value: ''};
  const recordingsList = {innerHTML: ''};
  const context = {
    scopeGeneration: 1, historyGeneration: 0,
    historyStudentsLoaded: new Set(), historyLoading: false,
    fullDashboardLoaded: false, E: {},
    R: Object.fromEntries(students.map(id => [id, {name: id}])),
    teacherScope: {selected: 'alpha'},
    $: id => id === 'recordingStudentFilter' ? studentFilter :
      id === 'recordingsList' ? recordingsList : null,
    window: {FunTorahTeacherScope: {
      recordAllowed: (_scope, _studentId, event) => event.classId === 'alpha'
    }},
    teacherApi: async (action, args) => {
      assert.equal(action, 'list-chazara-history');
      calls.push(args.studentId);
      return api ? api(args.studentId) : {events: events[args.studentId] || {}};
    },
    renderRecordings: () => { renders++; },
    refreshScopedViews: () => { refreshes++; },
    setRecordingActionStatus: (...args) => messages.push(args),
    recordingFilters: () => ({review}),
    console
  };
  vm.runInNewContext(source + '\nthis.loadHistory=loadRecordingHistory;this.changeFilter=recordingFilterChanged;', context, {
    filename: 'chazara-lazy-history-loader.js'
  });
  return {
    context, calls, messages,
    run: () => context.loadHistory(),
    changeFilter: () => context.changeFilter(),
    select: id => { studentFilter.value = id; },
    review: value => { review = value; },
    renders: () => renders, refreshes: () => refreshes
  };
}

test('selecting one student fetches only that history, filters foreign events and caches successful results', async () => {
  const x = fixture({events: {
    student_b: {
      own: {classId: 'alpha', recorded: true},
      foreign: {classId: 'beta', recorded: true}
    }
  }});
  x.select('student_b');
  await x.run();
  assert.equal(x.calls.join(','), 'student_b');
  assert.equal(Object.keys(x.context.E.student_b).join(','), 'own',
    'a foreign-class event must not enter the browser cache');
  assert.equal(x.context.historyStudentsLoaded.has('student_b'), true);
  assert.equal(x.context.historyStudentsLoaded.has('student_a'), false);
  await x.run();
  assert.equal(x.calls.length, 1, 'already loaded selected history is not fetched twice');
  assert.equal(x.renders(), 2);
});

test('changing class scope while a history request is in flight discards its response', async () => {
  const gate = deferred();
  const x = fixture({api: async () => gate.promise});
  x.select('student_a');
  const pending = x.run();
  assert.equal(x.calls.join(','), 'student_a');
  x.context.scopeGeneration = 2;
  gate.release({events: {old: {classId: 'alpha', recorded: true}}});
  await pending;
  assert.equal(Object.keys(x.context.E).length, 0, 'old class events cannot enter new scope');
  assert.equal(x.context.historyStudentsLoaded.size, 0, 'stale history must not be marked loaded');
  assert.equal(x.renders(), 0, 'stale history must not repaint the new dashboard');
});

test('returning to pending-only view cancels an outstanding history response', async () => {
  const gate = deferred();
  const x = fixture({api: async () => gate.promise});
  x.select('student_a');
  const pending = x.run();
  x.review('pending');
  x.changeFilter();
  gate.release({events: {old: {classId: 'alpha', recorded: true}}});
  await pending;
  assert.equal(x.context.historyLoading, false);
  assert.equal(x.context.historyStudentsLoaded.size, 0);
  assert.equal(Object.keys(x.context.E).length, 0);
  assert.equal(x.renders(), 1, 'pending view renders without waiting for history');
});

test('unfiltered history fetches are batched at four students concurrently', async () => {
  let active = 0, peak = 0;
  const students = Array.from({length: 9}, (_, i) => 'student_' + i);
  const x = fixture({students, api: async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 8));
    active--;
    return {events: {}};
  }});
  await x.run();
  assert.equal(x.calls.length, 9);
  assert.equal(peak, 4, 'history API must not fan out to all nine students at once');
  assert.equal(active, 0);
  assert.equal(x.context.historyStudentsLoaded.size, 9);
});

test('failed history for one student is retried without re-fetching successful students', async () => {
  let failures = 0;
  const x = fixture({students: ['student_a', 'student_b'], api: async id => {
    if (id === 'student_b' && failures++ === 0) throw Error('Synthetic transient failure');
    return {events: {own: {classId: 'alpha', recorded: true}}};
  }});
  await x.run();
  assert.equal(x.context.historyStudentsLoaded.has('student_a'), true);
  assert.equal(x.context.historyStudentsLoaded.has('student_b'), false);
  assert.equal(x.messages.length, 1, 'partial history failure is reported');
  await x.run();
  assert.equal(x.calls.join(','), 'student_a,student_b,student_b');
  assert.equal(x.context.historyStudentsLoaded.size, 2);
});