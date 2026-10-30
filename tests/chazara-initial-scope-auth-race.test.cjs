'use strict';
// Fictional-data regression for the actual Chazara initial class-scope loader.
// No Firebase credentials, network, student records or deployed rules are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('chazara/teacher.html', 'utf8');
const start = html.indexOf('async function loadClassScope(user,access){');
const end = html.indexOf('\nwindow.B3SiteSettings.onAuthStateChanged(', start);
assert.ok(start >= 0 && end > start, 'extract the real initial class-scope loader');
const source = html.slice(start, end);

function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return {promise, release};
}
const teacherA = {uid: 'fictional_teacher_a'};
const teacherB = {uid: 'fictional_teacher_b'};
const accessA = {authorized: true, role: 'teacher', classIds: ['alpha']};
const accessB = {authorized: true, role: 'teacher', classIds: ['beta']};
function fixture({assignmentGates = {}, rosterGates = {}, assignmentRows = {}} = {}) {
  const nodes = new Map(), rosterCalls = [], approvalCalls = [], assignmentPaths = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', textContent: '', innerHTML: '',
      classList: {add() {}, remove() {}}
    });
    return nodes.get(id);
  };
  const context = {
    scopeGeneration: 0, historyGeneration: 0, approvalGeneration: 0,
    historyLoading: false, historyStudentsLoaded: new Set(),
    pendingRecordingKeys: new Set(), pendingEventFetches: new Map(),
    teacherAccess: null, teacherScope: null,
    D: {}, R: {}, E: {}, P: {}, pendingPointRequests: {},
    studentListeners: [], fullDashboardLoaded: false,
    auth: {currentUser: teacherA},
    clearStudentListeners() {}, refreshScopedViews() {},
    loadApprovals: async () => { approvalCalls.push(true); },
    needsTeacherAssignmentRefresh: () => true,
    $: node, location: {search: ''}, URLSearchParams, console,
    db: {ref: path => ({once: async () => {
      assignmentPaths.push(path);
      const uid = path.split('/').pop();
      if (assignmentGates[uid]) await assignmentGates[uid];
      return {val: () => assignmentRows[uid] || {
        active: true, classIds: {[uid === teacherA.uid ? 'alpha' : 'beta']: true}
      }};
    }})},
    window: {FunTorahTeacherScope: {roster: async (_read, access) => {
      const id = access.classIds[0];
      rosterCalls.push(id);
      if (rosterGates[id]) await rosterGates[id];
      return {classes: {[id]: {name: id}}, students: {}};
    }}}
  };
  vm.runInNewContext(source + '\nthis.runScope=loadClassScope;', context, {
    filename: 'chazara-initial-class-scope.js'
  });
  return {context, nodes, rosterCalls, approvalCalls, assignmentPaths,
    run: (user, access) => context.runScope(user, access)};
}

test('late old-account assignment cannot replace the newer teacher access during a roster load', async () => {
  const oldAssignment = deferred(), newRoster = deferred(), newRosterEntered = deferred();
  const x = fixture({
    assignmentGates: {[teacherA.uid]: oldAssignment.promise},
    rosterGates: {beta: newRoster.promise}
  });
  // Observe the new roster being entered without using arbitrary timeouts.
  const originalRoster = x.context.window.FunTorahTeacherScope.roster;
  x.context.window.FunTorahTeacherScope.roster = async (...args) => {
    if (args[1].classIds.includes('beta')) newRosterEntered.release();
    return originalRoster(...args);
  };
  const oldLoad = x.run(teacherA, accessA);
  x.context.auth.currentUser = teacherB;
  const newLoad = x.run(teacherB, accessB);
  await newRosterEntered.promise;
  oldAssignment.release();
  await oldLoad;
  assert.deepEqual(Array.from(x.context.teacherAccess.classIds), ['beta'],
    'old assignment completion must not replace the current account access');
  assert.equal(x.rosterCalls.includes('alpha'), false,
    'a superseded assignment must not initiate an old-account roster read');
  newRoster.release();
  await newLoad;
  assert.equal(x.context.teacherScope.classes.beta.name, 'beta');
});

test('old assignment response after sign-out cannot restore an authorized teacher access object', async () => {
  const oldAssignment = deferred();
  const x = fixture({assignmentGates: {[teacherA.uid]: oldAssignment.promise}});
  const oldLoad = x.run(teacherA, accessA);
  x.context.auth.currentUser = null;
  x.context.scopeGeneration++;
  x.context.teacherAccess = {authorized: false};
  oldAssignment.release();
  await oldLoad;
  assert.equal(x.context.teacherAccess.authorized, false);
  assert.equal(x.rosterCalls.length, 0);
});

test('changed authenticated identity without a completed callback discards an old assignment', async () => {
  const oldAssignment = deferred();
  const x = fixture({assignmentGates: {[teacherA.uid]: oldAssignment.promise}});
  const oldLoad = x.run(teacherA, accessA);
  x.context.auth.currentUser = teacherB;
  x.context.teacherAccess = accessB;
  oldAssignment.release();
  await oldLoad;
  assert.equal(x.context.teacherAccess, accessB);
  assert.equal(x.rosterCalls.length, 0);
});

test('sign-out while the roster read is pending must not render a former teacher class', async () => {
  const rosterGate = deferred(), rosterEntered = deferred();
  const x = fixture({rosterGates: {alpha: rosterGate.promise}});
  const originalRoster = x.context.window.FunTorahTeacherScope.roster;
  x.context.window.FunTorahTeacherScope.roster = async (...args) => {
    rosterEntered.release();
    return originalRoster(...args);
  };
  const pending = x.run(teacherA, accessA);
  await rosterEntered.promise;
  x.context.auth.currentUser = null;
  rosterGate.release();
  await pending;
  assert.equal(x.context.teacherScope, null,
    'old roster result must not paint a class after authentication changes');
  assert.equal(x.approvalCalls.length, 0,
    'old roster must not initiate pending-approval requests');
});

test('unchanged active teacher still loads only their current assigned class', async () => {
  const x = fixture({assignmentRows: {[teacherA.uid]: {
    active: true, classIds: {alpha: true, beta: false, '*': true}
  }}});
  await x.run(teacherA, accessA);
  assert.deepEqual(Array.from(x.context.teacherAccess.classIds), ['alpha']);
  assert.equal(x.context.teacherScope.classes.alpha.name, 'alpha');
  assert.equal(x.approvalCalls.length, 1);
  assert.equal(x.rosterCalls.join(','), 'alpha');
});
