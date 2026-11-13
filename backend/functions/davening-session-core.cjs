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
  const parts = { ...session.parts };
  if (session.playback?.part && session.playback.part !== playback.part) {
    parts[session.playback.part] = { ...parts[session.playback.part], completed: true };
  }
  const part = parts[playback.part];
  return {
    ...session,
    phase: 'active',
    playback,
    parts: { ...parts, [playback.part]: { ...part, started: true, completed: false } }
  };
}

function setRegistration(session, open) {
  if (session.phase === 'active' || session.phase === 'ended') reject('Registration is closed.');
  if (typeof open !== 'boolean') reject('Choose whether registration is open.');
  return { ...session, phase: open ? 'signup' : 'ready' };
}

function assignPart(session, { partId, studentId, name }) {
  const current = session.parts[partId];
  if (!current) reject('Choose a davening part.');
  if (!session.phase || session.phase === 'ended') reject('This session has ended.');
  if (current.awardPending) reject('A Rewards point is being recorded for this assignment.');
  if (!studentId) return { ...session, parts: { ...session.parts,
    [partId]: { changes: 0, studentId: null, name: null, started: false, completed: false } } };
  const elsewhere = Object.entries(session.parts).filter(([id, part]) => id !== partId && part.studentId === studentId).length;
  if (elsewhere >= 2) reject('This student already has two parts.');
  return { ...session, parts: { ...session.parts,
    [partId]: { changes: 0, studentId, name, started: false, completed: false } } };
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

module.exports = { newSession, spin, setPlayback, setChazzanSpeed, setRegistration, assignPart, spinEntropy };
