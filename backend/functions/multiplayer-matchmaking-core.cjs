'use strict';

// Pure rules for the student quick-play queue and class-scoped game coins.
// Database adapters must store these under the authenticated workspace/class.
const QUEUE_TTL_MS = 90_000;

function queueKey(workspaceId, classId, gameKey) {
  if (![workspaceId, classId, gameKey].every(value => /^[a-z0-9-]{1,80}$/i.test(String(value || '')))) throw new Error('Invalid matchmaking scope.');
  return `${workspaceId}:${classId}:${gameKey}`;
}

function availableEntries(entries, now, excludeId) {
  return Object.entries(entries || {}).filter(([id, entry]) => id !== excludeId && entry && entry.status === 'waiting' && entry.inviteLocked !== true && Number(entry.createdAt) <= now && now - Number(entry.createdAt) <= QUEUE_TTL_MS)
    .sort((a, b) => Number(a[1].createdAt) - Number(b[1].createdAt) || a[0].localeCompare(b[0]));
}

function enqueue(entries, studentId, now, roomCode) {
  const next = { ...(entries || {}) };
  const current = next[studentId];
  if (current?.inviteLocked === true) return { entries: next, status: 'invite-locked', inviteId: current.inviteId };
  if (current?.status === 'matched' && current.roomCode) return { entries: next, status: 'matched', roomCode: current.roomCode };
  if (current?.status === 'matched' && current.matchedWith) return { entries: next, status: 'matched', matchedWith: current.matchedWith };
  const candidate = availableEntries(next, now, studentId).find(([id]) => id !== studentId);
  if (candidate) {
    const [otherId, other] = candidate;
    const assignedRoom = roomCode || other.roomCode || '';
    next[otherId] = { ...other, status: 'matched', matchedAt: now, matchedWith: studentId, roomCode: assignedRoom };
    next[studentId] = { status: 'matched', createdAt: now, matchedAt: now, matchedWith: otherId, roomCode: assignedRoom };
    return { entries: next, status: 'matched', matchedWith: otherId, roomCode: assignedRoom };
  }
  next[studentId] = { status: 'waiting', createdAt: current?.createdAt || now };
  return { entries: next, status: 'waiting' };
}

function reserveForInvite(entries, studentIds, now, inviteId) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(inviteId || ''))) throw new Error('Invalid invitation reservation.');
  const next = { ...(entries || {}) };
  for (const studentId of new Set(studentIds || [])) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(studentId || ''))) throw new Error('Invalid student for invitation reservation.');
    const current = next[studentId];
    if (current?.status === 'matched' || current?.status === 'playing') continue;
    next[studentId] = { ...(current || {}), status: 'waiting', createdAt: Number(current?.createdAt) || now, inviteLocked: true, inviteId, inviteAt: now };
  }
  return next;
}

function releaseInvite(entries, inviteId, now) {
  const next = { ...(entries || {}) };
  for (const [studentId, entry] of Object.entries(next)) {
    if (!entry || entry.inviteId !== inviteId || entry.inviteLocked !== true) continue;
    next[studentId] = { status: 'waiting', createdAt: now };
  }
  return next;
}

function cancelQueue(entries, studentId, now) {
  const next = { ...(entries || {}) };
  const current = next[studentId];
  if (!current) return { entries: next, status: 'absent' };
  if (current.inviteLocked === true) return { entries: next, status: 'invite-locked', inviteId: current.inviteId };
  if (current.roomCode) return { entries: next, status: 'room-assigned', roomCode: current.roomCode };
  if (current.matchedWith) {
    const partner = next[current.matchedWith];
    if (partner?.matchedWith === studentId && !partner.roomCode) next[current.matchedWith] = { status: 'waiting', createdAt: now };
  }
  delete next[studentId];
  return { entries: next, status: 'cancelled' };
}

function shouldAbortCountdown(room) {
  if (room?.state !== 'countdown') return false;
  return Object.values(room.players || {}).filter(player => player && player.active !== false && player.role !== 'computer').length < 2;
}

function awardGameCoins(ledger, roomId, results, policy) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(roomId || ''))) throw new Error('Invalid completed game.');
  if (!policy || !Number.isSafeInteger(policy.win) || !Number.isSafeInteger(policy.finish) || !Number.isSafeInteger(policy.sportsmanship) ||
      !Number.isFinite(policy.computerMultiplier) || policy.computerMultiplier < 0 || policy.computerMultiplier >= 1 ||
      policy.win < 0 || policy.finish < 0 || policy.sportsmanship < 0) {
    throw new Error('Game coin rewards are not configured.');
  }
  const next = structuredClone(ledger || { balances: {}, awards: {} });
  next.balances ||= {}; next.awards ||= {};
  if (next.awards[roomId]) return { ledger: next, awarded: false, existing: next.awards[roomId] };
  const awards = {};
  const paidStudents = new Set();
  for (const result of results || []) {
    if (!result || !/^[A-Za-z0-9_-]{1,64}$/.test(String(result.studentId || '')) || result.abandoned) continue;
    if (paidStudents.has(result.studentId)) continue;
    paidStudents.add(result.studentId);
    const outcome = result.outcome;
    if (!['win', 'loss', 'draw'].includes(outcome)) continue;
    const base = (outcome === 'win' ? policy.win : policy.finish) + (result.sportsmanship ? policy.sportsmanship : 0);
    const rawAmount = result.computerOpponent ? base * policy.computerMultiplier : base;
    if (!Number.isFinite(rawAmount) || rawAmount < 0 || !Number.isSafeInteger(Math.floor(rawAmount))) continue;
    const amount = Math.max(0, Math.floor(rawAmount));
    if (!amount) continue;
    if (result.studentId.startsWith('computer_') || result.studentId.startsWith('bot_')) continue;
    const row = next.balances[result.studentId] ||= { coins: 0, computerCoins: 0, name: String(result.name || 'Student') };
    // Keep the human and computer-opponent totals explicit for clients and
    // older ledger readers, even when this game only awards one category.
    row.coins = Number.isSafeInteger(row.coins) && row.coins >= 0 ? row.coins : 0;
    row.computerCoins = Number.isSafeInteger(row.computerCoins) && row.computerCoins >= 0 ? row.computerCoins : 0;
    if (result.name) row.name = String(result.name).slice(0, 32);
    const balanceField = result.computerOpponent ? 'computerCoins' : 'coins';
    const previousBalance = Number.isSafeInteger(row[balanceField]) && row[balanceField] > 0 ? row[balanceField] : 0;
    if (previousBalance > Number.MAX_SAFE_INTEGER - amount) throw new Error('Game coin balance limit exceeded.');
    row[balanceField] = previousBalance + amount;
    awards[result.studentId] = amount;
  }
  next.awards[roomId] = awards;
  return { ledger: next, awarded: true, existing: awards };
}

function completionResults(room) {
  if (!room || room.state !== 'finished' || !room.game?.finished) return [];
  return Object.entries(room.players || {}).filter(([, player]) => player && player.active !== false && player.role === 'student')
    .map(([studentId, player]) => ({
      studentId, name: String(player.name || 'Student').slice(0, 32),
      outcome: room.game.draw ? 'draw' : room.game.winner === studentId ? 'win' : 'loss',
      abandoned: false, computerOpponent: room.computerOpponent === true,
    }));
}

function leaderboard(rows, limit = 10) {
  return Object.entries(rows || {}).filter(([studentId, row]) => row && row.computer !== true && !studentId.startsWith('computer_') && !studentId.startsWith('bot_'))
    .map(([studentId, row]) => ({ studentId, name: String(row.name || 'Student').slice(0, 32), coins: Math.max(0, Number(row.coins) || 0) }))
    .sort((a, b) => b.coins - a.coins || a.name.localeCompare(b.name) || a.studentId.localeCompare(b.studentId))
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
}

module.exports = { QUEUE_TTL_MS, queueKey, availableEntries, enqueue, reserveForInvite, releaseInvite, cancelQueue, shouldAbortCountdown, awardGameCoins, completionResults, leaderboard };
