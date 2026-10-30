'use strict';
// Fictional-data regression of the real Chazara background assignment reader.
// No Firebase credentials, network, or live student data are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('chazara/teacher.html', 'utf8');
const start = html.indexOf('async function quietScopeCheck(){');
const end = html.indexOf('\nsetInterval(quietScopeCheck,60000);', start);
assert.ok(start >= 0 && end > start, 'extract the real background scope checker');
const source = html.slice(start, end);

function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
function scope(classId) {
  return {
    classes: { alpha: { name: 'Alef' }, beta: { name: 'Beis' } },
    students: { fictionalStudent: { classId, membershipClassIds: [classId] } }
  };
}
function fixture({ assignmentGate, assignmentRow, assignmentError = false, nextScope = scope('beta') } = {}) {
  const reloads = [], rosterCalls = [], assignmentPaths = [];
  const originalUser = { uid: 'fictional_teacher_a' };
  const originalAccess = { authorized: true, role: 'teacher', classIds: ['alpha'] };
  const context = {
    teacherAccess: originalAccess, teacherScope: scope('alpha'), scopeGeneration: 1,
    document: { hidden: false }, auth: { currentUser: originalUser },
    location: { search: '' }, URLSearchParams, console,
    needsTeacherAssignmentRefresh: () => true,
    db: { ref: path => ({ once: async () => {
      assignmentPaths.push(path);
      if (assignmentGate) await assignmentGate;
      if (assignmentError) throw Error('Fictional assignment permission denied');
      return { val: () => assignmentRow };
    } }) },
    window: { FunTorahTeacherScope: { roster: async (_read, access) => {
      rosterCalls.push(access);
      return nextScope;
    } } },
    loadClassScope: (user, access) => { reloads.push({ user, access }); }
  };
  vm.runInNewContext(source + '\nthis.runQuietCheck=quietScopeCheck;', context, {
    filename: 'chazara-quiet-scope-check.js'
  });
  return { context, reloads, rosterCalls, assignmentPaths, run: () => context.runQuietCheck() };
}

test('late assignment response cannot reload after teacher account switch', async () => {
  const gate = deferred();
  const x = fixture({ assignmentGate: gate.promise, assignmentRow: { active: true, classIds: { beta: true } } });
  const pending = x.run();
  x.context.auth.currentUser = { uid: 'fictional_teacher_b' };
  x.context.teacherAccess = { authorized: true, role: 'teacher', classIds: ['beta'] };
  gate.release();
  await pending;
  assert.equal(x.assignmentPaths.length, 1);
  assert.match(x.assignmentPaths[0], /\/teachers\/fictional_teacher_a$/);
  assert.equal(x.rosterCalls.length, 0, 'never query roster with a former account access object');
  assert.equal(x.reloads.length, 0, 'never revive the former teacher scope');
});

test('late assignment permission failure cannot reload after sign-out', async () => {
  const gate = deferred();
  const x = fixture({ assignmentGate: gate.promise, assignmentError: true });
  const pending = x.run();
  x.context.auth.currentUser = null;
  x.context.teacherAccess = { authorized: false };
  gate.release();
  await pending;
  assert.equal(x.rosterCalls.length, 0);
  assert.equal(x.reloads.length, 0);
});

test('current-session disabled teacher assignment triggers fail-closed scope reload', async () => {
  const x = fixture({ assignmentRow: { active: false, classIds: { alpha: true } } });
  await x.run();
  assert.equal(x.rosterCalls.length, 0, 'revoked account must not request a student roster');
  assert.equal(x.reloads.length, 1);
  assert.equal(x.reloads[0].user.uid, 'fictional_teacher_a');
  assert.equal(x.reloads[0].access, x.context.teacherAccess);
});

test('current-session assignment narrowing is passed to roster before reloading', async () => {
  const x = fixture({ assignmentRow: { active: true, classIds: { beta: true, alpha: false, '*': true } } });
  await x.run();
  assert.equal(x.rosterCalls.length, 1);
  assert.deepEqual(Array.from(x.rosterCalls[0].classIds), ['beta'], 'revoked and wildcard classes must be excluded');
  assert.equal(x.reloads.length, 1);
  assert.deepEqual(Array.from(x.reloads[0].access.classIds), ['beta']);
  assert.equal(x.reloads[0].user.uid, 'fictional_teacher_a');
});
