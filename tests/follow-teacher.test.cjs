'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../follow-teacher/core.js');

const NOW = 1_800_000_000_000;
const BASE = {
  workspaceId: 'b3-2026', classId: 'et', teacherUid: 'teacher123',
  revision: 'lesson1', mode: 'locked', destination: 'shorashim',
  targets: 'all', issuedAt: NOW - 5000, heartbeatAt: NOW - 1000,
  expiresAt: NOW + 60_000
};
const CTX = {
  studentAuthorized: true, workspaceId: 'b3-2026', classId: 'et',
  studentId: 'boy1', allowedTools: {shorashim: true},
  currentUrl: 'https://funtorahtools.com/chazara/index.html',
  now: NOW
};
const check = (s = BASE, c = CTX) => C.decide(s, c);
const withState = (overrides) => ({...BASE, ...overrides});
const withContext = (overrides) => ({...CTX, ...overrides});

test('independent is never a redirect or lock', () => {
  assert.equal(check(withState({mode: 'independent'})).action, 'none');
  assert.equal(check(null).action, 'none');
});

test('free redirects once and remembers the revision', () => {
  const first = check(withState({mode: 'free'}));
  assert.equal(first.action, 'navigate');
  assert.equal(first.destination, '/shorashim/');
  const again = check(withState({mode: 'free'}), withContext({lastAppliedKey: first.applyKey}));
  assert.equal(again.action, 'none');
  assert.equal(again.reason, 'already-sent');
  const nextLesson = check(withState({mode: 'free', revision: 'lesson2'}),
    withContext({lastAppliedKey: first.applyKey}));
  assert.equal(nextLesson.action, 'navigate');
});

test('free at destination marks as applied without reload', () => {
  const result = check(withState({mode: 'free'}), withContext({
    currentUrl: 'https://funtorahtools.com/shorashim/index.html?class=et'
  }));
  assert.equal(result.action, 'stay');
  assert.ok(result.applyKey);
});

test('locked redirects on a direct URL and stays on permitted destination', () => {
  assert.equal(check().action, 'navigate');
  assert.equal(check(BASE, withContext({currentUrl: 'https://funtorahtools.com/shorashim/'})).action, 'stay');
  assert.equal(check(BASE, withContext({currentUrl: 'https://funtorahtools.com/shorashim/index.html?level=2'})).action, 'stay');
});

test('students in another class or workspace are never affected', () => {
  assert.equal(check(BASE, withContext({classId: 'wt'})).reason, 'wrong-class');
  assert.equal(check(BASE, withContext({workspaceId: 'other'})).reason, 'wrong-class');
});

test('selected students only; unlisted classmates can navigate', () => {
  const selected = withState({targets: ['boy2', 'boy3']});
  assert.equal(check(selected).reason, 'not-selected');
  assert.equal(check(selected, withContext({studentId: 'boy2'})).action, 'navigate');
});

test('unverified students and missing or denied tool access cannot be sent', () => {
  assert.equal(check(BASE, withContext({studentAuthorized: false})).reason, 'student-not-verified');
  assert.equal(check(BASE, withContext({studentId: ''})).reason, 'student-not-verified');
  assert.equal(check(BASE, withContext({allowedTools: {shorashim: false}})).reason, 'not-permitted');
  assert.equal(check(BASE, withContext({allowedTools: {}})).reason, 'not-permitted');
});

test('unknown paths and unsupported destinations never redirect', () => {
  assert.equal(check(withState({destination: 'https://evil.example/phish'})).reason, 'not-permitted');
  assert.equal(check(withState({destination: '../admin'})).reason, 'not-permitted');
  assert.throws(() => C.propose({...BASE, destination: '../admin'}), /Destination/);
});

test('lease expiry, missing heartbeat and future state safely unlock', () => {
  assert.equal(check(withState({expiresAt: NOW - 1})).reason, 'expired');
  assert.equal(check(withState({heartbeatAt: NOW - 90_001})).reason, 'expired');
  assert.equal(check(withState({heartbeatAt: undefined})).reason, 'expired');
  assert.equal(check(withState({issuedAt: NOW + 10_000, heartbeatAt: NOW + 10_000})).reason, 'expired');
  assert.equal(check(withState({expiresAt: NOW + C.MAX_LEASE_MS + 1})).reason, 'expired');
});

test('independent unlocks immediately regardless of past locked revision', () => {
  const lock = check(BASE);
  assert.equal(lock.action, 'navigate');
  assert.equal(check(withState({mode: 'independent', revision: 'unlock2'}),
    withContext({lastAppliedKey: lock.applyKey})).action, 'none');
});

test('proposals validate IDs, target lists, lease and mode', () => {
  assert.equal(C.propose(BASE).version, 1);
  assert.throws(() => C.propose({...BASE, teacherUid: '__proto__'}), /identifier/);
  assert.throws(() => C.propose({...BASE, classId: 'et/../wt'}), /identifier/);
  assert.throws(() => C.propose({...BASE, mode: 'remote-control'}), /mode/);
  assert.throws(() => C.propose({...BASE, targets: ['boy1', 'boy1']}), /selection/);
  assert.throws(() => C.propose({...BASE, targets: []}), /selection/);
  assert.throws(() => C.propose({...BASE, expiresAt: NOW + C.MAX_LEASE_MS}), /lease/);
  assert.equal(C.propose({...BASE, mode: 'independent'}).destination, null);
});

test('canonical paths ignore query and normalize index but not other tools', () => {
  assert.equal(C.canonicalPath('https://funtorahtools.com/shorashim/index.html?a=2'), '/shorashim/');
  assert.equal(C.canonicalPath('/shorashim/'), '/shorashim/');
  assert.notEqual(C.canonicalPath('/shorashim/teacher.html'), '/shorashim/');
});

for (const [tool, destination] of Object.entries(C.DESTINATIONS)) {
  for (const classId of ['et','wt']) test(`${classId}: ${tool} supports once, locked, unlock and rejects other tools/classes`,()=>{
    const state={...BASE,classId,destination:tool};
    const context={...CTX,classId,allowedTools:{[tool]:true},currentUrl:'https://funtorahtools.com/'};
    const first=C.decide({...state,mode:'free'},context);
    assert.equal(first.destination,destination.path);
    assert.equal(C.decide({...state,mode:'free'},{...context,lastAppliedKey:first.applyKey}).action,'none');
    assert.equal(C.decide(state,context).action,'navigate');
    assert.equal(C.decide(state,{...context,currentUrl:destination.path}).action,'stay');
    assert.equal(C.decide({...state,mode:'independent'},context).action,'none');
    assert.equal(C.decide(state,{...context,allowedTools:{[tool]:false}}).reason,'not-permitted');
    assert.equal(C.decide(state,{...context,classId:classId==='et'?'wt':'et'}).reason,'wrong-class');
  });
}
test('inherited object keys are never destinations',()=>{
  for(const destination of ['constructor','__proto__','toString']) {
    assert.equal(C.decide({...BASE,destination},{...CTX,allowedTools:{[destination]:true}}).reason,'not-permitted');
    assert.throws(()=>C.propose({...BASE,destination}));
  }
});
