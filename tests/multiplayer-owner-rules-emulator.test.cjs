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
      'b3Games/workspaces/b3-2026/teachers/teacher_alpha': { active: true, role: 'teacher', classIds: { alpha: true } },
      'b3Games/workspaces/b3-2026/teachers/teacher_beta': { active: true, role: 'teacher', classIds: { beta: true } },
      'b3Games/workspaces/b3-2026/teachers/teacher_inactive': { active: false, role: 'teacher', classIds: { alpha: true } },
      'b3Games/workspaces/b3-2026/teachers/teacher_et': { active: true, role: 'teacher', classIds: { et: true } },
      'b3Games/workspaces/b3-2026/classes/et': { active: true, teacherIds: { teacher_et: true }, members: { student_et: { active: true } } },
      'b3Games/siteSettings': { games: { 'multiplayer-center': true }, classGames: { et: { 'multiplayer-center': true } } },
      'b3Games/workspaces/b3-2026/classes/alpha': { active: true, teacherIds: { owner_alpha: true, teacher_alpha: true, teacher_inactive: true }, toolGrants: { 'multiplayer-center': true }, members: { student_alpha: { active: true, toolAccess: { 'multiplayer-center': true } }, student_disabled: { active: true, toolAccess: { 'multiplayer-center': false } } } },
      'b3Games/workspaces/b3-2026/classes/beta': { active: true, teacherIds: { owner_beta: true, teacher_beta: true }, toolGrants: { 'multiplayer-center': true }, members: { student_beta: { active: true } } },
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


testEmulator('lobby listener permits only a signed-in active student in the correct class with the activity enabled', async () => {
  const base = 'multiplayerCenter/workspaces/b3-2026/classes/';
  const alpha = env.authenticatedContext('auth_alpha', { b3StudentRole: 'student', b3StudentId: 'student_alpha', b3ClassId: 'alpha' }).database();
  const beta = env.authenticatedContext('auth_beta', { b3StudentRole: 'student', b3StudentId: 'student_beta', b3ClassId: 'beta' }).database();
  const disabled = env.authenticatedContext('auth_disabled', { b3StudentRole: 'student', b3StudentId: 'student_disabled', b3ClassId: 'alpha' }).database();
  const forged = env.authenticatedContext('auth_forged', { b3StudentRole: 'student', b3StudentId: 'student_alpha', b3ClassId: 'beta' }).database();
  const visitor = env.unauthenticatedContext().database();
  await assertSucceeds(get(ref(alpha, base + 'alpha/rooms')));
  await assertSucceeds(get(ref(beta, base + 'beta/rooms')));
  await assertFails(get(ref(alpha, base + 'beta/rooms')));
  await assertFails(get(ref(beta, base + 'alpha/rooms')));
  await assertFails(get(ref(disabled, base + 'alpha/rooms')));
  await assertFails(get(ref(forged, base + 'alpha/rooms')));
  await assertFails(get(ref(visitor, base + 'alpha/rooms')));
});

testEmulator('teacher lobby listener requires both active assignment and class teacherIds', async () => {
  const base = 'multiplayerCenter/workspaces/b3-2026/classes/';
  const alpha = env.authenticatedContext('teacher_alpha', { email: 'alpha@example.test' }).database();
  const beta = env.authenticatedContext('teacher_beta', { email: 'beta@example.test' }).database();
  const inactive = env.authenticatedContext('teacher_inactive', { email: 'inactive@example.test' }).database();
  await assertSucceeds(get(ref(alpha, base + 'alpha/rooms')));
  await assertSucceeds(get(ref(beta, base + 'beta/rooms')));
  await assertFails(get(ref(alpha, base + 'beta/rooms')));
  await assertFails(get(ref(beta, base + 'alpha/rooms')));
  await assertFails(get(ref(inactive, base + 'alpha/rooms')));
});

testEmulator('legacy ET lobby listener works with enabled class switch, then denies when disabled', async () => {
  const path = 'multiplayerCenter/workspaces/b3-2026/classes/et/rooms';
  const student = env.authenticatedContext('auth_et', { b3StudentRole: 'student', b3StudentId: 'student_et', b3ClassId: 'et' }).database();
  const teacher = env.authenticatedContext('teacher_et', { email: 'et@example.test' }).database();
  await assertSucceeds(get(ref(student, path)));
  await assertSucceeds(get(ref(teacher, path)));
  await env.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), 'b3Games/siteSettings/classGames/et/multiplayer-center'), false);
  });
  await assertFails(get(ref(student, path)));
  await assertFails(get(ref(teacher, path)));
});

testEmulator('removing class membership or teacher assignment revokes waiting-room reads', async () => {
  const path = 'multiplayerCenter/workspaces/b3-2026/classes/alpha/rooms';
  const student = env.authenticatedContext('auth_alpha', { b3StudentRole: 'student', b3StudentId: 'student_alpha', b3ClassId: 'alpha' }).database();
  const teacher = env.authenticatedContext('teacher_alpha', { email: 'alpha@example.test' }).database();
  await assertSucceeds(get(ref(student, path)));
  await assertSucceeds(get(ref(teacher, path)));
  await env.withSecurityRulesDisabled(async context => {
    const db = context.database();
    await set(ref(db, 'b3Games/workspaces/b3-2026/classes/alpha/members/student_alpha/active'), false);
    await set(ref(db, 'b3Games/workspaces/b3-2026/teachers/teacher_alpha/classIds/alpha'), false);
  });
  await assertFails(get(ref(student, path)));
  await assertFails(get(ref(teacher, path)));
});
