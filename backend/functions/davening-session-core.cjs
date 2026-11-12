'use strict';

const { randomInt } = require('node:crypto');

function reject(message) {
  throw Object.assign(new Error(message), { status: 409 });
}

function newSession(id, parts) {
  return {
    id,
    phase: 'signup',
    parts: Object.fromEntries(parts.map(part => [part, { changes: 0 }]))
  };
}

// Run inside a class-scoped transaction. Entropy and request IDs come from
// the server and caller respectively and stay fixed across transaction retries.
function spin(session, { studentId, name, requestId, entropy }) {
  const prior = session.spins?.[studentId]?.[requestId];
  if (prior !== undefined) return session;
  if (session.phase !== 'signup') reject('The wheel is closed.');
  const entries = Object.entries(session.parts);
  if (entries.filter(([, part]) => part.studentId === studentId).length >= 2) {
    reject('You already have two parts.');
  }
  const available = entries.filter(([, part]) => !part.studentId);
  if (!available.length) reject('All parts have a chazzan.');
  const [id] = available[Math.floor(entropy * available.length)];
  const spins = session.spins || {};
  return {
    ...session,
    parts: { ...session.parts, [id]: { studentId, name, changes: 0 } },
    spins: { ...spins, [studentId]: { ...spins[studentId], [requestId]: id } }
  };
}

function setPlayback(session, playback) {
  if (session.phase === 'ended') reject('This session has ended.');
  if (!session.parts[playback.part]) reject('Choose a davening part.');
  const part = session.parts[playback.part];
  return {
    ...session,
    phase: 'active',
    playback,
    parts: { ...session.parts, [playback.part]: { ...part, started: true } }
  };
}

function setChazzanSpeed(session, { studentId, partId, speed, requestId }) {
  const part = session.parts[partId];
  if (!part || part.studentId !== studentId) reject('Only the assigned chazzan can change the speed.');
  if (part.speedRequests?.[requestId]) return session;
  if (session.phase !== 'active' || session.playback?.part !== partId) {
    reject('This part is no longer active.');
  }
  if (!Number.isFinite(speed) || speed < 1.1 || speed > 1.8) reject('Choose a speed from 1.1× to 1.8×.');
  if (part.changes >= 2) reject('You used both speed changes for this part.');
  return {
    ...session,
    parts: {
      ...session.parts,
      [partId]: {
        ...part,
        changes: part.changes + 1,
        speedRequests: { ...part.speedRequests, [requestId]: true }
      }
    },
    playback: { ...session.playback, speed }
  };
}

function spinEntropy() {
  return randomInt(2 ** 32) / 2 ** 32;
}

module.exports = { newSession, spin, setPlayback, setChazzanSpeed, spinEntropy };
