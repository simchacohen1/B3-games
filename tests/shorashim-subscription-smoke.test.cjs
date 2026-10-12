'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validClassId, teacherMayManageClass, activeSubscriptionStatus, verifySignature } =
  require('../backend/functions/shorashim-stripe-core.cjs');

assert.equal(validClassId('class_9'), true);
assert.equal(validClassId('../admin'), false);
assert.equal(teacherMayManageClass({ classIds: { et: true } }, 'et'), true);
assert.equal(teacherMayManageClass({ classIds: { et: true } }, 'wt'), false);
assert.equal(teacherMayManageClass({ admin: true }, 'wt'), true);
assert.equal(activeSubscriptionStatus('active'), true);
assert.equal(activeSubscriptionStatus('trialing'), true);
assert.equal(activeSubscriptionStatus('past_due'), false);
assert.equal(activeSubscriptionStatus('canceled'), false);

const secret = 'whsec_sandbox_test_secret';
const raw = Buffer.from(JSON.stringify({ id: 'evt_test', livemode: false }));
const timestamp = Math.floor(Date.now() / 1000);
const digest = crypto.createHmac('sha256', secret).update(String(timestamp) + '.').update(raw).digest('hex');
const header = 't=' + timestamp + ',v1=' + digest;
assert.equal(verifySignature(raw, header, secret), true);
assert.equal(verifySignature(raw, 't=' + timestamp + ',v1=' + '0'.repeat(64), secret), false);
assert.equal(verifySignature(raw, header, secret, (timestamp - 301) * 1000), false);
assert.equal(verifySignature(Buffer.from('{}'), header, 'different-secret'), false);
console.log('Shorashim subscription authorization and webhook-signature tests passed.');
