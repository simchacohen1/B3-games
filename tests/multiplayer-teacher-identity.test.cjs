'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const vm = require('node:vm');

function getAuthorizeActor() {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'firebase-admin') return { apps: [], initializeApp() {} };
    if (request === 'firebase-functions/v2/https') {
      return {
        onCall: (_options, handler) => handler,
        HttpsError: class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return require('../backend/functions/multiplayer-games')._test.authorizeActor; }
  finally { Module._load = originalLoad; }
}

const workspaceId = 'b3-2026';
const ownerUid = 'owner_alpha';
const alphaClass = { name: 'Synthetic Alpha', active: true, teacherIds: { [ownerUid]: true }, toolGrants: { 'multiplayer-center': true } };

function recordsFor(classRow = alphaClass, admin = { active: true, role: 'admin' }) {
  return {
    [`b3Games/workspaces/${workspaceId}/teachers/${ownerUid}`]: { active: true, role: 'owner', displayName: 'Synthetic Owner' },
    [`b3Games/admins/${ownerUid}`]: admin,
    [`b3Games/workspaces/${workspaceId}/classes/alpha`]: classRow,
    [`b3Games/workspaces/${workspaceId}/classes/beta`]: { name: 'Synthetic Beta', active: true, teacherIds: { someone_else: true }, toolGrants: { 'multiplayer-center': true } },
    'b3Games/siteSettings': {},
  };
}

function mockDb(records) {
  return { ref(path) { return { get: async () => ({ val: () => records[path] || null }), once: async () => ({ val: () => records[path] || null }) }; } };
}

test('workspace owner can resolve as a player only in a teacher-assigned, enabled class', async () => {
  const source = fs.readFileSync('multiplayer/identity.js', 'utf8');
  const browser = { URLSearchParams, B3_WORKSPACE_ID: workspaceId };
  vm.runInNewContext(source, { window: browser });
  const user = { uid: ownerUid, displayName: 'Synthetic Owner', getIdTokenResult: async () => ({ claims: {} }) };
  const records = recordsFor();
  const db = mockDb(records);
  const resolved = await browser.B3MultiplayerIdentity.resolve(db, user, 'alpha', '');
  assert.equal(resolved.role, 'teacher');
  assert.equal(resolved.classId, 'alpha');
  assert.equal(resolved.participantId, 'teacher_' + ownerUid);
  await assert.rejects(browser.B3MultiplayerIdentity.resolve(db, user, 'beta', ''), /assigned to the selected class/);
  const disabled = recordsFor({ ...alphaClass, toolGrants: {} });
  await assert.rejects(browser.B3MultiplayerIdentity.resolve(mockDb(disabled), user, 'alpha', ''), /not enabled/);
});

test('owner multiplayer backend authorization requires an active admin and class teacherIds entry', async () => {
  const authorizeActor = getAuthorizeActor();
  const request = { auth: { uid: ownerUid, token: { name: 'Synthetic Owner' } } };
  const actor = await authorizeActor(request, mockDb(recordsFor()), workspaceId, 'alpha');
  assert.equal(actor.actorRole, 'teacher');
  assert.equal(actor.participantId, 'teacher_' + ownerUid);
  assert.equal(actor.classId, 'alpha');
  await assert.rejects(authorizeActor(request, mockDb(recordsFor({ ...alphaClass, teacherIds: {} })), workspaceId, 'alpha'), /not assigned to the selected class/);
  await assert.rejects(authorizeActor(request, mockDb(recordsFor(alphaClass, { active: false })), workspaceId, 'alpha'), /active teacher assignment/);
});
