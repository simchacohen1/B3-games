'use strict';
// Synthetic authorization regression for Codex's pending-only Chazara API.
// Tests the actual server-side authorization function, not a copied decision tree.
// No Firebase credentials, production data, or network requests are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const source = fs.readFileSync('backend/functions/student-rewards-auto-award.js', 'utf8');
  const start = source.indexOf('async function authorizeChazaraAction(');
  const end = source.indexOf('// ---------- Rashi Letters', start);
  assert.ok(start >= 0 && end > start, 'expected Chazara authorization function');
  const events = {
    et_event: {workspaceClassId: 'et', recorded: true, reviewApplied: true, audioDataURL: 'data:audio/webm;base64,ET'},
    wt_event: {workspaceClassId: 'wt', recorded: true, reviewApplied: true, audioDataURL: 'data:audio/webm;base64,WT'},
    legacy_event: {recorded: true, reviewApplied: true, audioDataURL: 'data:audio/webm;base64,LEGACY'}
  };
  const requests = {
    et_request: {source: 'chazara-recording', practiceStudentId: 'shared', workspaceClassId: 'et', status: 'pending'},
    wt_request: {source: 'chazara-recording', practiceStudentId: 'shared', workspaceClassId: 'wt', status: 'pending'}
  };
  const reads = [], writes = [];
  const scope = {selected: 'et', students: {shared: {membershipClassIds: ['et', 'wt']}}};
  const ctx = {
    SR_ROOT: 'studentRewards',
    teacherClassScope: {
      validKey: value => /^[A-Za-z0-9_-]{1,220}$/.test(String(value || '')),
      recordAllowed: (current, studentId, record) =>
        Boolean(current.students?.[studentId] && record?.workspaceClassId === current.selected)
    },
    isReviewableRequest: item => ['chazara', 'chazara-recording'].includes(item?.source),
    rtdb: {ref: path => ({
      get: async () => {
        reads.push(path);
        const eventPrefix = 'posukPractice/chazara/events/shared/';
        const requestPrefix = 'studentRewards/pointRequests/';
        const value = path.startsWith(eventPrefix) ? events[path.slice(eventPrefix.length)] :
          path.startsWith(requestPrefix) ? requests[path.slice(requestPrefix.length)] : undefined;
        return {val: () => value ?? null};
      },
      set: async value => writes.push([path, value]),
      update: async value => writes.push([path, value])
    })}
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end) + '\nthis.authorize = authorizeChazaraAction;', ctx);
  return {authorize: ctx.authorize, scope, reads, writes};
}

test('on-demand Chazara audio denies foreign class, ambiguous legacy and revoked membership', async () => {
  const f = fixture(), teacher = {owner: false, scope: f.scope};
  await f.authorize(teacher, {action: 'get-chazara-recording-audio', studentId: 'shared', eventId: 'et_event'});
  await assert.rejects(f.authorize(teacher, {action: 'get-chazara-recording-audio', studentId: 'shared', eventId: 'wt_event'}),
    error => error.code === 403, 'other-class recording must be denied');
  await assert.rejects(f.authorize(teacher, {action: 'get-chazara-recording-audio', studentId: 'shared', eventId: 'legacy_event'}),
    error => error.code === 403, 'ambiguous classless legacy recording must not be guessed into ET');
  await assert.rejects(f.authorize(teacher, {action: 'get-chazara-recording-audio', studentId: 'shared', eventId: 'bad/event'}),
    error => error.code === 403, 'invalid event key must be rejected');
  const beforeRevocation = f.reads.length;
  delete f.scope.students.shared;
  await assert.rejects(f.authorize(teacher, {action: 'get-chazara-recording-audio', studentId: 'shared', eventId: 'et_event'}),
    error => error.code === 403, 'revoked student membership must deny even formerly permitted audio');
  assert.equal(f.reads.length, beforeRevocation, 'revoked access must deny before reading recording data');
  assert.equal(f.writes.length, 0, 'authorization checks must never mutate recordings');
});

test('Chazara point approval and rejection use the same current class boundary', async () => {
  const f = fixture(), teacher = {owner: false, scope: f.scope};
  for (const action of ['approve-point-request', 'reject-point-request']) {
    await f.authorize(teacher, {action, requestId: 'et_request'});
    await assert.rejects(f.authorize(teacher, {action, requestId: 'wt_request'}),
      error => error.code === 403, action + ' must not cross class boundary');
  }
  const beforeRevocation = f.reads.length;
  delete f.scope.students.shared;
  for (const action of ['approve-point-request', 'reject-point-request']) {
    await assert.rejects(f.authorize(teacher, {action, requestId: 'et_request'}),
      error => error.code === 403, action + ' must fail after class revocation');
  }
  assert.ok(f.reads.length > beforeRevocation, 'requests are rechecked at action time');
  assert.equal(f.writes.length, 0, 'authorization checks must never award or reject points themselves');
});

test('unscoped non-owner cannot request Chazara audio', async () => {
  const f = fixture();
  await assert.rejects(f.authorize({owner: false, scope: null},
    {action: 'get-chazara-recording-audio', studentId: 'shared', eventId: 'et_event'}),
  error => error.code === 403);
  assert.equal(f.reads.length, 0);
  assert.equal(f.writes.length, 0);
});

test('authorized Chazara fallback audio uses a single scoped event read', async () => {
  const f = fixture(), teacher = {owner: false, scope: f.scope};
  const event = await f.authorize(teacher, {action: 'get-chazara-recording-audio', studentId: 'shared', eventId: 'et_event'});
  assert.equal(event.audioDataURL, 'data:audio/webm;base64,ET', 'authorization returns the same checked event');
  assert.deepEqual(f.reads, ['posukPractice/chazara/events/shared/et_event'], 'one event read for class-scoped authorization');
  assert.equal(f.writes.length, 0);
  const source = fs.readFileSync('backend/functions/student-rewards-auto-award.js', 'utf8');
  assert.match(source, /const authorizedChazaraEvent=await authorizeChazaraAction\(teacher,body\)/,
    'request handler must retain the authorized event');
  assert.match(source, /const event=teacher\.scope\?authorizedChazaraEvent:/,
    'scoped audio handler must reuse that event instead of downloading it again');
});
