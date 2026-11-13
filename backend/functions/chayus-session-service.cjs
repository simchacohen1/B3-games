'use strict';

const { randomUUID } = require('node:crypto');
const { validateMetrics } = require('./chayus-report-core.cjs');
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const validKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
  && !Object.hasOwn(Object.prototype, value);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

// Only call with an actor resolved from a verified Firebase identity and
// active class membership. This session has no dependency on Chazzan.
async function act({ db, actor, body, getRoster, now = Date.now() }) {
  const { role, classId, studentId } = actor;
  const teacher = role === 'teacher';
  if (!['et', 'wt'].includes(classId) || (!teacher && (role !== 'student' || !validKey(studentId)))) {
    fail(403, 'Active class access is required.');
  }
  const ref = db.ref(`chayusSessions/${classId}`);
  const { action, sessionId } = body;
  const view = (session, includeOwnMetrics = false) => session ? {
    id: session.id, startedAt: session.startedAt, endedAt: session.endedAt ?? null,
    ...(includeOwnMetrics ? { metrics: session.reports?.[studentId]?.metrics ?? null } : {})
  } : null;
  if (action === 'read') {
    const session = (await ref.get()).val();
    if (session?.endedAt && now - session.endedAt > RETENTION_MS) {
      await ref.transaction(current => current?.id === session.id && current.endedAt === session.endedAt ? null : undefined,
        undefined, false);
      return null;
    }
    return view(session, role === 'student');
  }
  if (!((teacher && ['start', 'finish', 'report'].includes(action)) || (!teacher && action === 'submit'))) {
    fail(403, 'This action is unavailable for your role.');
  }
  if (action === 'report') {
    const session = (await ref.get()).val();
    if (session?.endedAt && now - session.endedAt > RETENTION_MS) fail(410, 'This class report has expired.');
    if (!session?.endedAt || session.id !== sessionId) fail(409, 'Finish this Chayus session first.');
    const roster = await getRoster(classId);
    return { ...view(session), students: roster.map(student => ({
      studentId: student.id, studentName: student.name,
      metrics: session.reports?.[student.id]?.metrics ?? null,
      lastSavedAt: session.reports?.[student.id]?.savedAt ?? null,
      missingAtEnd: Boolean(session.endedAt && session.endedAt - (session.reports?.[student.id]?.savedAt || 0) > 90000)
    })) };
  }
  const id = randomUUID();
  let rejection;
  const result = await ref.transaction(session => {
    rejection = undefined;
    try {
      if (action === 'start') {
        if (session && !session.endedAt) return session;
        return { id, startedAt: now };
      }
      if (session === null) return null;
      if (session.id !== sessionId) fail(409, 'This Chayus session has changed.');
      if (action === 'finish') return session.endedAt ? session : { ...session, endedAt: now };
      const cutoff = session.endedAt ?? now;
      if (session.endedAt && now > session.endedAt + 30000) fail(409, 'This Chayus session is closed.');
      const metrics = validateMetrics(body.metrics, (cutoff - session.startedAt) / 1000);
      const previous = session.reports?.[studentId];
      if (previous) {
        const before = previous.metrics;
        if (JSON.stringify(before) === JSON.stringify(metrics)) return session;
        if (now - previous.savedAt < 10000) fail(429, 'Please wait before sending another update.');
        if (['measuredSeconds', 'activeSeconds', 'calibrationSeconds', 'feedbackCount', 'activeIntervals',
          'pauseCount', 'pausedSeconds']
          .some(key => metrics[key] < before[key])) fail(409, 'A newer summary is already saved.');
      }
      return { ...session, reports: { ...session.reports, [studentId]: { metrics, savedAt: now } } };
    } catch (error) {
      rejection = error;
      return undefined;
    }
  }, undefined, false);
  if (rejection) throw rejection;
  if (!result.committed || !result.snapshot.val()) fail(409, 'This Chayus session is unavailable.');
  return view(result.snapshot.val());
}

module.exports = { act };
