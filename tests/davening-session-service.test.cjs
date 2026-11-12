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
    db, actor: { classId, role, studentId, name: studentId }, body, catalog: ['ashrei']
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
  assert.equal((await call('wt', 'student', { action: 'read' }, 'fictional-three')).parts.ashrei.studentId, null);
  await assert.rejects(call('wt', 'student', spin, 'fictional-three'), /changed/);
  await assert.rejects(call('wt', 'student', {
    action: 'playback', sessionId: wt.id, partId: 'ashrei', speed: 1, position: 0, playing: true
  }, 'fictional-three'), /role/);
});
