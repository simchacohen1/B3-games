'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { claimTeacher } = require('../backend/functions/teacher-claim-core.cjs');
const { corsForProductionOrigins, STAGING_ORIGIN } = require('../backend/functions/staging-cors.cjs');

function storeFixture() {
  const data = {
    'b3Games/workspaces/b3-2026/teacherInvites': {
      teacher_alef_funtorahtools_staging_test: {
      active: true,
      email: 'teacher.alef@funtorahtools-staging.test',
      name: 'Test Teacher',
      classIds: { 'TEST-ALEF': true }
      }
    }
  };
  return {
    data,
    get: async path => data[path] ?? null,
    update: async updates => Object.assign(data, updates)
  };
}

test('staging password accounts can claim only invited classes when staging mode is enabled', async () => {
  const original = process.env.B3_STAGING_DEPLOYMENT;
  const identity = {
    uid: 'staging_teacher',
    email: 'teacher.alef@funtorahtools-staging.test',
    email_verified: true,
    b3StagingAccount: true,
    firebase: { sign_in_provider: 'password' }
  };
  try {
    delete process.env.B3_STAGING_DEPLOYMENT;
    await assert.rejects(claimTeacher(storeFixture(), identity), { code: 403 });
    process.env.B3_STAGING_DEPLOYMENT = 'true';
    const store = storeFixture();
    const result = await claimTeacher(store, identity);
    assert.equal(result.authorized, true);
    assert.deepEqual(result.classIds, ['TEST-ALEF']);
    assert.equal(store.data['b3Games/workspaces/b3-2026/teachers/staging_teacher'].classIds['TEST-ALEF'], true);
  } finally {
    if (original === undefined) delete process.env.B3_STAGING_DEPLOYMENT;
    else process.env.B3_STAGING_DEPLOYMENT = original;
  }
});

test('staging functions allow only the staging Hosting origin', () => {
  const original = process.env.B3_STAGING_DEPLOYMENT;
  try {
    process.env.B3_STAGING_DEPLOYMENT = 'true';
    assert.deepEqual(corsForProductionOrigins(['https://production.example']), [STAGING_ORIGIN]);
    process.env.B3_STAGING_DEPLOYMENT = 'false';
    assert.deepEqual(corsForProductionOrigins(['https://production.example']), ['https://production.example']);
  } finally {
    if (original === undefined) delete process.env.B3_STAGING_DEPLOYMENT;
    else process.env.B3_STAGING_DEPLOYMENT = original;
  }
});

