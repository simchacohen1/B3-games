'use strict';

const crypto = require('node:crypto');

function validClassId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

function teacherMayManageClass({ admin = false, classIds = {} }, classId) {
  return admin === true || classIds?.[classId] === true;
}

function activeSubscriptionStatus(status) {
  return status === 'active' || status === 'trialing';
}

function verifySignature(rawBody, header, secret, nowMs = Date.now()) {
  const parts = String(header || '').split(',');
  const timestampPart = parts.find(part => part.startsWith('t='));
  const timestamp = Number(timestampPart?.slice(2));
  const signatures = parts.filter(part => part.startsWith('v1=')).map(part => part.slice(3));
  if (!Buffer.isBuffer(rawBody) || !secret || !Number.isFinite(timestamp) ||
      Math.abs(nowMs / 1000 - timestamp) > 300 || signatures.length === 0) return false;
  const expected = crypto.createHmac('sha256', secret)
    .update(String(timestamp) + '.').update(rawBody).digest();
  return signatures.some(value => {
    if (!/^[a-f0-9]{64}$/i.test(value)) return false;
    const actual = Buffer.from(value, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });
}

module.exports = { validClassId, teacherMayManageClass, activeSubscriptionStatus, verifySignature };
