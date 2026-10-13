'use strict';
const assert = require('node:assert/strict');
const Stripe = require('stripe');
const { validClassId, teacherMayManageClass, activeSubscriptionStatus } =
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

const stripe = new Stripe('sk_test_unit_test', { apiVersion: '2026-08-26.dahlia' });
const secret = 'whsec_sandbox_test_secret';
const raw = Buffer.from(JSON.stringify({ id: 'evt_test', livemode: false }));
const header = stripe.webhooks.generateTestHeaderString({ payload: raw, secret });
assert.equal(stripe.webhooks.constructEvent(raw, header, secret).id, 'evt_test');
assert.throws(() => stripe.webhooks.constructEvent(raw, header, 'wrong-secret'));
const stale = stripe.webhooks.generateTestHeaderString({
  payload: raw, secret, timestamp: Math.floor(Date.now() / 1000) - 301
});
assert.throws(() => stripe.webhooks.constructEvent(raw, stale, secret));
console.log('Shorashim class authorization and Stripe SDK webhook tests passed.');
