'use strict';
// Synthetic-only regression for the Codex Chazara pending/history split.
// No Firebase credentials, production records, or network calls are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const source = fs.readFileSync('backend/functions/student-rewards-auto-award.js', 'utf8');
  const start = source.indexOf('async function repairMissingChazaraPointRequests(');
  const end = source.indexOf('const AUTOMATIC_MILESTONE_REVIEWER', start);
  assert.ok(start >= 0 && end > start, 'expected Chazara backend functions');

  const events = {
    et_event: { workspaceClassId: 'et', recorded: true, reviewApplied: true, perek: 18, posuk: 1 },
    wt_event: { workspaceClassId: 'wt', recorded: true, reviewApplied: true, perek: 18, posuk: 2 }
  };
  const requests = {
    foreign: { status: 'pending', source: 'chazara-recording', practiceStudentId: 'shared',
      eventId: 'wt_event', workspaceClassId: 'wt', recorded: true }
  };
  const reads = [], writes = [];
  const eventRoot = 'posukPractice/chazara/events/shared';
  const requestRoot = 'studentRewards/pointRequests';
  function get(path) {
    if (path === eventRoot) return events;
    if (path.startsWith(eventRoot + '/')) return events[path.slice(eventRoot.length + 1)];
    if (path === requestRoot) return requests;
    if (path.startsWith(requestRoot + '/')) return requests[path.slice(requestRoot.length + 1)];
    return null;
  }
  const snap = value => ({
    val: () => value === undefined ? null : value,
    exists: () => value != null,
    forEach: fn => Object.entries(value || {}).forEach(([key, row]) => fn({key, val: () => row}))
  });
  const rtdb = {ref: path => ({
    get: async () => { reads.push(path); return snap(get(path)); },
    update: async change => {
      writes.push({path, change});
      if (path.startsWith(eventRoot + '/')) Object.assign(events[path.slice(eventRoot.length + 1)], change);
      else throw Error('Unexpected write path: ' + path);
    }
  })};
  const scope = {owner: false, selected: 'et', students: {shared: {}}};
  const ctx = {
    rtdb, SR_ROOT: 'studentRewards', console,
    teacherClassScope: {
      recordAllowed: (s, id, record) =>
        Boolean(s.students?.[id] && record?.workspaceClassId === s.selected)
    },
    safeKey: value => value,
    resolveRewardStudentId: async () => 'synthetic-reward-id',
    verifyChazara: async () => ({ok: true}),
    POINTS: {'chazara-recording': 2, chazara: 1},
    reasonFor: () => 'Synthetic Chazara',
    isReviewableRequest: item => ['chazara', 'chazara-recording'].includes(item?.source),
    sweepPendingMilestones: async rows => rows,
    createPendingRequest: async ({requestId, studentId, source, record}) => {
      assert.equal(record.workspaceClassId, 'et', 'must never repair foreign-class event');
      assert.equal(requests[requestId], undefined, 'must not duplicate an existing request');
      requests[requestId] = {id: requestId, status: 'pending', practiceStudentId: studentId,
        source, eventId: record.eventId, recorded: record.recorded,
        workspaceClassId: record.workspaceClassId};
      writes.push({path: requestRoot + '/' + requestId, change: requests[requestId]});
      return {status: 'pending'};
    }
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end) +
    '\nthis.api = {listPendingChazaraRequests, listChazaraRecordingHistory};', ctx);
  return {ctx, events, requests, reads, writes, scope};
}

test('pending startup avoids history scans but a missing request is recovered only after history opens', async () => {
  const f = fixture();
  const first = await f.ctx.api.listPendingChazaraRequests(f.scope, {repair: false});
  assert.equal(first.length, 0, 'currently the orphan is absent from pending approvals');
  assert.deepEqual(f.reads, ['studentRewards/pointRequests'],
    'pending-only startup must not download historical recordings');
  assert.equal(f.writes.length, 0, 'pending-only startup must not modify events');

  const history = await f.ctx.api.listChazaraRecordingHistory(f.scope);
  assert.deepEqual(Array.from(history, item => item.id), ['et_event'],
    'history must not reveal the shared student\'s WT recording');
  assert.ok(f.reads.includes('posukPractice/chazara/events/shared'),
    'opening history performs the deferred repair scan');
  assert.equal(f.requests.chazara_shared_et_event?.status, 'pending',
    'opening history recovers the missing ET approval request');
  assert.equal(f.requests.chazara_shared_wt_event, undefined,
    'WT event must never be repaired from ET');
  assert.equal(f.events.wt_event.pointRequestId, undefined,
    'WT event must remain unchanged');

  const after = await f.ctx.api.listPendingChazaraRequests(f.scope, {repair: false});
  assert.deepEqual(Array.from(after, item => item.id), ['chazara_shared_et_event']);
  assert.equal(f.writes.filter(w => w.path.includes('wt_event')).length, 0);
});
