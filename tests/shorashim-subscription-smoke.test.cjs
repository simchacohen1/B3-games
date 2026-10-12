'use strict';
const assert = require('node:assert/strict');

function isSubscriptionActive(status) { return ['active', 'trialing'].includes(status); }
function signatureMatches(expected, actual) {
  return Buffer.from(expected).length === Buffer.from(actual).length &&
    require('node:crypto').timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

assert.equal(isSubscriptionActive('active'), true);
assert.equal(isSubscriptionActive('trialing'), true);
assert.equal(isSubscriptionActive('past_due'), false);
assert.equal(isSubscriptionActive('canceled'), false);
assert.equal(signatureMatches('1234', '1234'), true);
assert.equal(signatureMatches('1234', '1235'), false);
assert.equal(signatureMatches('1234', '123'), false);
console.log('Shorashim subscription helper checks passed.');
