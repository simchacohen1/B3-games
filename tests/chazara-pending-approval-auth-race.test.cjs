'use strict';
// Fictional-data VM tests for the actual pending Chazara queue loader.
// No Firebase credentials, network calls, production student data, or rules writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('chazara/teacher.html', 'utf8');
const start = html.indexOf('async function loadApprovals(){');
const end = html.indexOf('\nlet automaticSweepRunning=false;', start);
assert.ok(start >= 0 && end > start, 'extract the actual pending approval loader');
const source = html.slice(start, end);
const a = {uid: 'fictional_teacher_alpha'};
const b = {uid: 'fictional_teacher_beta'};
const request = (recorded = false) => ({
  id: 'alpha-request', source: 'chazara', status: 'pending',
  practiceStudentId: 'fictional_student_alpha', eventId: 'alpha-event',
  recorded, classId: 'alpha'
});
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return {promise, resolve};
}
function fixture({pendingResponse, eventResponse} = {}) {
  const nodes = new Map();
  const calls = [], renders = [];
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, {
      innerHTML: '', classList: {add() {}, remove() {}}
    });
    return nodes.get(key);
  };
  const context = {
    scopeGeneration: 1, approvalGeneration: 0,
    auth: {currentUser: a}, teacherScope: {classes: {alpha: {}}},
    R: {fictional_student_alpha: {classId: 'alpha'}},
    E: {}, pendingPointRequests: {},
    pendingRecordingKeys: new Set(), pendingEventFetches: new Map(),
    $: node, console,
    setApprovalStatus() {},
    renderApprovals() {renders.push('approvals');},
    renderRecordings() {renders.push('recordings');},
    sweepAutomaticPoints() {throw Error('no automatic points in this fixture');},
    withPendingEventSlot: fn => Promise.resolve().then(fn),
    teacherApi: async (action) => {
      calls.push(action);
      if (action === 'list-chazara-pending') return pendingResponse;
      if (action === 'get-chazara-event') return eventResponse;
      throw Error('Unexpected API action: ' + action);
    },
    window: {
      FunTorahApprovalQueue: {
        isPendingAutomatic: () => false,
        needsManualApproval: item => item.status === 'pending',
        isChazaraApproval: item => item.source === 'chazara'
      },
      FunTorahTeacherScope: {
        recordAllowed: () => true,
        validKey: value => /^[A-Za-z0-9_-]+$/.test(String(value))
      }
    }
  };
  vm.runInNewContext(source + '\nthis.loadPending=loadApprovals;', context, {
    filename: 'chazara-pending-approval-auth-race.js'
  });
  return {context, calls, renders, run: () => context.loadPending()};
}

test('old pending response cannot repopulate former class after Google account switch before callback', async () => {
  const gate = deferred();
  const x = fixture({pendingResponse: gate.promise});
  const old = x.run();
  x.context.auth.currentUser = b; // scopeGeneration has not yet changed
  gate.resolve({requests: [request()]});
  await old;
  assert.deepEqual(Object.keys(x.context.pendingPointRequests), []);
  assert.deepEqual(x.renders, [], 'stale pending queue must not render');
});

test('old pending response cannot repopulate former class after sign-out before callback', async () => {
  const gate = deferred();
  const x = fixture({pendingResponse: gate.promise});
  const old = x.run();
  x.context.auth.currentUser = null;
  gate.resolve({requests: [request()]});
  await old;
  assert.deepEqual(Object.keys(x.context.pendingPointRequests), []);
  assert.deepEqual(x.renders, []);
});

test('late audio response cannot populate former student event cache after account switch', async () => {
  const eventGate = deferred(), entered = deferred();
  const x = fixture({
    pendingResponse: {requests: [request(true)]},
    eventResponse: eventGate.promise.then(event => event)
  });
  const originalApi = x.context.teacherApi;
  x.context.teacherApi = async (...args) => {
    if (args[0] === 'get-chazara-event') entered.resolve();
    return originalApi(...args);
  };
  const old = x.run();
  await entered.promise;
  x.context.auth.currentUser = b; // no auth callback yet
  eventGate.resolve({event: {classId: 'alpha', recorded: true}});
  await old;
  assert.equal(x.context.E.fictional_student_alpha, undefined,
    'stale private audio must not enter the new account cache');
});

test('unchanged teacher still receives the pending queue and requested recording', async () => {
  const x = fixture({
    pendingResponse: {requests: [request(true)]},
    eventResponse: {event: {classId: 'alpha', recorded: true}}
  });
  await x.run();
  assert.deepEqual(Object.keys(x.context.pendingPointRequests), ['alpha-request']);
  assert.equal(x.context.E.fictional_student_alpha['alpha-event'].recorded, true);
  assert.deepEqual(x.calls, ['list-chazara-pending', 'get-chazara-event']);
  assert.ok(x.renders.length >= 2);
});
