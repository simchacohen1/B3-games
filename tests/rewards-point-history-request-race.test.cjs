'use strict';
// Fictional interleaving test against the actual request-creation function.
// A new per-student history index must not overwrite a request that a teacher
// approved or rejected after its creation transaction committed.
// No Firebase connection, production data, or points are touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('backend/functions/student-rewards-auto-award.js', 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Expected production source section: ' + start);
  return source.slice(a, b);
}
const helper = section('function studentPointHistoryIndexUpdates(', 'function updatesToIndex(');
const creator = section('async function createPendingRequest(', 'function dateKeyInNewYork(');
const requestPath = 'studentRewards/pointRequests/fictional_race';
const indexPath = 'studentRewards/pointHistoryIndex/fictional_a/requests/fictional_race';

function fixture(interleave) {
  let request = null;
  let indexed = false;
  const writes = [];
  const snap = value => ({
    exists: () => value != null,
    val: () => value == null ? null : structuredClone(value)
  });
  const requestRef = {
    get: async () => snap(request),
    transaction: async callback => {
      const next = callback(request);
      assert.ok(next, 'Creation transaction must commit a new request');
      request = structuredClone(next);
      return {committed: true, snapshot: snap(request)};
    }
  };
  const rootRef = {
    update: async updates => {
      writes.push(structuredClone(updates));
      // Deterministic stand-in for a teacher approval/rejection committing
      // after the creation transaction but before the separate index update.
      if (interleave) request = {...request, status: interleave, reviewedBy: 'fictional_teacher'};
      if (Object.hasOwn(updates, requestPath)) request = structuredClone(updates[requestPath]);
      if (updates[indexPath] === true) indexed = true;
    }
  };
  const rtdb = {ref: path => path == null ? rootRef : path === requestPath ? requestRef : (() => {throw Error('Unexpected path: ' + path)})()};
  const studentInfo = async () => ({name: 'Fictional A', classId: 'alpha'});
  const createPendingRequest = new Function('rtdb', 'studentInfo',
    '"use strict"; const SR_ROOT="studentRewards";\n' + helper + '\n' + creator +
    '\nreturn createPendingRequest;')(rtdb, studentInfo);
  return {
    create: () => createPendingRequest({
      requestId: 'fictional_race', rewardStudentId: 'fictional_a',
      studentId: 'fictional_practice_a', source: 'chazara-recording',
      amount: 2, reason: 'Synthetic Chazara', record: {}
    }),
    state: () => ({request, indexed, writes})
  };
}

test('new pending request creates its private history index (positive control)', async () => {
  const x = fixture(null);
  const result = await x.create();
  assert.equal(result.created, true);
  assert.equal(x.state().request.status, 'pending');
  assert.equal(x.state().indexed, true);
});

for (const status of ['approved', 'rejected']) {
  test('history indexing never reverts a concurrently ' + status + ' request', async () => {
    const x = fixture(status);
    await x.create();
    assert.equal(x.state().indexed, true, 'index entry must still be created');
    assert.equal(x.state().request.status, status,
      'index maintenance must not rewrite a newer teacher decision with stale pending data');
  });
}
