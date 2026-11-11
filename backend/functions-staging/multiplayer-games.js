'use strict';

const crypto = require('node:crypto');
const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const core = require('./multiplayer-games-core.cjs');
const matchmaking = require('./multiplayer-matchmaking-core.cjs');
const { allowsMultiplayer } = require('./multiplayer-lock-policy.cjs');

if (!admin.apps.length) admin.initializeApp();

const OPTIONS = { region: 'us-central1', memory: '256MiB', maxInstances: 20 };
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SPECTATORS = 12;
// How long a player who left mid-game has to come back before classmates may continue without them.
const AWAY_GRACE_MS = 45_000;
const twoPlayerGame = gameKey => core.gameConfig(gameKey)?.maxPlayers === 2;
const activeQueue = room => (Array.isArray(room.winnerQueue) ? room.winnerQueue : []).filter(id => room.spectators?.[id]);
const now = () => Date.now();
const safeName = value => String(value || 'Classmate').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 32) || 'Classmate';
const paths = (workspaceId, classId, roomCode) => ({
  privateRoom: `b3Private/multiplayerGames/workspaces/${workspaceId}/classes/${classId}/rooms/${roomCode}`,
  privateHands: `b3Private/multiplayerGames/workspaces/${workspaceId}/classes/${classId}/rooms/${roomCode}/hands`,
  publicRoom: `multiplayerCenter/workspaces/${workspaceId}/classes/${classId}/strategyRooms/${roomCode}`,
  invite: `multiplayerCenter/workspaces/${workspaceId}/classes/${classId}/rooms/arcade-${roomCode}`,
});

async function reserveMatchmakingRoom(db, path, candidate, gameKey, actorId) {
  const result = await db.ref(path).transaction(current => current == null ? candidate : undefined);
  const saved = result.snapshot.val();
  if (result.committed) return { created: true, room: saved };
  if (saved?.gameKey !== gameKey || saved?.host !== actorId || saved?.matchmaking !== true) {
    throw new HttpsError('already-exists', 'The reserved game room is unavailable.');
  }
  return { created: false, room: saved };
}

async function publishMatchmakingMirror(db, path, value, version) {
  await db.ref(path).transaction(current => {
    if (current && Number(current.updatedAt || 0) > version) return undefined;
    return value;
  });
}

async function authorizeActor(request, db, requestedWorkspace, requestedClassId) {
  const token = request.auth?.token;
  const studentId = String(token?.b3StudentId || '');
  const classId = String(requestedClassId || token?.b3ClassId || '');
  if (!SAFE_ID.test(classId) || !SAFE_ID.test(requestedWorkspace || '')) throw new HttpsError('permission-denied', 'Choose an assigned class to play.');
  let member = null, cls = null, actorRole = 'student', participantId = studentId, name = '';
  if (studentId) {
    if (!SAFE_ID.test(studentId)) throw new HttpsError('permission-denied', 'Your active class membership is required.');
    const membershipKey = `${requestedWorkspace}_${classId}`;
    if (String(token?.b3ClassId || '') !== classId) throw new HttpsError('permission-denied', 'Your active class membership is required.');
    const [membershipSnap, classSnap] = await Promise.all([
      db.ref(`b3Games/students/${studentId}/memberships/${membershipKey}`).get(),
      db.ref(`b3Games/workspaces/${requestedWorkspace}/classes/${classId}`).get(),
    ]);
    const membership = membershipSnap.val();
    cls = classSnap.val();
    member = cls?.members?.[studentId];
    if (!membership || membership.active === false || membership.classId !== classId || membership.workspaceId !== requestedWorkspace ||
        !cls || cls.active === false || !member || member.active === false) {
      throw new HttpsError('permission-denied', 'Your active class membership is required.');
    }
    name = safeName(token?.b3StudentName || member.name);
  } else {
    const uid = String(request.auth?.uid || '');
    if (!uid || !SAFE_ID.test(uid)) throw new HttpsError('permission-denied', 'Sign in with an authorized teacher account.');
    const [teacherSnap, classSnap] = await Promise.all([
      db.ref(`b3Games/workspaces/${requestedWorkspace}/teachers/${uid}`).get(),
      db.ref(`b3Games/workspaces/${requestedWorkspace}/classes/${classId}`).get(),
    ]);
    const teacher = teacherSnap?.val();
    const ownerMode = teacher?.role === 'owner';
    const admin = ownerMode ? (await db.ref(`b3Games/admins/${uid}`).get()).val() : null;
    const assignedTeacher = teacher?.role === 'teacher' && teacher.classIds?.[classId] === true;
    const authorizedOwner = ownerMode && admin && admin.active !== false;
    if (!teacher || teacher.active !== true ||
        !(assignedTeacher || authorizedOwner)) {
      throw new HttpsError('permission-denied', 'An active teacher assignment for this class is required.');
    }
    participantId = `teacher_${uid}`;
    if (!SAFE_ID.test(participantId)) throw new HttpsError('permission-denied', 'This teacher account cannot join the game.');
    actorRole = 'teacher';
    name = safeName(teacher.displayName || token?.name || 'Teacher');
    cls = classSnap.val();
  }
  const legacySettingsSnap = await db.ref('b3Games/siteSettings').get();
  if (!cls || cls.active === false) throw new HttpsError('permission-denied', 'Your active class membership is required.');
  if (actorRole === 'teacher' && cls?.teacherIds?.[request.auth.uid] !== true) {
    throw new HttpsError('permission-denied', 'This teacher is not assigned to the selected class.');
  }
  const legacySettings = legacySettingsSnap?.val() || {};
  const centerEnabled = ['et', 'wt'].includes(classId)
    ? legacySettings.games?.['multiplayer-center'] !== false && legacySettings.classGames?.[classId]?.['multiplayer-center'] !== false
    : cls.toolGrants?.['multiplayer-center'] === true;
  if (!centerEnabled || actorRole === 'student' && member?.toolAccess?.['multiplayer-center'] === false) {
    throw new HttpsError('permission-denied', 'Ask your teacher to turn on Multiplayer Center.');
  }
  return { studentId: participantId, participantId, actorRole, classId, workspaceId: requestedWorkspace, name,
    lockSettings: legacySettings, classRow: cls, className: safeName(cls.name || classId) };
}

function roomPublic(gameKey, room, state, timestamp) {
  const view = core.publicView(gameKey, state, room, timestamp);
  view.allowSpectators = room.allowSpectators === true;
  view.spectators = Object.entries(room.spectators || {}).map(([studentId, spectator]) => ({ studentId, name: spectator.name }));
  view.winnerQueue = activeQueue(room);
  view.invitedStudentId = room.invitedStudentId || null;
  view.invitedStudentName = room.invitedStudentName || null;
  view.round = room.round || 1;
  if (room.state === 'countdown' && Number.isFinite(Number(room.countdownAt))) view.countdownAt = Number(room.countdownAt);
  if (room.state === 'playing') {
    const away = Object.entries(room.players || {})
      .filter(([, player]) => player && player.active === false && player.role !== 'computer')
      .map(([studentId, player]) => ({ studentId, name: safeName(player.name), leftAt: Number(player.leftAt) || 0 }));
    if (away.length) { view.awayPlayers = away; view.awayGraceMs = AWAY_GRACE_MS; }
  }
  if (room.forfeitBy) view.forfeitBy = room.forfeitBy;
  return view;
}

function inviteSummary(gameKey, room, state, timestamp) {
  const config = core.gameConfig(gameKey);
  return {
    host: room.host, hostName: room.hostName, hostRole: room.players?.[room.host]?.role || 'student', gameKey,
    gameName: config.name, gameUrl: '../multiplayer/game.html?game=' + encodeURIComponent(gameKey),
    roomCode: room.roomCode, state: room.state, playerCount: core.participantIds(room.players).length,
    maxPlayers: config.maxPlayers, allowSpectators: room.allowSpectators === true,
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
    [p.invite]: room.state === 'lobby' || room.allowSpectators && ['playing', 'finished'].includes(room.state)
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

async function newRoom(db, actor, gameKey, options = {}) {
  await cleanupStaleRooms(db, actor);
  const config = core.gameConfig(gameKey);
  if (!config) throw new HttpsError('invalid-argument', 'Unknown game.');
  const timestamp = now();
  let roomCode = String(options.roomCode || ''), p;
  if (roomCode) {
    if (!/^\d{6}$/.test(roomCode)) throw new HttpsError('invalid-argument', 'Invalid reserved room code.');
    p = paths(actor.workspaceId, actor.classId, roomCode);
    const existing = (await db.ref(p.privateRoom).get()).val();
    if (existing) {
      if (existing.gameKey !== gameKey || existing.host !== actor.studentId) throw new HttpsError('already-exists', 'The reserved game room is unavailable.');
      if (options.matchmaking !== true) return { roomCode, public: roomPublic(gameKey, existing, existing.game, now()) };
    }
  } else {
    for (let attempts = 0; attempts < 8; attempts += 1) {
      roomCode = crypto.randomInt(100000, 1000000).toString();
      p = paths(actor.workspaceId, actor.classId, roomCode);
      if (!(await db.ref(p.privateRoom).get()).exists()) break;
      roomCode = '';
    }
  }
  if (!roomCode) throw new HttpsError('resource-exhausted', 'Could not open a game room. Try again.');
  const computerOpponent = options.computerOpponent === true;
  if (computerOpponent && (actor.actorRole !== 'student' || !core.supportsComputerOpponent(gameKey))) {
    throw new HttpsError('invalid-argument', 'Computer opponents are available for Tic Tac Toe and Connect 4.');
  }
  const computerId = computerOpponent ? `computer_${roomCode}` : '';
  const players = { [actor.studentId]: { name: actor.name, role: actor.actorRole, active: true, joinedAt: timestamp } };
  if (computerOpponent) players[computerId] = { name: 'Computer', role: 'computer', active: true, joinedAt: timestamp + 1 };
  const room = {
    roomCode, gameKey, host: actor.studentId, hostName: actor.name, state: 'lobby', createdAt: timestamp,
    updatedAt: timestamp, awardId: crypto.randomUUID(), allowSpectators: false, round: 1, players,
    ...(computerOpponent ? { computerOpponent: true, computerId } : {}), ...(options.matchmaking === true ? { matchmaking: true } : {}),
  };
  const state = core.createGameState(gameKey, room.players, { seed: crypto.randomInt(1, 0x7fffffff) });
  if (computerOpponent) { core.startGameState(gameKey, state, core.participantIds(room.players)); room.state = 'playing'; room.startedAt = timestamp; }
  const privateRoom = { ...room, game: state };
  let publishedRoom = privateRoom;
  let mirrorVersion = Number(privateRoom.updatedAt || timestamp);
  if (options.matchmaking === true) {
    // A queue match can trigger concurrent callable retries from its creator.
    // Reserve the shared room with a transaction so only one request installs
    // the initial state; retries return the winning room without resetting it.
    const reservation = await reserveMatchmakingRoom(db, p.privateRoom, privateRoom, gameKey, actor.studentId);
    publishedRoom = reservation.room;
    mirrorVersion = Number(publishedRoom.updatedAt || publishedRoom.createdAt || timestamp);
  }
  const publishedState = core.hydrateGameState(gameKey, publishedRoom.game);
  const publicSnapshot = roomPublic(gameKey, publishedRoom, publishedState, mirrorVersion);
  const inviteSnapshot = publishedRoom.state === 'lobby' || publishedRoom.allowSpectators && ['playing', 'finished'].includes(publishedRoom.state)
    ? inviteSummary(gameKey, publishedRoom, publishedState, mirrorVersion) : null;
  if (options.matchmaking === true) {
    // A creator retry repairs a failed/missing mirror from the latest room,
    // while the version-checked transactions reject any stale publication.
    await Promise.all([
      publishMatchmakingMirror(db, p.publicRoom, publicSnapshot, mirrorVersion),
      publishMatchmakingMirror(db, p.invite, inviteSnapshot, mirrorVersion),
    ]);
  } else {
    const multi = { [p.publicRoom]: publicSnapshot, [p.invite]: inviteSnapshot, [p.privateRoom]: privateRoom };
    const secret = core.privateView(gameKey, publishedState, actor.studentId);
    if (secret.hand?.length || secret.card?.board?.length) multi[p.privateHands + '/' + actor.studentId] = secret;
    await db.ref().update(multi);
  }
  return { roomCode, public: roomPublic(gameKey, publishedRoom, publishedState, now()) };
}

async function quickPlay(db, actor, gameKey) {
  if (actor.actorRole !== 'student') throw new HttpsError('permission-denied', 'Quick Play is for students.');
  if (!core.gameConfig(gameKey)) throw new HttpsError('invalid-argument', 'Unknown game.');
  const base = `b3Private/multiplayerGames/workspaces/${actor.workspaceId}/classes/${actor.classId}`;
  const queuePath = `${base}/quickPlay/${gameKey}`;
  const nowAt = now();
  // A finished (or long-abandoned) earlier match must not keep sending the student back to that old room.
  const mine = (await db.ref(`${queuePath}/${actor.studentId}`).get()).val();
  if (mine?.status === 'matched' && mine.roomCode) {
    const old = (await db.ref(paths(actor.workspaceId, actor.classId, mine.roomCode).privateRoom).get()).val();
    const over = old ? (old.state === 'finished' || old.state === 'closed') : nowAt - Number(mine.matchedAt || mine.createdAt || 0) > matchmaking.QUEUE_TTL_MS;
    if (over) {
      await db.ref(queuePath).transaction(entries => {
        if (entries && entries[actor.studentId]?.roomCode === mine.roomCode) delete entries[actor.studentId];
        return entries;
      });
    }
  }
  const proposedRoomCode = crypto.randomInt(100000, 1000000).toString();
  const queueTx = await db.ref(queuePath).transaction(entries => {
    entries ||= {};
    const current = entries[actor.studentId];
    if (current?.inviteLocked === true && nowAt - Number(current.inviteAt || current.createdAt || 0) <= matchmaking.QUEUE_TTL_MS) return entries;
    if (current?.inviteLocked === true) delete entries[actor.studentId];
    if (current?.status === 'matched') return entries;
    const match = matchmaking.availableEntries(entries, nowAt, actor.studentId)[0];
    if (match) {
      entries[match[0]].status = 'matched';
      entries[match[0]].matchedAt = nowAt;
      entries[match[0]].matchedWith = actor.studentId;
      entries[match[0]].creatorId = actor.studentId;
      entries[match[0]].roomCode = proposedRoomCode;
      entries[actor.studentId] = { status: 'matched', createdAt: nowAt, matchedAt: nowAt, matchedWith: match[0], creatorId: actor.studentId, roomCode: proposedRoomCode };
    } else entries[actor.studentId] = { status: 'waiting', createdAt: nowAt };
    Object.keys(entries).forEach(id => { if (nowAt - Number(entries[id]?.createdAt || 0) > matchmaking.QUEUE_TTL_MS * 2) delete entries[id]; });
    return entries;
  });
  const entry = queueTx.snapshot.val()?.[actor.studentId];
  if (entry?.inviteLocked === true) return { status: 'invite-locked' };
  if (entry?.matchedWith && entry.roomCode && entry.creatorId === actor.studentId) {
    // newRoom reserves atomically and repairs version-checked mirrors from
    // the existing room on callable retries, without resetting private state.
    await newRoom(db, actor, gameKey, { roomCode: entry.roomCode, matchmaking: true });
    return { status: 'matched', roomCode: entry.roomCode };
  }
  if (entry?.matchedWith && entry.roomCode) {
    const roomPath = paths(actor.workspaceId, actor.classId, entry.roomCode).privateRoom;
    if ((await db.ref(roomPath).get()).exists()) return { status: 'matched', roomCode: entry.roomCode };
    return { status: 'matching', matchedWith: entry.matchedWith };
  }
  return { status: 'waiting', expiresAt: nowAt + matchmaking.QUEUE_TTL_MS };
}

async function updateInviteQueue(db, actor, gameKey, inviteId, targetId) {
  const queuePath = `b3Private/multiplayerGames/workspaces/${actor.workspaceId}/classes/${actor.classId}/quickPlay/${gameKey}`;
  await db.ref(queuePath).transaction(entries => {
    if (targetId) return matchmaking.reserveForInvite(entries, [actor.studentId, targetId], now(), inviteId);
    return matchmaking.releaseInvite(entries, inviteId, now());
  });
}

async function cancelQuickPlay(db, actor, gameKey) {
  if (actor.actorRole !== 'student' || !core.gameConfig(gameKey)) throw new HttpsError('permission-denied', 'Only a signed-in student can cancel Quick Play.');
  const path = `b3Private/multiplayerGames/workspaces/${actor.workspaceId}/classes/${actor.classId}/quickPlay/${gameKey}`;
  let result;
  const tx = await db.ref(path).transaction(entries => {
    result = matchmaking.cancelQueue(entries, actor.studentId, now());
    return result.entries;
  });
  const value = tx.snapshot.val() || {};
  const state = value[actor.studentId];
  if (state?.roomCode) return { status: 'room-assigned', roomCode: state.roomCode };
  return { status: result?.status || 'cancelled' };
}

async function gameLeaderboard(db, actor) {
  const path = `b3Private/multiplayerGames/workspaces/${actor.workspaceId}/classes/${actor.classId}/coins`;
  const ledger = (await db.ref(path).get()).val() || {};
  const personal = ledger.balances?.[actor.studentId] || {};
  const peerCoins = Number.isSafeInteger(personal.coins) && personal.coins >= 0 ? personal.coins : 0;
  const computerCoins = Number.isSafeInteger(personal.computerCoins) && personal.computerCoins >= 0 ? personal.computerCoins : 0;
  const policy = (await db.ref(`b3Games/workspaces/${actor.workspaceId}/classes/${actor.classId}/multiplayerGameCoins`).get()).val();
  return {
    rewardsConfigured: Boolean(policy),
    leaderboard: matchmaking.leaderboard(ledger.balances || {}),
    balance: { peerCoins, computerCoins, totalCoins: Math.min(Number.MAX_SAFE_INTEGER, peerCoins + computerCoins) },
  };
}

// The older race games publish their waiting rooms as <gameKey>-<code> next to the arcade-<code> rooms.
const RACE_GAME_KEYS = new Set(['shorashim', 'yiddish', 'gematria', 'weekly-quiz', 'rashi-letters']);
async function listPublicRooms(db, actor) {
  const path = `multiplayerCenter/workspaces/${actor.workspaceId}/classes/${actor.classId}/rooms`;
  const rooms = (await db.ref(path).get()).val() || {};
  const recent = Object.entries(rooms)
    .filter(([key, room]) => room && SAFE_ID.test(String(room.roomCode || '')) &&
      (key.startsWith('arcade-') && core.gameConfig(room.gameKey) || RACE_GAME_KEYS.has(room.gameKey) && key === `${room.gameKey}-${room.roomCode}`))
    .sort((a, b) => Number(b[1].updatedAt || b[1].createdAt || 0) - Number(a[1].updatedAt || a[1].createdAt || 0))
    .slice(0, 50);
  return { rooms: Object.fromEntries(recent) };
}

function normalizeGameCoinPolicy(value) {
  if (!value || typeof value !== 'object' ||
      !Number.isSafeInteger(value.win) || value.win < 0 ||
      !Number.isSafeInteger(value.finish) || value.finish < 0 ||
      !Number.isSafeInteger(value.sportsmanship) || value.sportsmanship < 0 ||
      !Number.isFinite(value.computerMultiplier) || value.computerMultiplier < 0 || value.computerMultiplier >= 1) {
    throw new HttpsError('invalid-argument', 'Enter whole, non-negative coin rewards and a computer multiplier from 0 up to (but not including) 1.');
  }
  return { win: value.win, finish: value.finish, sportsmanship: value.sportsmanship, computerMultiplier: value.computerMultiplier };
}

async function getGameCoinPolicy(db, actor) {
  if (actor.actorRole !== 'teacher') throw new HttpsError('permission-denied', 'Only this class’s teacher can view reward settings.');
  const path = `b3Games/workspaces/${actor.workspaceId}/classes/${actor.classId}/multiplayerGameCoins`;
  return { policy: (await db.ref(path).get()).val() || null };
}

async function setGameCoinPolicy(db, actor, value) {
  if (actor.actorRole !== 'teacher') throw new HttpsError('permission-denied', 'Only this class’s teacher can change reward settings.');
  const policy = normalizeGameCoinPolicy(value);
  const path = `b3Games/workspaces/${actor.workspaceId}/classes/${actor.classId}/multiplayerGameCoins`;
  await db.ref(path).set(policy);
  return { policy };
}

async function persistCompletionAwards(db, actor, gameKey, roomCode, room) {
  if (room.state !== 'finished' || !room.game?.finished || !room.finishedAt) return;
  const configPath = `b3Games/workspaces/${actor.workspaceId}/classes/${actor.classId}/multiplayerGameCoins`;
  const policy = (await db.ref(configPath).get()).val();
  // No implicit/default economy: a class must have an explicit reward policy.
  if (!policy) return { configured: false };
  const results = matchmaking.completionResults(room);
  const ledgerPath = `b3Private/multiplayerGames/workspaces/${actor.workspaceId}/classes/${actor.classId}/coins`;
  // Rematches and next-challenger rounds reuse the room, so each round needs its own award id;
  // otherwise only round 1 would ever pay out.
  const baseAwardId = room.awardId || `${roomCode}_${room.createdAt}`;
  const awardId = Number(room.round) > 1 ? `${baseAwardId.slice(0, 56)}_r${Number(room.round)}` : baseAwardId;
  const tx = await db.ref(ledgerPath).transaction(current => matchmaking.awardGameCoins(current, awardId, results, policy).ledger);
  const ledger = tx?.snapshot?.val?.() || {};
  return { configured: true, awards: ledger.awards?.[awardId] || {}, balances: ledger.balances || {} };
}

function coinSummary(result, room, studentId) {
  if (!result) return null;
  if (!result.configured) return { configured: false };
  const row = result.balances?.[studentId] || {};
  const peerCoins = Number.isSafeInteger(row.coins) && row.coins > 0 ? row.coins : 0;
  const computerCoins = Number.isSafeInteger(row.computerCoins) && row.computerCoins > 0 ? row.computerCoins : 0;
  return { configured: true, earned: Number(result.awards?.[studentId]) || 0, computerGame: room.computerOpponent === true,
    peerCoins, computerCoins, totalCoins: peerCoins + computerCoins };
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
        ...(previousPlayer || {}), name: actor.name, role: actor.actorRole, active: true,
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
      if (room.matchmaking === true && core.participantIds(room.players).length >= 2 && room.state === 'lobby') {
        try { core.startGameState(gameKey, game, core.participantIds(room.players)); }
        catch (error) { operationError = error.message; return; }
        room.state = 'countdown';
        room.countdownAt = now() + 3000;
      }
    } else if (action === 'invite-target') {
      if (!twoPlayerGame(gameKey) || room.host !== actor.studentId || room.state !== 'lobby' || core.participantIds(room.players).length !== 1) {
        operationError = 'Only the host can invite a classmate while waiting for an opponent.'; return;
      }
      const target = String(move?.studentId || '');
      if (!target) { delete room.invitedStudentId; delete room.invitedStudentName; }
      else if (target === actor.studentId || target !== validatedInvite?.studentId) {
        operationError = 'Choose an eligible classmate.'; return;
      } else {
        room.invitedStudentId = validatedInvite.studentId;
        room.invitedStudentName = validatedInvite.name;
      }
    } else if (action === 'spectators') {
      if (!twoPlayerGame(gameKey) || actor.studentId !== room.host) { operationError = 'Only the host can change spectator access.'; return; }
      room.allowSpectators = move?.allow === true;
      if (!room.allowSpectators) { room.spectators = {}; room.winnerQueue = []; }
    } else if (action === 'spectate') {
      if (!twoPlayerGame(gameKey) || !room.allowSpectators || !['lobby', 'playing', 'finished'].includes(room.state)) {
        operationError = 'Spectators are not allowed in this room.'; return;
      }
      if (room.players?.[actor.studentId] && room.players[actor.studentId].active !== false) return room;
      room.spectators ||= {};
      if (!room.spectators[actor.studentId] && Object.keys(room.spectators).length >= MAX_SPECTATORS) {
        operationError = 'Spectator spots are full.'; return;
      }
      room.spectators[actor.studentId] ||= { name: actor.name, joinedAt: now() };
    } else if (action === 'queue-winner') {
      if (!twoPlayerGame(gameKey) || !room.allowSpectators || !room.spectators?.[actor.studentId]) {
        operationError = 'Join as a spectator to play the winner next.'; return;
      }
      if (core.participantIds(room.players).length < 2) { operationError = 'Wait until both players have joined.'; return; }
      room.winnerQueue = activeQueue(room);
      if (!room.winnerQueue.includes(actor.studentId)) room.winnerQueue.push(actor.studentId);
    } else if (action === 'unqueue-winner') {
      room.winnerQueue = activeQueue(room).filter(id => id !== actor.studentId);
    } else if (action === 'next-round') {
      const queue = activeQueue(room), winnerId = String(room.game?.winner || '');
      if (!twoPlayerGame(gameKey) || !room.allowSpectators || room.state !== 'finished' || !winnerId ||
          actor.studentId !== winnerId || !room.players?.[winnerId] || room.players[winnerId].active === false || !queue.length) {
        operationError = 'The winner must choose to play the next waiting challenger.'; return;
      }
      const challengerId = queue[0], challenger = room.spectators[challengerId], winner = room.players[winnerId];
      const formerPlayers = room.players;
      room.players = { [winnerId]: { ...winner, joinedAt: now() - 1 }, [challengerId]: { name: challenger.name, role: 'student', active: true, joinedAt: now() } };
      delete room.spectators[challengerId];
      for (const [id, player] of Object.entries(formerPlayers)) if (id !== winnerId) room.spectators[id] = { name: player.name, joinedAt: now() };
      room.winnerQueue = queue.slice(1); room.host = winnerId; room.hostName = winner.name;
      delete room.invitedStudentId; delete room.invitedStudentName;
      room.game = core.createGameState(gameKey, room.players, { seed: crypto.randomInt(1, 0x7fffffff) });
      core.startGameState(gameKey, room.game, core.participantIds(room.players));
      room.round = (Number(room.round) || 1) + 1; room.state = 'playing'; room.startedAt = now(); delete room.finishedAt; delete room.forfeitBy;
    } else if (action === 'rematch-draw') {
      if (!twoPlayerGame(gameKey) || room.state !== 'finished' || !room.game?.draw || !room.players?.[actor.studentId] || room.players[actor.studentId].active === false) {
        operationError = 'Only current players can restart a drawn match.'; return;
      }
      room.game = core.createGameState(gameKey, room.players, { seed: crypto.randomInt(1, 0x7fffffff) });
      core.startGameState(gameKey, room.game, core.participantIds(room.players));
      room.round = (Number(room.round) || 1) + 1; room.state = 'playing'; room.startedAt = now(); delete room.finishedAt;
    } else if (action === 'start') {
      if (actor.studentId !== room.host) { operationError = 'Only the host can start this game.'; return; }
      if (room.state !== 'lobby') { operationError = 'This game has already started.'; return; }
      try { core.startGameState(gameKey, game, core.participantIds(room.players)); }
      catch (error) { operationError = error.message; return; }
      room.state = 'playing'; room.startedAt = now();
    } else if (action === 'countdown-start') {
      if (!room.players?.[actor.studentId] || room.players[actor.studentId].active === false) {
        operationError = 'The shared game countdown is not ready.'; return;
      }
      if (room.state === 'playing') return room;
      if (room.state !== 'countdown') { operationError = 'The shared game countdown is not ready.'; return; }
      if (Number(room.countdownAt) > now()) { operationError = 'The countdown has not finished yet.'; return; }
      room.state = 'playing'; room.startedAt = now();
    } else if (action === 'move') {
      if (room.state !== 'playing') { operationError = 'Wait for the host to start the game.'; return; }
      try { core.applyMove(gameKey, game, actor.studentId, move, room.players); }
      catch (error) { operationError = error.message; return; }
      if (!game.finished && room.computerOpponent === true && game.turn === room.computerId) {
        const botMove = core.computerMove(gameKey, game, room.computerId);
        if (botMove) core.applyMove(gameKey, game, room.computerId, botMove, room.players);
      }
      if (game.finished) { room.state = 'finished'; room.finishedAt = now(); }
    } else if (action === 'settle') {
      if (!room.players?.[actor.studentId] || room.players[actor.studentId].role !== 'student') {
        operationError = 'Only a student who played this game can collect its coins.'; return;
      }
      if (room.state !== 'finished' || !game.finished || !room.finishedAt) {
        operationError = 'This game is not ready for coin settlement.'; return;
      }
      // Returning the finished room lets a client safely retry settlement.
      // The ledger transaction is idempotent by room code.
      return room;
    } else if (action === 'leave') {
      if (!room.players?.[actor.studentId] || room.players[actor.studentId].active === false) {
        if (!room.spectators?.[actor.studentId]) { operationError = 'Join this room before leaving it.'; return; }
        delete room.spectators[actor.studentId]; room.winnerQueue = activeQueue(room);
      } else { room.players[actor.studentId].active = false; room.players[actor.studentId].leftAt = now(); }
      if (matchmaking.shouldAbortCountdown(room)) {
        room.state = 'closed'; room.closedAt = now();
      }
      if (room.host === actor.studentId && room.state !== 'closed') {
        // A host leaving a game in progress hands the room to another player instead of
        // ending it for everyone (the host can still rejoin). A lobby host closes the room.
        const humans = core.participantIds(room.players).filter(id => room.players[id]?.role !== 'computer');
        if (room.state === 'playing' && humans.length) {
          room.host = humans[0]; room.hostName = room.players[humans[0]].name;
          // Bingo numbers are drawn by the first seat, so the new host takes it.
          if (gameKey === 'bingo') game.playersOrder = [humans[0], ...core.participantIds(room.players).filter(id => id !== humans[0])];
        } else {
          room.state = 'closed';
          room.closedAt = now();
        }
      }
    } else if (action === 'claim-forfeit') {
      if (room.state !== 'playing' || !room.players?.[actor.studentId] || room.players[actor.studentId].active === false) {
        operationError = 'Only a player in this game can continue without a classmate.'; return;
      }
      const away = Object.entries(room.players).filter(([, player]) => player && player.active === false && player.role !== 'computer');
      if (!away.length) { operationError = 'Everyone is still in the game.'; return; }
      if (away.some(([, player]) => now() - Number(player.leftAt || 0) < AWAY_GRACE_MS)) {
        operationError = 'Give your classmate a little longer to come back.'; return;
      }
      if (core.participantIds(room.players).length === 1) {
        // Everyone else left: the student who stayed wins. Players who left earn nothing.
        game.finished = true; game.winner = actor.studentId; game.draw = false;
        room.forfeitBy = away.map(([id]) => id).slice(0, 8);
      } else if (!core.skipAbsentPlayers(gameKey, game, room.players)) {
        operationError = 'The game can continue — it is not an absent classmate’s turn.'; return;
      }
      if (game.finished) { room.state = 'finished'; room.finishedAt = now(); }
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
  if (action === 'invite-target' && previousRoom?.host === actor.studentId) {
    const target = room.invitedStudentId || '';
    if (previousRoom.invitedStudentId && previousRoom.invitedStudentId !== target) {
      await updateInviteQueue(db, actor, gameKey, roomCode, '');
    }
    if (target) await updateInviteQueue(db, actor, gameKey, roomCode, target);
  }
  if (action === 'join' && previousRoom?.invitedStudentId === actor.studentId) {
    await updateInviteQueue(db, actor, gameKey, roomCode, '');
  }
  let coins = null;
  if (room.state === 'finished' && (previousRoom?.state !== 'finished' || action === 'settle')) {
    // Publish completion first so every client can retry the idempotent
    // settlement if the separate coin-ledger transaction temporarily fails.
    coins = coinSummary(await persistCompletionAwards(db, actor, gameKey, roomCode, room), room, actor.studentId);
  }
  return { roomCode, public: roomPublic(gameKey, room, room.game, now()), private: core.privateView(gameKey, room.game, actor.studentId),
    ...(coins ? { coins } : {}) };
}

exports.multiplayerGameAction = onCall(OPTIONS, async request => {
  const db = admin.database();
  const data = request.data || {};
  try {
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 2048) {
      throw new HttpsError('invalid-argument', 'That game action is too large.');
    }
    const actor = await authorizeActor(request, db, String(data.workspaceId || ''), String(data.classId || request.auth?.token?.b3ClassId || ''));
    if (data.action === 'identity') {
      return { workspaceId: actor.workspaceId, classId: actor.classId, participantId: actor.participantId,
        participantName: actor.name, role: actor.actorRole, className: actor.className };
    }
    if (!['leave', 'cleanup', 'list-rooms'].includes(data.action) && !allowsMultiplayer({
      actorRole: actor.actorRole, classId: actor.classId, studentId: actor.studentId,
      settings: actor.lockSettings, classRow: actor.classRow,
    })) {
      throw new HttpsError('permission-denied', 'Multiplayer Arcade is locked for your class. Ask your teacher to unlock it.');
    }
    if (data.action === 'cleanup') return await cleanupStaleRooms(db, actor);
    if (data.action === 'list-rooms') return await listPublicRooms(db, actor);
    if (data.action === 'quick-play') return await quickPlay(db, actor, String(data.gameKey || ''));
    if (data.action === 'cancel-quick-play') return await cancelQuickPlay(db, actor, String(data.gameKey || ''));
    if (data.action === 'leaderboard') return await gameLeaderboard(db, actor);
    if (data.action === 'get-coin-policy') return await getGameCoinPolicy(db, actor);
    if (data.action === 'set-coin-policy') return await setGameCoinPolicy(db, actor, data.policy);
    if (data.action === 'classmates') {
      const members = (await db.ref(`b3Games/workspaces/${actor.workspaceId}/classes/${actor.classId}/members`).get()).val() || {};
      return { classmates: Object.entries(members)
        .filter(([id, member]) => id !== actor.studentId && SAFE_ID.test(id) && member?.active !== false && member?.toolAccess?.['multiplayer-center'] !== false)
        .slice(0, 80).map(([studentId, member]) => ({ studentId, name: safeName(member.name) }))
        .sort((a, b) => a.name.localeCompare(b.name)) };
    }
    if (data.action === 'create') return await newRoom(db, actor, String(data.gameKey || ''), { computerOpponent: data.computerOpponent === true });
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
      if (!SAFE_ID.test(target) || target === actor.studentId) throw new HttpsError('invalid-argument', 'Choose a different classmate.');
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

exports._test = { authorizeActor, mutateRoom, newRoom, paths, reserveMatchmakingRoom, publishMatchmakingMirror, normalizeGameCoinPolicy, listPublicRooms };
