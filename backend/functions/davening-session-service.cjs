'use strict';

const { randomUUID } = require('node:crypto');
const { newSession, spin, spinEntropy, setPlayback, setChazzanSpeed } =
  require('./davening-session-core.cjs');

const validKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
  && !Object.hasOwn(Object.prototype, value);

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function publicSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    phase: session.phase,
    playback: session.playback ?? null,
    parts: Object.fromEntries(Object.entries(session.parts).map(([id, part]) => [
      id, {
        studentId: part.studentId ?? null,
        name: part.name ?? null,
        changes: part.changes,
        started: Boolean(part.started),
        awarded: Boolean(part.awarded)
      }
    ]))
  };
}

// The endpoint supplies an authenticated, class-scoped actor and a server
// catalog. No actor identity or catalog is accepted from the request body.
async function act({ db, actor, catalog, body }) {
  if (!validKey(actor.classId)) fail(403, 'Choose an assigned class.');
  const ref = db.ref(`daveningSessions/${actor.classId}`);
  const { action, sessionId, requestId, partId, speed, position, playing } = body;
  if (action === 'read') return publicSession((await ref.get()).val());

  const teacher = actor.role === 'teacher';
  const student = actor.role === 'student' && validKey(actor.studentId);
  if (!(teacher && ['open', 'playback', 'finish'].includes(action))
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
  if (['playback', 'speed'].includes(action) && !validKey(partId)) fail(400, 'Invalid part.');
  if (action === 'playback' && (!Number.isFinite(position) || position < 0
    || !Number.isFinite(speed) || speed < 0.25 || speed > 4 || typeof playing !== 'boolean')) {
    fail(400, 'Invalid playback state.');
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
        return { ...newSession(id, catalog), openRequestId: requestId };
      }
      // RTDB may first run the callback with an empty local cache.
      if (current === null) return null;
      if (current.id !== sessionId) fail(409, 'This session has changed.');
      if (action === 'spin') return spin(current, { ...actor, requestId, entropy });
      if (action === 'speed') {
        return setChazzanSpeed(current, { ...actor, partId, speed, requestId });
      }
      if (action === 'finish') return { ...current, phase: 'ended', playback: null };
      return setPlayback(current, { part: partId, position, speed, playing, updatedAt: Date.now() });
    } catch (error) {
      rejection = error;
      return undefined;
    }
  }, undefined, false);

  if (rejection) throw rejection;
  const session = result.snapshot.val();
  if (!result.committed || !session) fail(409, 'The session is no longer available.');
  return publicSession(session);
}

module.exports = { act };
