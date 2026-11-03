'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { STAGING_ORIGIN, STAGING_PREVIEW_ORIGIN, corsForProductionOrigins } = require('../backend/functions-staging/staging-cors.cjs');

test('staging deployment allows the staging site and its preview channels only', () => {
  const previous = process.env.B3_STAGING_DEPLOYMENT;
  process.env.B3_STAGING_DEPLOYMENT = 'true';
  try {
    const allowed = corsForProductionOrigins(['https://funtorahtools.com']);
    assert.deepEqual(allowed, [STAGING_ORIGIN, STAGING_PREVIEW_ORIGIN]);
    assert.ok(STAGING_PREVIEW_ORIGIN.test('https://fun-torah-tools-staging--pr-543-multiplayer-jlvy4jwe.web.app'));
    assert.ok(!STAGING_PREVIEW_ORIGIN.test('https://fun-torah-tools-staging.evil.com'));
    assert.ok(!STAGING_PREVIEW_ORIGIN.test('https://b3-games--preview-abc.web.app'));
    assert.ok(!STAGING_PREVIEW_ORIGIN.test('https://funtorahtools.com'));
  } finally {
    if (previous === undefined) delete process.env.B3_STAGING_DEPLOYMENT; else process.env.B3_STAGING_DEPLOYMENT = previous;
  }
});
