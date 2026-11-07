const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const C = require('../follow-teacher/core.js');

test('Follow once is not renewed by the teacher page; only Locked keeps a heartbeat', () => {
  const s = read('follow-teacher/teacher.js');
  assert.match(s, /ownRevision = m === C\.MODES\.LOCKED \? revision : null/);
  assert.doesNotMatch(s, /ownRevision = m === C\.MODES\.INDEPENDENT \? null : revision/);
});

test('a Follow-once send expires on its own without any renewal', () => {
  const now = 1_000_000;
  const state = C.propose({workspaceId:'b3-2026', classId:'et', teacherUid:'t1', mode:'free',
    destination:'shorashim', revision:'r1', issuedAt:now, heartbeatAt:now, expiresAt:now + C.MAX_HEARTBEAT_AGE_MS});
  assert.equal(C.fresh(state, now + 1000), true);
  assert.equal(C.fresh(state, now + C.MAX_HEARTBEAT_AGE_MS + 1), false);
});

test('applied revision is remembered in localStorage so a second tab is not steered again', () => {
  const src = read('follow-teacher/student.js');
  assert.match(src, /localStorage\.setItem\(appliedKey, key\)/);
  assert.match(src, /sessionStorage\.getItem\(appliedKey\) \|\| localStorage\.getItem\(appliedKey\)/);
  assert.doesNotMatch(src, /sessionStorage\.setItem\(appliedKey, decision\.applyKey\)/);
  const state = {version:1, workspaceId:'b3-2026', classId:'et', teacherUid:'t1', mode:'free',
    destination:'shorashim', revision:'r1', targets:'all', issuedAt:1000, heartbeatAt:1000, expiresAt:50000};
  const ctx = {studentAuthorized:true, workspaceId:'b3-2026', classId:'et', studentId:'s1',
    allowedTools:{shorashim:true}, currentUrl:'https://x/chazara/', now:2000};
  const first = C.decide(state, ctx);
  assert.equal(first.action, 'navigate');
  assert.equal(C.decide(state, {...ctx, lastAppliedKey:first.applyKey}).action, 'none');
});

test('status indicator reads the live student record and offers Release / Take control', () => {
  const s = read('teacher-global-controls.js');
  assert.doesNotThrow(() => new vm.Script(s));
  assert.match(s, /access\/followTeacher/);
  assert.match(s, /id = 'fttFollowStatus'/);
  assert.match(s, /Controlled → /);
  assert.match(s, /Followed once → /);
  assert.match(s, /'🟢 Free'/);
  assert.match(s, /Release control/);
  assert.match(s, /Take control/);
  assert.match(s, /statusRef\.on\('value'/);
  // Shown for every verified teacher page, hidden again on sign-out.
  assert.match(s, /startStatus\(\);/);
  assert.match(s, /function reset\(\) \{\s*stopStatus\(\);/);
  // Never hidden because the quick bar is replaced by the owner home bar.
  assert.match(s, /#fttFollowStatus\{position:fixed/);
});

test('release writes an independent state through the same validated builder', () => {
  const s = read('teacher-global-controls.js');
  assert.match(s, /writeState\('independent'\)/);
  assert.match(s, /C\.propose\(\{workspaceId:workspace/);
  assert.match(s, /takeControl[\s\S]*writeState\('locked', last\)/);
});
