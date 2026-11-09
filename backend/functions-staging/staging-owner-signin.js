'use strict';
// Issue #710: staging-only "Sign in as staging owner" button. See the core file.
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { STAGING_ORIGIN, stagingOwnerToken } = require('./staging-owner-signin-core.cjs');
if (!admin.apps.length) admin.initializeApp();

exports.stagingOwnerSignIn = onRequest({ region: 'us-central1', cors: [STAGING_ORIGIN], maxInstances: 2 }, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  try {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
    res.json(await stagingOwnerToken(admin.auth(), { projectId, origin: String(req.headers.origin || '') }));
  } catch (error) {
    const known = error && Number.isInteger(error.code);
    if (!known) console.error('stagingOwnerSignIn failed', error);
    res.status(known ? error.code : 500).json({ error: known ? error.message : 'Staging owner sign-in failed.' });
  }
});
