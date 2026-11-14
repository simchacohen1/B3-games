'use strict';
// Staging audio storage for Posuk Practice (Issue #694): storage rules, the
// staging bucket, and the staging copy of privateMediaUrl. Staging only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const STAGING_BUCKET = 'fun-torah-tools-staging.firebasestorage.app';

function loadStagingMedia() {
  const mod = { exports: {} };
  let options = null;
  const mockRequire = name => {
    if (name === 'firebase-functions/v2/https') return { onRequest: (opts) => { options = opts; return {}; } };
    if (name === 'firebase-admin') return { apps: [{ options: { projectId: 'fun-torah-tools-staging' } }], initializeApp() {} };
    if (name === './firebase-resource-targets.cjs') return require('../backend/functions-staging/firebase-resource-targets.cjs');
    throw Error('Unexpected dependency in staging media test: ' + name);
  };
  new Function('require', 'module', 'exports', read('backend/functions-staging/private-media-url.js'))(mockRequire, mod, mod.exports);
  return { ...mod.exports, options };
}

function database(rows) {
  return { ref: p => ({ get: async () => {
    let value = rows[p];
    if (value === undefined) {
      const parent = Object.keys(rows).filter(key => p.startsWith(key + '/')).sort((a, b) => b.length - a.length)[0];
      if (parent) value = p.slice(parent.length + 1).split('/').reduce((v, k) => v?.[k], rows[parent]);
    }
    const snap = v => ({ val: () => v ?? null, exists: () => v !== undefined && v !== null, child: key => snap(key.split('/').reduce((row, k) => row?.[k], v)) });
    return snap(value);
  } }) };
}

test('staging storage rules are the hardened rules with the staging owner', () => {
  const hardened = read('storage-rules.hardened.rules');
  assert.equal(read('staging/storage.rules'), hardened.replace('simcha5770@gmail.com', 'owner@funtorahtools-staging.test'));
  assert.doesNotMatch(read('staging/storage.rules'), /simcha5770|b3-games/);
  assert.equal(JSON.parse(read('firebase.staging.json')).storage.rules, 'staging/storage.rules');
});

test('staging functions use the staging bucket only', () => {
  const rewards = read('backend/functions-staging/student-rewards-auto-award.js');
  assert.match(rewards, new RegExp("POSUK_AUDIO_BUCKET='" + STAGING_BUCKET.replace(/\./g, '\\.') + "'"));
  assert.match(rewards, /bucket\(POSUK_AUDIO_BUCKET\)\.file\(path\)\.exists\(\)/);
  const media = read('backend/functions-staging/private-media-url.js');
  assert.match(media, /bucket\(STAGING_BUCKET\)/);
  assert.doesNotMatch(media, /b3-games|simcha5770|funtorahtools\.com/);
  assert.match(read('backend/functions-staging/index.js'), /exports\.privateMediaUrl = require\('\.\/private-media-url'\)\.privateMediaUrl;/);
});

test('staging privateMediaUrl answers only the staging site and its preview addresses', () => {
  const { options } = loadStagingMedia();
  const allowed = origin => options.cors.some(rule => rule instanceof RegExp ? rule.test(origin) : rule === origin);
  assert.equal(allowed('https://fun-torah-tools-staging.web.app'), true);
  assert.equal(allowed('https://fun-torah-tools-staging--pr-696-posuk-brtsp0fx.web.app'), true);
  assert.equal(allowed('https://funtorahtools.com'), false);
  assert.equal(allowed('https://fun-torah-tools-staging--x.web.app.evil.example'), false);
  assert.equal(allowed('https://evil-fun-torah-tools-staging--x.web.app'), false);
});

test('staging recordings: own student, class teacher (Google or approved staging account), staging owner', async () => {
  const { canReadMedia } = loadStagingMedia();
  const rows = {
    'b3Games/workspaces/b3-2026/classes/test_alef': { active: true, members: { stage_a: { active: true } } },
    'b3Games/students/stage_a/profile': { classId: 'test_alef' },
    'b3Games/workspaces/b3-2026/teachers/teacher_one': { active: true, classIds: { test_alef: true } },
    'b3Games/workspaces/b3-2026/teachers/teacher_two': { active: true, classIds: { test_beis: true } }
  };
  const db = database(rows), file = 'posukPractice/stage_a/Vayeira_18_1_combined_abc.webm';
  const student = { uid: 's', b3StudentRole: 'student', b3StudentId: 'stage_a', b3ClassId: 'test_alef' };
  assert.equal(await canReadMedia(db, student, file), true);
  assert.equal(await canReadMedia(db, { ...student, b3StudentId: 'stage_b' }, file), false);

  const stagingTeacher = { uid: 'teacher_one', email: 't1@funtorahtools-staging.test', email_verified: true, b3StagingAccount: true, firebase: { sign_in_provider: 'password' } };
  assert.equal(await canReadMedia(db, stagingTeacher, file), true);
  assert.equal(await canReadMedia(db, { ...stagingTeacher, uid: 'teacher_two' }, file), false, 'a teacher of another class');
  assert.equal(await canReadMedia(db, { ...stagingTeacher, b3StagingAccount: undefined }, file), false, 'a password account that is not an approved staging account');
  assert.equal(await canReadMedia(db, { ...stagingTeacher, firebase: { sign_in_provider: 'google.com' } }, file), true);

  const stagingOwner = { uid: 'o', email: 'owner@funtorahtools-staging.test', email_verified: true, firebase: { sign_in_provider: 'password' } };
  assert.equal(await canReadMedia(db, stagingOwner, file), true);
  assert.equal(await canReadMedia(db, { ...stagingOwner, email_verified: false }, file), false);
  // The production owner address has no special standing on staging.
  assert.equal(await canReadMedia(db, { uid: 'p', email: 'simcha5770@gmail.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } }, file), false);
});
