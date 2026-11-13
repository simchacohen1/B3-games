'use strict';

const { randomUUID } = require('node:crypto');
const { newSession, spin, spinEntropy, setPlayback, setChazzanSpeed, setRegistration, assignPart } =
  require('./davening-session-core.cjs');

const validKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
  && !Object.hasOwn(Object.prototype, value);

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function publicSession(session, actor) {
  if (!session) return null;
  return {
    id: session.id,
    phase: session.phase,
    playback: session.playback ?? null,
    parts: Object.fromEntries(Object.entries(session.parts).map(([id, part]) => [
      id, {
        studentId: actor?.role === 'teacher' ? (part.studentId ?? null) : null,
        mine: actor?.role === 'student' && part.studentId === actor.studentId,
        name: part.name ?? null,
        changes: part.changes,
        started: Boolean(part.started),
        completed: Boolean(part.completed),
        awarded: Boolean(part.awarded)
      }
    ]))
  };
}

// The endpoint supplies an authenticated, class-scoped actor and a server
// catalog. No actor identity or catalog is accepted from the request body.
async function act({ db, actor, catalog, body, getRoster, awardPoint }) {
  if (!validKey(actor.classId)) fail(403, 'Choose an assigned class.');
  const ref = db.ref(`daveningSessions/${actor.classId}`);
  const { action, sessionId, requestId, partId, speed, position, playing } = body;
  if (action === 'read') {
    const current = (await ref.get()).val();
    if (current?.endedAt && Date.now() - current.endedAt > 30 * 24 * 60 * 60 * 1000) {
      await ref.transaction(session => session?.id === current.id && session.endedAt === current.endedAt ? null : undefined,
        undefined, false);
      return null;
    }
    return publicSession(current, actor);
  }
  if (action === 'roster' && actor.role === 'teacher') return getRoster(actor.classId);

  const teacher = actor.role === 'teacher';
  const student = actor.role === 'student' && validKey(actor.studentId);
  if (!(teacher && ['open', 'registration', 'assign', 'playback', 'finish', 'award'].includes(action))
    && !(student && ['spin', 'speed'].includes(action))) {
    fail(403, 'This action is unavailable for your role.');
  }
  if (action === 'open' && (!catalog.length || !catalog.every(validKey))) {
    fail(400, 'This class has no davening recordings.');
  }
  if (action !== 'open' && !validKey(sessionId)) fail(400, 'Missing session ID.');
  if (['spin', 'speed', 'open'].includes(action) && !validKey(requestId)) {
    fail(400, 'Missing request ID.');
  }
  if (['playback', 'speed', 'assign', 'award'].includes(action) && !validKey(partId)) fail(400, 'Invalid part.');
  if (action === 'playback' && (!Number.isFinite(position) || position < 0
    || !Number.isFinite(speed) || speed < 0.25 || speed > 4 || typeof playing !== 'boolean')) {
    fail(400, 'Invalid playback state.');
  }
  const roster = action === 'assign' ? await getRoster(actor.classId) : [];

  if (action === 'award') {
    if (!validKey(requestId)) fail(400, 'Missing request ID.');
    if (typeof awardPoint !== 'function') fail(403, 'Student Rewards is not available for this class.');
    let claimError;
    const claim = await ref.transaction(session => {
      claimError = undefined;
      try {
        if (!session || session.id !== sessionId) fail(409, 'This session has changed.');
        const part = session.parts?.[partId];
        if (!part?.studentId || !part.started) fail(409, 'This assignment has not started.');
        if (part.awarded || part.awardPending) return session;
        return { ...session, parts: { ...session.parts, [partId]: { ...part, awardPending: true } } };
      } catch (error) { claimError = error; return undefined; }
    }, undefined, false);
    if (claimError) throw claimError;
    if (!claim.committed || !claim.snapshot.val()) fail(409, 'The assignment could not be claimed.');
    const current = claim.snapshot.val();
    const part = current.parts?.[partId];
    if (part?.awarded) return publicSession(current, actor);
    if (!part?.studentId || !part.started) fail(409, 'This assignment has not started.');
    const assignmentKey = `${sessionId}_${partId}`;
    try { await awardPoint({ classId: actor.classId, studentId: part.studentId, assignmentKey }); }
    catch (error) {
      await ref.transaction(session => {
        if (!session || session.id !== sessionId) return undefined;
        const assigned = session.parts?.[partId];
        if (!assigned?.awardPending || assigned.studentId !== part.studentId || assigned.awarded) return undefined;
        const { awardPending, ...rest } = assigned;
        return { ...session, parts: { ...session.parts, [partId]: rest } };
      }, undefined, false);
      throw error;
    }
    let rejection;
    const result = await ref.transaction(session => {
      rejection = undefined;
      try {
        if (!session || session.id !== sessionId) fail(409, 'This session has changed.');
        const assigned = session.parts?.[partId];
        if (!assigned?.studentId || assigned.studentId !== part.studentId) fail(409, 'The assignment changed before the point was saved.');
        if (assigned.awarded) return session;
        const { awardPending, ...rest } = assigned;
        return { ...session, parts: { ...session.parts, [partId]: { ...rest, awarded: true } } };
      } catch (error) { rejection = error; return undefined; }
    }, undefined, false);
    if (rejection) throw rejection;
    if (!result.committed || !result.snapshot.val()) fail(409, 'The assignment could not be updated.');
    return publicSession(result.snapshot.val(), actor);
  }

  const id = randomUUID();
  const entropy = action === 'spin' ? spinEntropy() : 0;
  let rejection;
  const result = await ref.transaction(current => {
    rejection = undefined;
    try {
      if (action === 'open') {
        if (current?.openRequestId === requestId) return current;
        if (current && current.phase !== 'ended') fail(409, 'Finish the existing session first.');
        return { ...newSession(id, catalog), createdAt: Date.now(), openRequestId: requestId };
      }
      // RTDB may first run the callback with an empty local cache.
      if (current === null) return null;
      if (current.id !== sessionId) fail(409, 'This session has changed.');
      if (action === 'spin') return spin(current, { ...actor, requestId, entropy });
      if (action === 'registration') return setRegistration(current, body.open);
      if (action === 'assign') {
        const target = roster.find(student => student.id === body.studentId);
        if (body.studentId && !target) fail(403, 'Choose a student in this class.');
        return assignPart(current, { partId, studentId: target?.id || null, name: target?.name || null });
      }
      if (action === 'speed') {
        return setChazzanSpeed(current, { ...actor, partId, speed, requestId });
      }
      if (action === 'finish') {
        const parts = { ...current.parts };
        if (current.playback?.part) parts[current.playback.part] = { ...parts[current.playback.part], completed: true };
        return { ...current, phase: 'ended', endedAt: Date.now(), playback: null, parts };
      }
      return setPlayback(current, { part: partId, position, speed, playing, updatedAt: Date.now() });
    } catch (error) {
      rejection = error;
      return undefined;
    }
  }, undefined, false);

  if (rejection) throw rejection;
  const session = result.snapshot.val();
  if (!result.committed || !session) fail(409, 'The session is no longer available.');
  return publicSession(session, actor);
}

module.exports = { act };
