'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { authorize } = require('./davening-session-auth.cjs');
const { act } = require('./davening-session-service.cjs');

if (!admin.apps.length) admin.initializeApp();

// Both existing Davening players number their 26 recordings in siddur order.
const catalog = Array.from({ length: 26 }, (_, index) => `part-${index + 1}`);

exports.daveningChazzan = onRequest({
  region: 'us-central1',
  cors: ['https://funtorahtools.com', 'https://www.funtorahtools.com',
    'https://simchacohen1.github.io', 'https://fun-torah-tools-staging.web.app'],
  maxInstances: 10
}, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'A JSON request is required.' });
  }
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
  let identity;
  try {
    if (token) identity = await admin.auth().verifyIdToken(token, true);
  } catch {
    return res.status(401).json({ error: 'Sign in again to join Davening.' });
  }
  if (!identity) return res.status(401).json({ error: 'Sign in to join Davening.' });
  try {
    const db = admin.database();
    const get = async path => (await db.ref(path).get()).val();
    const actor = await authorize(get, identity, body.classId);
    return res.json({ session: await act({ db, actor, catalog, body }) });
  } catch (error) {
    if (!error.status) console.error('Davening session request failed', error);
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'Davening is temporarily unavailable.'
    });
  }
});
