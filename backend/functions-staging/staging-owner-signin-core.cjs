'use strict';
// Issue #710: one-click sign-in for the FICTIONAL staging owner only.
//
// This file lives only in backend/functions-staging, which is deployed only to
// the fun-torah-tools-staging project. The production codebase
// (backend/functions) has no copy. As a second lock, it refuses to hand out a
// token unless it is actually running inside the staging project, and it can
// only ever sign in the fictional owner@funtorahtools-staging.test account.
const STAGING_PROJECT = 'fun-torah-tools-staging';
const STAGING_ORIGIN = 'https://fun-torah-tools-staging.web.app';
const STAGING_OWNER_EMAIL = 'owner@funtorahtools-staging.test';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

// auth: { getUserByEmail(email), createCustomToken(uid) } (firebase-admin auth).
// context: { projectId, origin } for the running function and the request.
async function stagingOwnerToken(auth, context) {
  const projectId = context && context.projectId;
  const origin = context && context.origin;
  if (projectId !== STAGING_PROJECT) fail(404, 'Not available.');
  if (origin !== STAGING_ORIGIN) fail(403, 'This sign-in only works from the staging site.');
  let user;
  try { user = await auth.getUserByEmail(STAGING_OWNER_EMAIL); }
  catch (_) { fail(503, 'The staging owner test account has not been set up.'); }
  const claims = (user && user.customClaims) || {};
  // Only the provisioned fictional account (see staging/provision-fictional-accounts.ps1).
  if (!user || !user.uid || user.disabled === true || user.emailVerified !== true ||
      String(user.email || '').toLowerCase() !== STAGING_OWNER_EMAIL ||
      claims.b3StagingAccount !== true || claims.b3StagingRole !== 'owner') {
    fail(503, 'The staging owner test account is not set up correctly.');
  }
  return { customToken: await auth.createCustomToken(user.uid) };
}

module.exports = { STAGING_PROJECT, STAGING_ORIGIN, STAGING_OWNER_EMAIL, stagingOwnerToken };
