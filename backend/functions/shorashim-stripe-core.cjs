'use strict';

function validClassId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

function teacherMayManageClass({ admin = false, classIds = {} }, classId) {
  return admin === true || classIds?.[classId] === true;
}

function activeSubscriptionStatus(status) {
  return status === 'active' || status === 'trialing';
}

module.exports = { validClassId, teacherMayManageClass, activeSubscriptionStatus };
