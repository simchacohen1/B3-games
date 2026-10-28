'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('chazara/teacher.html', 'utf8');
const handlerLine = html.split(/\r?\n/).find(line => line.includes("$('showPendingOnly').onclick="));
assert.ok(handlerLine, 'pending-only toggle handler must exist');

function fixture(signedIn = true) {
  const calls = [];
  const elements = {};
  const $ = id => elements[id] ||= {
    value: '',
    classList: { add: name => calls.push([id, 'add', name]), remove: name => calls.push([id, 'remove', name]) }
  };
  const user = signedIn ? { uid: 'fictional-teacher' } : null;
  const access = signedIn ? { authorized: true, classIds: ['fictional-class'] } : null;
  const context = {
    $, auth: { currentUser: user }, teacherAccess: access,
    loadClassScope: (u, a) => calls.push(['reload-scope', u.uid, a.classIds.join(',')]),
    renderRecordings: () => calls.push(['render'])
  };
  vm.createContext(context);
  vm.runInContext('let fullDashboardLoaded=true;\n' + handlerLine, context);
  return { $, calls, context };
}

test('returning to pending-only mode turns off full dashboard and reloads scope', () => {
  const f = fixture();
  f.$('showPendingOnly').onclick();
  assert.equal(vm.runInContext('fullDashboardLoaded', f.context), false);
  assert.ok(f.calls.some(c => c[0] === 'reload-scope' && c[1] === 'fictional-teacher'));
  assert.equal(f.calls.some(c => c[0] === 'render'), false,
    'the scoped reload, not a stale full-history render, must refresh pending');
  assert.ok(f.calls.some(c => c[0] === 'teacherApp' && c[1] === 'add' && c[2] === 'review-only'));
});

test('pending-only mode without an authenticated teacher does not request a scoped reload', () => {
  const f = fixture(false);
  f.$('showPendingOnly').onclick();
  assert.equal(vm.runInContext('fullDashboardLoaded', f.context), false);
  assert.equal(f.calls.some(c => c[0] === 'reload-scope'), false);
  assert.equal(f.calls.filter(c => c[0] === 'render').length, 1);
});

test('scope reload unsubscribes full-history listeners before conditional subscription', () => {
  const start = html.indexOf('async function loadClassScope(');
  const end = html.indexOf('window.B3SiteSettings.onAuthStateChanged(', start);
  assert.ok(start >= 0 && end > start, 'scoped reload function must exist');
  const body = html.slice(start, end);
  assert.ok(body.indexOf('clearStudentListeners()') >= 0);
  assert.ok(body.indexOf('clearStudentListeners()') < body.indexOf('if(fullDashboardLoaded?'),
    'existing listeners must be removed before any full-history subscriptions');
  assert.ok(body.includes("fullDashboardLoaded?[['posukPractice/chazara/students'"),
    'history listeners must remain conditional on full-dashboard mode');
});
