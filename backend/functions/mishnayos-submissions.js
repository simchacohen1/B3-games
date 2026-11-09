'use strict';
// Mishnayos Practice: Submit (student) and grading (teacher). Issue #692.
// The rules are in mishnayos-submissions-core.cjs.
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { mishnayosSubmissions } = require('./mishnayos-submissions-core.cjs');
const { authorizePracticeStudent } = require('./student-practice-auth.cjs');
const studentTools = require('./student-tool-policy.js');
const teacherClassScope = require('./teacher-class-scope');
if (!admin.apps.length) admin.initializeApp();

const origins = ['https://simchacohen1.github.io', 'https://funtorahtools.com', 'https://www.funtorahtools.com'];
if ((process.env.GCLOUD_PROJECT || admin.app().options.projectId) === 'fun-torah-tools-staging') origins.push('https://fun-torah-tools-staging.web.app');

exports.mishnayosSubmissions = onRequest({ region: 'us-central1', cors: origins, maxInstances: 10, timeoutSeconds: 120, memory: '512MiB' }, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (Buffer.byteLength(JSON.stringify(req.body || {})) > 20000) return res.status(413).json({ error: 'Request too large.' });
  try {
    const db = admin.database();
    const get = async path => (await db.ref(path).once('value')).val();
    const store = { get, update: updates => db.ref().update(updates), tx: (path, fn) => db.ref(path).transaction(fn) };
    const bucket = admin.storage().bucket();
    const files = {
      exists: async path => (await bucket.file(path).exists())[0],
      copy: (src, dst) => bucket.file(src).copy(bucket.file(dst)),
      remove: path => bucket.file(path).delete({ ignoreNotFound: true })
    };
    const token = String(req.headers.authorization || '');
    if (!token.startsWith('Bearer ')) return res.status(401).json({ error: 'Sign-in required.' });
    const decoded = await admin.auth().verifyIdToken(token.slice(7), true).catch(() => null);
    if (!decoded) return res.status(401).json({ error: 'Your sign-in expired. Please sign in again.' });

    let who;
    if (decoded.b3StudentRole === 'student') {
      const auth = await authorizePracticeStudent({ authorization: token, verifyToken: async () => decoded, get, source: 'mishnayos-submit', studentTools });
      if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });
      who = { role: 'student', studentId: auth.studentId, classId: auth.classId };
    } else {
      who = { role: 'teacher', identity: decoded };
    }
    res.json(await mishnayosSubmissions({ store, files, scopeLib: teacherClassScope, who, body: req.body || {} }));
  } catch (error) {
    const code = Number.isInteger(error.code) && error.code >= 400 && error.code < 600 ? error.code : 500;
    if (code === 500) console.error('mishnayosSubmissions', error);
    res.status(code).json({ error: code === 500 ? 'That did not go through. Please try again.' : error.message });
  }
});
