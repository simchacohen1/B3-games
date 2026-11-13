const test = require('node:test');
const assert = require('node:assert/strict');
const { act } = require('../backend/functions/davening-session-service.cjs');

test('transaction service isolates classes and reserves the final part once', async () => {
  const state = new Map();
  let queue = Promise.resolve();
  const db = { ref: path => ({
    get: async () => ({ val: () => structuredClone(state.get(path) ?? null) }),
    transaction(update) {
      const result = queue.then(() => {
        const next = update(structuredClone(state.get(path) ?? null));
        if (next !== undefined) state.set(path, next);
        return { committed: next !== undefined, snapshot: { val: () => next } };
      });
      queue = result.catch(() => {});
      return result;
    }
  }) };
  const call = (classId, role, body, studentId) => act({
    db, actor: { classId, role, studentId, name: studentId }, body, catalog: ['ashrei'],
    getRoster: async id => id === 'et' ? [{ id: 'fictional-one', name: 'Ari Example' }] : []
  });
  const et = await call('et', 'teacher', { action: 'open', requestId: 'new-et' });
  const wt = await call('wt', 'teacher', { action: 'open', requestId: 'new-wt' });
  const spin = { action: 'spin', sessionId: et.id, requestId: 'first' };
  const results = await Promise.allSettled([
    call('et', 'student', spin, 'fictional-one'),
    call('et', 'student', spin, 'fictional-two')
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  const studentView = await call('wt', 'student', { action: 'read' }, 'fictional-three');
  assert.equal(studentView.parts.ashrei.studentId, null);
  assert.equal(studentView.parts.ashrei.mine, false);
  await assert.rejects(call('wt', 'student', spin, 'fictional-three'), /changed/);
  await assert.rejects(call('wt', 'student', {
    action: 'playback', sessionId: wt.id, partId: 'ashrei', speed: 1, position: 0, playing: true
  }, 'fictional-three'), /role/);
});

test('teacher assignment reads a server roster and student views hide other student IDs', async () => {
  const state = new Map();
  const db = { ref: path => ({
    get: async () => ({ val: () => structuredClone(state.get(path) ?? null) }),
    transaction: async update => {
      const next = update(structuredClone(state.get(path) ?? null));
      if (next !== undefined) state.set(path, next);
      return { committed: next !== undefined, snapshot: { val: () => next } };
    }
  }) };
  const roster = [{ id: 'fictional-a', name: 'Ari Example' }];
  const call = (actor, body) => act({ db, actor, body, catalog: ['ashrei'], getRoster: async () => roster });
  const opened = await call({ classId: 'et', role: 'teacher' }, { action: 'open', requestId: 'open' });
  const assigned = await call({ classId: 'et', role: 'teacher' }, {
    action: 'assign', sessionId: opened.id, partId: 'ashrei', studentId: 'fictional-a'
  });
  assert.equal(assigned.parts.ashrei.studentId, 'fictional-a');
  await assert.rejects(call({ classId: 'et', role: 'teacher' }, {
    action: 'assign', sessionId: opened.id, partId: 'ashrei', studentId: 'other-class-id'
  }), /student in this class/);
  const student = await call({ classId: 'et', role: 'student', studentId: 'fictional-b' }, { action: 'read' });
  assert.equal(student.parts.ashrei.studentId, null);
  assert.equal(student.parts.ashrei.name, 'Ari Example');
  assert.equal(student.parts.ashrei.mine, false);
});

test('teacher Chazzan point awards require a started assignment and invoke Rewards once', async () => {
  const state = new Map();
  const db = { ref: path => ({
    get: async () => ({ val: () => structuredClone(state.get(path) ?? null) }),
    transaction: async update => {
      const next = update(structuredClone(state.get(path) ?? null));
      if (next !== undefined) state.set(path, next);
      return { committed: next !== undefined, snapshot: { val: () => structuredClone(next) } };
    }
  }) };
  const awards = [];
  const awardPoint = async value => awards.push(value);
  const call = (role, body) => act({ db, actor: { classId: 'et', role }, body,
    catalog: ['ashrei'], getRoster: async () => [{ id: 'boy-a', name: 'Ari Example' }], awardPoint });
  const opened = await call('teacher', { action: 'open', requestId: 'open' });
  await call('teacher', { action: 'assign', sessionId: opened.id, partId: 'ashrei', studentId: 'boy-a' });
  await assert.rejects(call('teacher', { action: 'award', sessionId: opened.id, partId: 'ashrei', requestId: 'award-a' }), /not started/);
  await call('teacher', { action: 'playback', sessionId: opened.id, partId: 'ashrei', speed: 1, position: 0, playing: false });
  const awardBody = { action: 'award', sessionId: opened.id, partId: 'ashrei', requestId: 'award-a' };
  const result = await call('teacher', awardBody);
  assert.equal(result.parts.ashrei.awarded, true);
  await call('teacher', { ...awardBody, requestId: 'award-b' });
  assert.deepEqual(awards, [{ classId: 'et', studentId: 'boy-a', assignmentKey: `${opened.id}_ashrei` }]);
  await assert.rejects(call('student', awardBody), /role/);
});

test('ended Chazzan sessions are removed after 30 days when read', async () => {
  const state = new Map();
  const db = { ref: path => ({
    get: async () => ({ val: () => structuredClone(state.get(path) ?? null) }),
    transaction: async update => {
      const next = update(structuredClone(state.get(path) ?? null));
      if (next !== undefined) {
        if (next === null) state.delete(path); else state.set(path, structuredClone(next));
      }
      return { committed: next !== undefined, snapshot: { val: () => structuredClone(next) } };
    }
  }) };
  state.set('daveningSessions/et', { id: 'old', phase: 'ended', endedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
    parts: { ashrei: { changes: 0 } } });
  const value = await act({ db, actor: { classId: 'et', role: 'student', studentId: 'boy-a' },
    body: { action: 'read' }, catalog: ['ashrei'] });
  assert.equal(value, null);
  assert.equal(state.has('daveningSessions/et'), false);
});
