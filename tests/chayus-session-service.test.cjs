'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { act } = require('../backend/functions/chayus-session-service.cjs');

function fakeDb() {
  const state = new Map();
  return {
    state,
    ref(path) {
      return {
        get: async () => ({ val: () => structuredClone(state.get(path) ?? null) }),
        transaction: async update => {
          const current = structuredClone(state.get(path) ?? null);
          const next = update(current);
          if (next !== undefined) {
            if (next === null) state.delete(path); else state.set(path, structuredClone(next));
          }
          return { committed: next !== undefined, snapshot: { val: () => structuredClone(next) } };
        }
      };
    }
  };
}

test('Chayus reports stay class scoped and students can read only their own aggregate', async () => {
  const db = fakeDb();
  let now = 100000;
  const call = (actor, body) => act({ db, actor, body, now, getRoster: async id =>
    id === 'et' ? [{ id: 'boy-a', name: 'Ari Example' }, { id: 'boy-b', name: 'Zev Example' }] : []
  });
  const started = await call({ classId: 'et', role: 'teacher' }, { action: 'start' });
  await assert.rejects(call({ classId: 'et', role: 'student', studentId: 'boy-a' }, {
    action: 'start'
  }), /unavailable for your role/);
  const metrics = { measuredSeconds: 10, activeSeconds: 6, calibrationSeconds: 3,
    feedbackCount: 0, activeIntervals: 0, pauseCount: 1, pausedSeconds: 2 };
  now += 15000;
  await call({ classId: 'et', role: 'student', studentId: 'boy-a' }, {
    action: 'submit', sessionId: started.id, metrics: { ...metrics, audio: [0.5], studentId: 'boy-b' }
  });
  const savedAt = db.state.get('chayusSessions/et').reports['boy-a'].savedAt;
  await call({ classId: 'et', role: 'student', studentId: 'boy-a' }, {
    action: 'submit', sessionId: started.id, metrics
  });
  assert.equal(db.state.get('chayusSessions/et').reports['boy-a'].savedAt, savedAt);
  const own = await call({ classId: 'et', role: 'student', studentId: 'boy-a' }, { action: 'read' });
  assert.deepEqual(own.metrics, metrics);
  const other = await call({ classId: 'et', role: 'student', studentId: 'boy-b' }, { action: 'read' });
  assert.equal(other.metrics, null);
  await assert.rejects(call({ classId: 'wt', role: 'teacher' }, { action: 'report', sessionId: started.id }), /Finish/);
  now += 100000;
  await call({ classId: 'et', role: 'teacher' }, { action: 'finish', sessionId: started.id });
  const report = await call({ classId: 'et', role: 'teacher' }, { action: 'report', sessionId: started.id });
  assert.deepEqual(report.students.map(row => row.studentId), ['boy-a', 'boy-b']);
  assert.deepEqual(report.students[0].metrics, metrics);
  assert.equal(report.students[1].metrics, null);
  assert.equal(report.students[1].missingAtEnd, true);
  assert.equal(db.state.has('chayusSessions/wt'), false);
});

test('Chayus aggregate validation rejects time beyond session and decreasing updates', async () => {
  const db = fakeDb();
  let now = 200000;
  const call = (actor, body) => act({ db, actor, body, now });
  const started = await call({ classId: 'wt', role: 'teacher' }, { action: 'start' });
  now += 15000;
  const body = { action: 'submit', sessionId: started.id,
    metrics: { measuredSeconds: 10, activeSeconds: 5, calibrationSeconds: 3,
      feedbackCount: 0, activeIntervals: 0, pauseCount: 1, pausedSeconds: 1 } };
  await call({ classId: 'wt', role: 'student', studentId: 'boy-a' }, body);
  now += 11000;
  await assert.rejects(call({ classId: 'wt', role: 'student', studentId: 'boy-a' }, {
    ...body, metrics: { ...body.metrics, measuredSeconds: 9 }
  }), /newer summary/);
  await assert.rejects(call({ classId: 'wt', role: 'student', studentId: 'boy-b' }, {
    ...body, metrics: { ...body.metrics, measuredSeconds: 99 }
  }), /Invalid Chayus/);
});

test('ended Chayus reports expire after the approved 30-day retention window', async () => {
  const db = fakeDb();
  const endedAt = 1000;
  db.state.set('chayusSessions/et', { id: 'old', startedAt: 500, endedAt, reports: {} });
  const result = await act({ db, actor: { classId: 'et', role: 'student', studentId: 'boy-a' },
    body: { action: 'read' }, now: endedAt + 30 * 24 * 60 * 60 * 1000 + 1 });
  assert.equal(result, null);
  assert.equal(db.state.has('chayusSessions/et'), false);
});
