'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { authorize } = require('./davening-session-auth.cjs');
const { act } = require('./chayus-session-service.cjs');

if (!admin.apps.length) admin.initializeApp();

exports.daveningChayus = onRequest({
  region: 'us-central1',
  cors: ['https://funtorahtools.com', 'https://www.funtorahtools.com',
    'https://simchacohen1.github.io', 'https://fun-torah-tools-staging.web.app'],
  maxInstances: 10
}, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (Buffer.byteLength(JSON.stringify(req.body || {})) > 12000) {
    return res.status(413).json({ error: 'Request too large.' });
  }
  const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
  if (!token) return res.status(401).json({ error: 'Sign in to join class Davening.' });
  try {
    const identity = await admin.auth().verifyIdToken(token, true);
    const db = admin.database();
    const get = async path => (await db.ref(path).get()).val();
    const actor = await authorize(get, identity, req.body?.classId);
    const getRoster = async classId => {
      if (actor.role !== 'teacher' || classId !== actor.classId) {
        throw Object.assign(new Error('Teacher access to this class is required.'), { status: 403 });
      }
      const members = await get(`b3Games/workspaces/b3-2026/classes/${classId}/members`) || {};
      const ids = Object.entries(members).filter(([id, row]) =>
        /^[A-Za-z0-9_-]{1,100}$/.test(id) && row?.active !== false).map(([id]) => id).slice(0, 200);
      const profiles = await Promise.all(ids.map(id => get(`b3Games/students/${id}/profile`)));
      return ids.flatMap((id, index) => {
        const profile = profiles[index];
        return profile && profile.active !== false
          ? [{ id, name: String(profile.name || members[id]?.name || 'Student').slice(0, 100) }]
          : [];
      });
    };
    return res.json({ session: await act({ db, actor, body: req.body, getRoster }) });
  } catch (error) {
    if (!error.status) console.error('Davening Chayus request failed', error);
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'Davening is temporarily unavailable.'
    });
  }
});
