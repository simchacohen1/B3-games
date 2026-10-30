'use strict';

const crypto = require('node:crypto');
const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const core = require('./multiplayer-games-core.cjs');
const { allowsMultiplayer } = require('./multiplayer-lock-policy.cjs');

if (!admin.apps.length) admin.initializeApp();

const OPTIONS = { region: 'us-central1', memory: '256MiB', maxInstances: 20 };
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const now = () => Date.now();
const safeName = value => String(value || 'Classmate').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 32) || 'Classmate';
const paths = (workspaceId, classId, roomCode) => ({
  privateRoom: `b3Private/multiplayerGames/workspaces/${workspaceId}/classes/${classId}/rooms/${roomCode}`,
  privateHands: `b3Private/multiplayerGames/workspaces/${workspaceId}/classes/${classId}/rooms/${roomCode}/hands`,
  publicRoom: `multiplayerCenter/workspaces/${workspaceId}/classes/${classId}/strategyRooms/${roomCode}`,
  invite: `multiplayerCenter/workspaces/${workspaceId}/classes/${classId}/rooms/arcade-${roomCode}`,
});

async function authorizeStudent(request, db, requestedWorkspace) {
  const token = request.auth?.token;
  const studentId = String(token?.b3StudentId || '');
  const classId = String(token?.b3ClassId || '');
  if (!studentId || !SAFE_ID.test(studentId) || !SAFE_ID.test(classId) || !SAFE_ID.test(requestedWorkspace || '')) {
    throw new HttpsError('permission-denied', 'Sign in with your class account to play.');
  }
  const membershipKey = `${requestedWorkspace}_${classId}`;
  const [membershipSnap, classSnap, legacySettingsSnap] = await Promise.all([
    db.ref(`b3Games/students/${studentId}/memberships/${membershipKey}`).get(),
    db.ref(`b3Games/workspaces/${requestedWorkspace}/classes/${classId}`).get(),
    db.ref('b3Games/siteSettings').get(),
  ]);
  const membership = membershipSnap.val();
  const cls = classSnap.val();
  const member = cls?.members?.[studentId];
  if (!membership || membership.active === false || membership.classId !== classId || membership.workspaceId !== requestedWorkspace ||
      !cls || cls.active === false || !member || member.active === false) {
    throw new HttpsError('permission-denied', 'Your active class membership is required.');
  }
  const legacySettings = legacySettingsSnap?.val() || {};
  const centerEnabled = ['et', 'wt'].includes(classId)
    ? legacySettings.games?.['multiplayer-center'] !== false && legacySettings.classGames?.[classId]?.['multiplayer-center'] !== false
    : cls.toolGrants?.['multiplayer-center'] === true;
  if (!centerEnabled || member.toolAccess?.['multiplayer-center'] === false) {
    throw new HttpsError('permission-denied', 'Ask your teacher to turn on Multiplayer Center.');
  }
  return { studentId, classId, workspaceId: requestedWorkspace, name: safeName(member.name), lockSettings: legacySettings, classRow: cls };
}

function roomPublic(gameKey, room, state, timestamp) {
  return core.publicView(gameKey, state, room, timestamp);
}

function inviteSummary(gameKey, room, state, timestamp) {
  const config = core.gameConfig(gameKey);
  return {
    host: room.host, hostName: room.hostName, gameKey,
    gameName: config.name, gameUrl: '../multiplayer/game.html?game=' + encodeURIComponent(gameKey),
    roomCode: room.roomCode, state: room.state, playerCount: core.participantIds(room.players).length,
    createdAt: room.createdAt, updatedAt: timestamp,
  };
}

async function cleanupStaleRooms(db, actor) {
  const classPath = `multiplayerCenter/workspaces/${actor.workspaceId}/classes/${actor.classId}`;
  const base = `${classPath}/rooms`;
  const cutoff = now() - 20 * 60 * 1000;
  const stale = await db.ref(base).orderByChild('updatedAt').endAt(cutoff).limitToFirst(50).get();
  const updates = {};
  const entries = Object.entries(stale.val() || {}).filter(([key, row]) => key.startsWith('arcade-') && core.gameConfig(row?.gameKey));
  for (const [key, summary] of entries) {
    const roomCode = String(summary.roomCode || '');
    if (!SAFE_ID.test(roomCode)) { updates[`${base}/${key}`] = null; continue; }
    const p = paths(actor.workspaceId, actor.classId, roomCode);
    const snapshot = await db.ref(p.privateRoom).get();
    const room = snapshot.val();
    if (!room || room.state === 'lobby' && Number(room.updatedAt || room.createdAt) <= cutoff) {
      updates[p.privateRoom] = null;
      updates[p.publicRoom] = null;
      updates[p.invite] = null;
    } else if (room.state !== 'lobby') updates[p.invite] = null;
  }
  const oldRooms = await db.ref(`${classPath}/strategyRooms`).orderByChild('updatedAt').endAt(cutoff).limitToFirst(50).get();
  for (const [roomCode, room] of Object.entries(oldRooms.val() || {})) {
    if (!room || !core.gameConfig(room.gameKey)) continue;
    const age = now() - Number(room.updatedAt || room.createdAt || 0);
    const expired = ['finished', 'closed'].includes(room.state) && age >= 20 * 60 * 1000;
    const abandoned = room.state === 'lobby' && age >= 20 * 60 * 1000 || room.state === 'playing' && age >= 6 * 60 * 60 * 1000;
    if (expired || abandoned) {
      const p = paths(actor.workspaceId, actor.classId, roomCode);
      updates[p.publicRoom] = null;
      updates[p.privateRoom] = null;
      updates[p.invite] = null;
    }
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
  return { cleaned: entries.length };
}

function projectPlayerSecrets(gameKey, state, players) {
  const updates = {};
  for (const studentId of Object.keys(players || {})) {
    updates[`players/${studentId}`] = core.privateView(gameKey, state, studentId);
  }
  return updates;
}

async function publishRoom(db, gameKey, room, state, p, beforeRoom) {
  const timestamp = now();
  const writes = {
    [p.publicRoom]: roomPublic(gameKey, room, state, timestamp),
    [p.invite]: room.state === 'lobby' ? inviteSummary(gameKey, room, state, timestamp) : null,
  };
  const ids = new Set([...Object.keys(beforeRoom?.players || {}), ...Object.keys(room.players || {})]);
  for (const studentId of ids) {
    const previous = core.privateView(gameKey, beforeRoom?.game || {}, studentId);
    const next = room.players?.[studentId]?.active === false || ['closed', 'finished'].includes(room.state)
      ? {} : core.privateView(gameKey, state, studentId);
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      writes[p.privateHands + '/' + studentId] = Object.keys(next).length ? next : null;
    }
  }
  await db.ref().update(writes);
}

async function newRoom(db, actor, gameKey) {
  await cleanupStaleRooms(db, actor);
  const config = core.gameConfig(gameKey);
  if (!config) throw new HttpsError('invalid-argument', 'Unknown game.');
  const timestamp = now();
  let roomCode, p;
  for (let attempts = 0; attempts < 8; attempts += 1) {
    roomCode = crypto.randomInt(100000, 1000000).toString();
    p = paths(actor.workspaceId, actor.classId, roomCode);
    if (!(await db.ref(p.privateRoom).get()).exists()) break;
    roomCode = '';
  }
  if (!roomCode) throw new HttpsError('resource-exhausted', 'Could not open a game room. Try again.');
  const room = {
    roomCode, gameKey, host: actor.studentId, hostName: actor.name, state: 'lobby', createdAt: timestamp,
    updatedAt: timestamp, players: { [actor.studentId]: { name: actor.name, active: true, joinedAt: timestamp } },
  };
  const state = core.createGameState(gameKey, room.players, { seed: crypto.randomInt(1, 0x7fffffff) });
  const multi = {
    [p.privateRoom]: { ...room, game: state },
    [p.publicRoom]: roomPublic(gameKey, room, state, timestamp),
    [p.invite]: inviteSummary(gameKey, room, state, timestamp),
  };
  const secret = core.privateView(gameKey, state, actor.studentId);
  if (secret.hand?.length) multi[p.privateHands + '/' + actor.studentId] = secret;
  await db.ref().update(multi);
  return { roomCode, public: roomPublic(gameKey, room, state, timestamp) };
}

async function mutateRoom(db, actor, gameKey, roomCode, action, move) {
  if (!SAFE_ID.test(roomCode || '') || !core.gameConfig(gameKey)) throw new HttpsError('invalid-argument', 'Invalid room or game.');
  const p = paths(actor.workspaceId, actor.classId, roomCode);
  let operationError = '';
  let previousRoom = null;
  const tx = await db.ref(p.privateRoom).transaction(current => {
    operationError = '';
    if (current == null) { operationError = 'That game room is no longer available.'; return null; }
    if (current.gameKey !== gameKey || current.roomCode !== roomCode) { operationError = 'That game room is no longer available.'; return; }
    previousRoom = structuredClone(current);
    const room = current;
    if (room.state === 'closed' || (now() - Number(room.createdAt || 0) > 6 * 60 * 60 * 1000)) { operationError = 'That game room has closed.'; return; }
    const game = room.game = core.hydrateGameState(gameKey, room.game);
    if (action === 'join') {
      if (room.players?.[actor.studentId]?.active !== false && room.players?.[actor.studentId]) return room;
      const config = core.gameConfig(gameKey), ids = core.participantIds(room.players);
      if (room.state !== 'lobby' || ids.length >= config.maxPlayers) { operationError = 'This game is full or has already started.'; return; }
      room.players ||= {};
      room.players[actor.studentId] = { name: actor.name, active: true, joinedAt: now() };
      if (gameKey === 'memory-match') game.scores[actor.studentId] = 0;
      if (gameKey === 'bingo') {
        game.cards[actor.studentId] = core.makeBingoCard ? core.makeBingoCard(Date.now(), actor.studentId) : null;
        game.scores[actor.studentId] = 0;
      }
    } else if (action === 'start') {
      if (actor.studentId !== room.host) { operationError = 'Only the host can start this game.'; return; }
      if (room.state !== 'lobby') { operationError = 'This game has already started.'; return; }
      try { core.startGameState(gameKey, game, core.participantIds(room.players)); }
      catch (error) { operationError = error.message; return; }
      room.state = 'playing'; room.startedAt = now();
    } else if (action === 'move') {
      if (room.state !== 'playing') { operationError = 'Wait for the host to start the game.'; return; }
      try { core.applyMove(gameKey, game, actor.studentId, move, room.players); }
      catch (error) { operationError = error.message; return; }
      if (game.finished) { room.state = 'finished'; room.finishedAt = now(); }
    } else if (action === 'leave') {
      if (room.players?.[actor.studentId]) room.players[actor.studentId].active = false;
      room.state = 'closed';
      room.closedAt = now();
    } else { operationError = 'Unknown game action.'; return; }
    room.updatedAt = now();
    return room;
  }, undefined, false);
  if (!tx.committed || operationError) {
    throw new HttpsError('failed-precondition', operationError || 'That move could not be saved.');
  }
  const room = tx.snapshot.val();
  room.game = core.hydrateGameState(gameKey, room.game);
  await publishRoom(db, gameKey, room, room.game, p, previousRoom);
  return { roomCode, public: roomPublic(gameKey, room, room.game, now()), private: core.privateView(gameKey, room.game, actor.studentId) };
}

exports.multiplayerGameAction = onCall(OPTIONS, async request => {
  const db = admin.database();
  const data = request.data || {};
  try {
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 2048) {
      throw new HttpsError('invalid-argument', 'That game action is too large.');
    }
    const actor = await authorizeStudent(request, db, String(data.workspaceId || ''));
    // Mirror production server-side lock protection for fictional staging students.
    if (data.action !== 'leave' && data.action !== 'cleanup' && !allowsMultiplayer({
      actorRole: 'student', classId: actor.classId, studentId: actor.studentId,
      settings: actor.lockSettings, classRow: actor.classRow,
    })) {
      throw new HttpsError('permission-denied', 'Multiplayer Arcade is locked for your class. Ask your teacher to unlock it.');
    }
    if (data.action === 'cleanup') return await cleanupStaleRooms(db, actor);
    if (data.action === 'create') return await newRoom(db, actor, String(data.gameKey || ''));
    if (data.action === 'get-private') {
      if (!SAFE_ID.test(data.roomCode || '') || !core.gameConfig(data.gameKey)) throw new HttpsError('invalid-argument', 'Invalid room or game.');
      const p = paths(actor.workspaceId, actor.classId, data.roomCode);
      const [roomSnapshot, handSnapshot] = await Promise.all([db.ref(p.privateRoom).get(), db.ref(p.privateHands + '/' + actor.studentId).get()]);
      const room = roomSnapshot.val();
      if (!room || room.gameKey !== data.gameKey || !room.players?.[actor.studentId] || room.players[actor.studentId].active === false) {
        throw new HttpsError('permission-denied', 'Join this room to see your game cards.');
      }
      return { private: handSnapshot.val() || core.privateView(data.gameKey, room.game, actor.studentId) };
    }
    return await mutateRoom(db, actor, String(data.gameKey || ''), String(data.roomCode || ''), String(data.action || ''), data.move);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('Multiplayer game action failed:', JSON.stringify({
      action: String(data.action || ''), gameKey: String(data.gameKey || ''), errorCode: String(error?.code || 'runtime'),
    }));
    throw new HttpsError('internal', 'The game server could not save that action. Please try again.');
  }
});

exports._test = { authorizeStudent, mutateRoom, newRoom, paths };
