'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const enabled = process.env.B3_RUN_RTDB_EMULATOR_TESTS === '1';
const testEmulator = enabled ? test : test.skip;
let env;
let initializeTestEnvironment, assertSucceeds, assertFails, get, ref, set;

test.before(async () => {
  if (!enabled) return;
  ({ initializeTestEnvironment } = require('@firebase/rules-unit-testing'));
  ({ assertSucceeds, assertFails } = require('@firebase/rules-unit-testing'));
  ({ get, ref, set } = require('firebase/database'));
  const rules = fs.readFileSync('firebase-rules.json', 'utf8');
  env = await initializeTestEnvironment({
    projectId: 'demo-b3-mp-teacher',
    database: { host: '127.0.0.1', port: Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT || 19100), rules },
  });
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.database();
    const rows = {
      'b3Games/admins/owner_alpha': { active: true, role: 'admin' },
      'b3Games/workspaces/b3-2026/teachers/owner_alpha': { active: true, role: 'owner' },
      'b3Games/workspaces/b3-2026/classes/alpha': { active: true, teacherIds: { owner_alpha: true }, toolGrants: { 'multiplayer-center': true } },
      'b3Games/workspaces/b3-2026/classes/beta': { active: true, teacherIds: { owner_beta: true }, toolGrants: { 'multiplayer-center': true } },
      'multiplayerCenter/workspaces/b3-2026/classes/alpha/rooms/shorashim-1234': { host: 'teacher_owner_alpha', gameKey: 'shorashim', state: 'lobby', classId: 'alpha' },
      'b3Private/multiplayerGames/workspaces/b3-2026/classes/alpha/rooms/123456/hands/teacher_owner_alpha': { hand: ['private-to-owner'] },
      'b3Private/multiplayerGames/workspaces/b3-2026/classes/alpha/rooms/123456/hands/student_alpha': { hand: ['private-to-student'] },
    };
    for (const [path, value] of Object.entries(rows)) await set(ref(db, path), value);
  });
});

test.after(async () => { if (env) await env.cleanup(); });

testEmulator('owner can play in explicitly assigned Multiplayer Center classes without crossing class or private-hand boundaries', async () => {
  const owner = env.authenticatedContext('owner_alpha', { email: 'owner@example.test' }).database();
  const otherAdmin = env.authenticatedContext('owner_beta', { email: 'other@example.test' }).database();
  const alphaRooms = 'multiplayerCenter/workspaces/b3-2026/classes/alpha/rooms';
  const betaRooms = 'multiplayerCenter/workspaces/b3-2026/classes/beta/rooms';

  await assertSucceeds(get(ref(owner, alphaRooms)));
  await assertSucceeds(set(ref(owner, alphaRooms + '/teacher-room'), { host: 'teacher_owner_alpha', gameKey: 'shorashim', classId: 'alpha', state: 'lobby' }));
  await assertFails(get(ref(owner, betaRooms)));
  await assertFails(set(ref(owner, betaRooms + '/forged-room'), { host: 'teacher_owner_alpha', gameKey: 'shorashim', classId: 'beta', state: 'lobby' }));
  await assertSucceeds(get(ref(owner, 'b3Private/multiplayerGames/workspaces/b3-2026/classes/alpha/rooms/123456/hands/teacher_owner_alpha')));
  await assertFails(get(ref(owner, 'b3Private/multiplayerGames/workspaces/b3-2026/classes/alpha/rooms/123456/hands/student_alpha')));
  await assertFails(get(ref(otherAdmin, alphaRooms)));
});
