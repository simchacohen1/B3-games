'use strict';

const crypto = require('node:crypto');
const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const core = require('./multiplayer-games-core.cjs');

if (!admin.apps.length) admin.initializeApp();

const OPTIONS = { region: 'us-central1', memory: '256MiB', maxInstances: 20 };
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SPECTATORS = 12;
const twoPlayerGame = gameKey => core.gameConfig(gameKey)?.maxPlayers === 2;
const activeQueue = room => (Array.isArray(room.winnerQueue) ? room.winnerQueue : [])
  .filter(id => room.spectators?.[id]);
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
    ['et', 'wt'].includes(classId) ? db.ref('b3Games/siteSettings').get() : Promise.resolve(null),
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
  return { studentId, classId, workspaceId: requestedWorkspace, name: safeName(member.name) };
}

function roomPublic(gameKey, room, state, timestamp) {
  const view = core.publicView(gameKey, state, room, timestamp);
  view.maxPlayers = core.gameConfig(gameKey).maxPlayers;
  view.allowSpectators = !!room.allowSpectators;
  view.spectatorCount = Object.keys(room.spectators || {}).length;
  view.winnerQueue = activeQueue(room);
  view.invitedStudentId = room.invitedStudentId || null;
  view.invitedStudentName = room.invitedStudentName || null;
  view.round = room.round || 1;
  return view;
}

function inviteSummary(gameKey, room, state, timestamp) {
  const config = core.gameConfig(gameKey);
  return {
    host: room.host, hostName: room.hostName, gameKey,
    gameName: config.name, gameUrl: '../multiplayer/game.html?game=' + encodeURIComponent(gameKey),
    roomCode: room.roomCode, state: room.state, playerCount: core.participantIds(room.players).length,
    maxPlayers: config.maxPlayers, allowSpectators: !!room.allowSpectators,
    spectatorCount: Object.keys(room.spectators || {}).length, queueCount: activeQueue(room).length,
    invitedStudentId: room.invitedStudentId || null, invitedStudentName: room.invitedStudentName || null,
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
    [p.invite]: room.state === 'lobby' || (room.allowSpectators && ['playing', 'finished'].includes(room.state))
      ? inviteSummary(gameKey, room, state, timestamp) : null,
  };
  const ids = new Set([...Object.keys(beforeRoom?.players || {}), ...Object.keys(room.players || {})]);
  for (const studentId of ids) {
    const previous = beforeRoom?.players?.[studentId]?.active === false
      ? {}
      : core.privateView(gameKey, beforeRoom?.game || {}, studentId);
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
    updatedAt: timestamp, allowSpectators: false, round: 1,
    players: { [actor.studentId]: { name: actor.name, active: true, joinedAt: timestamp } },
  };
  const state = core.createGameState(gameKey, room.players, { seed: crypto.randomInt(1, 0x7fffffff) });
  const multi = {
    [p.privateRoom]: { ...room, game: state },
    [p.publicRoom]: roomPublic(gameKey, room, state, timestamp),
    [p.invite]: inviteSummary(gameKey, room, state, timestamp),
  };
  const secret = core.privateView(gameKey, state, actor.studentId);
  if (secret.hand?.length || secret.card?.board?.length) multi[p.privateHands + '/' + actor.studentId] = secret;
  await db.ref().update(multi);
  return { roomCode, public: roomPublic(gameKey, room, state, timestamp) };
}

async function mutateRoom(db, actor, gameKey, roomCode, action, move, validatedInvite = null) {
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
      const previousPlayer = room.players?.[actor.studentId];
      if (previousPlayer && previousPlayer.active !== false) return room;
      const returningPlayer = Boolean(previousPlayer);
      const config = core.gameConfig(gameKey), ids = core.participantIds(room.players);
      if (!returningPlayer && room.invitedStudentId && room.invitedStudentId !== actor.studentId) {
        operationError = 'This playing spot is reserved for an invited classmate.'; return;
      }
      if (!(room.state === 'lobby' || returningPlayer && room.state === 'playing') ||
          !returningPlayer && ids.length >= config.maxPlayers) {
        operationError = 'This game is full or has already started.'; return;
      }
      room.players ||= {};
      room.players[actor.studentId] = {
        ...(previousPlayer || {}), name: actor.name, active: true,
        joinedAt: previousPlayer?.joinedAt || now(),
      };
      if (room.spectators?.[actor.studentId]) delete room.spectators[actor.studentId];
      room.winnerQueue = activeQueue(room);
      if (room.invitedStudentId === actor.studentId) {
        delete room.invitedStudentId; delete room.invitedStudentName;
      }
      if (!returningPlayer) {
        if (gameKey === 'memory-match') game.scores[actor.studentId] = 0;
        if (gameKey === 'bingo') {
          game.cards[actor.studentId] = core.makeBingoCard ? core.makeBingoCard(Date.now(), actor.studentId) : null;
          game.scores[actor.studentId] = 0;
        }
      }
    } else if (action === 'invite-target') {
      if (!twoPlayerGame(gameKey) || room.host !== actor.studentId || room.state !== 'lobby' ||
          core.participantIds(room.players).length !== 1) {
        operationError = 'Only the host can invite a classmate while waiting for an opponent.'; return;
      }
      // Target validity is checked before the transaction, not trusted from client-side names.
      const target = String(move?.studentId || '');
      if (!target) { delete room.invitedStudentId; delete room.invitedStudentName; }
      else if (target === actor.studentId || target !== validatedInvite?.studentId) {
        operationError = 'Choose an eligible classmate.'; return;
      } else {
        room.invitedStudentId = validatedInvite.studentId;
        room.invitedStudentName = validatedInvite.name;
      }
    } else if (action === 'spectators') {
      if (!twoPlayerGame(gameKey) || actor.studentId !== room.host) {
        operationError = 'Only the host can change spectator access.'; return;
      }
      room.allowSpectators = move?.allow === true;
      if (!room.allowSpectators) { room.spectators = {}; room.winnerQueue = []; }
    } else if (action === 'spectate') {
      if (!twoPlayerGame(gameKey) || !room.allowSpectators || !['lobby', 'playing', 'finished'].includes(room.state)) {
        operationError = 'Spectators are not allowed in this room.'; return;
      }
      if (room.players?.[actor.studentId]?.active !== false && room.players?.[actor.studentId]) return room;
      room.spectators ||= {};
      if (!room.spectators[actor.studentId] && Object.keys(room.spectators).length >= MAX_SPECTATORS) {
        operationError = 'Spectator spots are full.'; return;
      }
      room.spectators[actor.studentId] ||= { name: actor.name, joinedAt: now() };
    } else if (action === 'queue-winner') {
      if (!twoPlayerGame(gameKey) || !room.allowSpectators || !room.spectators?.[actor.studentId]) {
        operationError = 'Join as a spectator to play the winner next.'; return;
      }
      if (core.participantIds(room.players).length < 2) {
        operationError = 'Wait until both players have joined.'; return;
      }
      room.winnerQueue = activeQueue(room);
      if (!room.winnerQueue.includes(actor.studentId)) room.winnerQueue.push(actor.studentId);
    } else if (action === 'unqueue-winner') {
      room.winnerQueue = activeQueue(room).filter(id => id !== actor.studentId);
    } else if (action === 'next-round') {
      const queue = activeQueue(room), winnerId = String(room.game?.winner || '');
      if (!twoPlayerGame(gameKey) || !room.allowSpectators || room.state !== 'finished' ||
          !winnerId || actor.studentId !== winnerId || !room.players?.[winnerId] ||
          room.players[winnerId].active === false || !queue.length) {
        operationError = 'The winner must choose to play the next waiting challenger.'; return;
      }
      const challengerId = queue[0], challenger = room.spectators[challengerId];
      const winner = room.players[winnerId], formerPlayers = room.players;
      room.players = {
        [winnerId]: { ...winner, joinedAt: now() - 1 },
        [challengerId]: { name: challenger.name, active: true, joinedAt: now() },
      };
      delete room.spectators[challengerId];
      for (const [id, player] of Object.entries(formerPlayers)) {
        if (id !== winnerId) room.spectators[id] = { name: player.name, joinedAt: now() };
      }
      room.winnerQueue = queue.slice(1);
      room.host = winnerId; room.hostName = winner.name;
      delete room.invitedStudentId; delete room.invitedStudentName;
      room.game = core.createGameState(gameKey, room.players, { seed: crypto.randomInt(1, 0x7fffffff) });
      core.startGameState(gameKey, room.game, core.participantIds(room.players));
      room.round = (Number(room.round) || 1) + 1;
      room.state = 'playing'; room.startedAt = now(); delete room.finishedAt;
    } else if (action === 'rematch-draw') {
      if (!twoPlayerGame(gameKey) || room.state !== 'finished' || !room.game?.draw ||
          !room.players?.[actor.studentId] || room.players[actor.studentId].active === false) {
        operationError = 'Only current players can restart a drawn match.'; return;
      }
      room.game = core.createGameState(gameKey, room.players, { seed: crypto.randomInt(1, 0x7fffffff) });
      core.startGameState(gameKey, room.game, core.participantIds(room.players));
      room.round = (Number(room.round) || 1) + 1;
      room.state = 'playing'; room.startedAt = now(); delete room.finishedAt;
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
      if (!room.players?.[actor.studentId] || room.players[actor.studentId].active === false) {
        if (!room.spectators?.[actor.studentId]) { operationError = 'Join this room before leaving it.'; return; }
        delete room.spectators[actor.studentId];
        room.winnerQueue = activeQueue(room);
      } else room.players[actor.studentId].active = false;
      if (room.host === actor.studentId) {
        room.state = 'closed';
        room.closedAt = now();
      }
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
    if (data.action === 'cleanup') return await cleanupStaleRooms(db, actor);
    if (data.action === 'create') return await newRoom(db, actor, String(data.gameKey || ''));
    if (data.action === 'classmates') {
      const members = (await db.ref(`b3Games/workspaces/${actor.workspaceId}/classes/${actor.classId}/members`).get()).val() || {};
      return { classmates: Object.entries(members)
        .filter(([id, member]) => id !== actor.studentId && SAFE_ID.test(id) && member?.active !== false &&
          member?.toolAccess?.['multiplayer-center'] !== false)
        .slice(0, 80).map(([studentId, member]) => ({ studentId, name: safeName(member.name) }))
        .sort((a, b) => a.name.localeCompare(b.name)) };
    }
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
    let validatedInvite = null;
    if (data.action === 'invite-target' && data.move?.studentId) {
      const target = String(data.move.studentId);
      if (!SAFE_ID.test(target) || target === actor.studentId) {
        throw new HttpsError('invalid-argument', 'Choose a different classmate.');
      }
      const member = (await db.ref(`b3Games/workspaces/${actor.workspaceId}/classes/${actor.classId}/members/${target}`).get()).val();
      if (!member || member.active === false || member.toolAccess?.['multiplayer-center'] === false) {
        throw new HttpsError('permission-denied', 'That classmate is not currently available for this game.');
      }
      validatedInvite = { studentId: target, name: safeName(member.name) };
    }
    return await mutateRoom(db, actor, String(data.gameKey || ''), String(data.roomCode || ''), String(data.action || ''), data.move, validatedInvite);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('Multiplayer game action failed:', JSON.stringify({
      action: String(data.action || ''), gameKey: String(data.gameKey || ''), errorCode: String(error?.code || 'runtime'),
    }));
    throw new HttpsError('internal', 'The game server could not save that action. Please try again.');
  }
});

exports._test = { authorizeStudent, mutateRoom, newRoom, paths };
