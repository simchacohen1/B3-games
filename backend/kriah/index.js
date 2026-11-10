'use strict';
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { createService, PROJECT } = require('./service.cjs');
const changeRecord = require('./transaction.cjs');
const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (project && project !== PROJECT) throw new Error('Kriah Assessment Center production backend requires fun-torah-tools.');
admin.initializeApp({ projectId: PROJECT, databaseURL: 'https://' + PROJECT + '-default-rtdb.firebaseio.com' });
// A separate GCS bucket keeps student audio isolated from other site storage.
// It must be provisioned by the owner before the first deploy.
const db = admin.database(), bucket = admin.storage().bucket(PROJECT + '-kriah-private');
async function privateBucket() {
  const [metadata] = await bucket.getMetadata();
  if (metadata.iamConfiguration?.publicAccessPrevention !== 'enforced' || metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true) throw new Error('Private audio bucket protections are required.');
}
const store = {
  async get(path) { return (await db.ref(path).get()).val(); },
  async set(path, value) { await db.ref(path).set(value); },
  async update(changes) { await db.ref().update(changes); },
  async list(path, { limit, before, prefix }) {
    let query = db.ref(path).orderByKey();
    if (before) query = query.endBefore(before);
    if (prefix) query = query.startAt(prefix).endAt(prefix + '\uf8ff');
    return (await query.limitToLast(limit).get()).val() || {};
  },
  async change(path, fn) {
    return changeRecord(db.ref(path), fn);
  }
};
const audio = {
  async create(path, bytes, type, hash) {
    await privateBucket();
    const file = bucket.file(path);
    try { await file.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: type, metadata: { sha256: hash } } }); }
    catch (error) {
      if (Number(error.code) !== 412) throw error;
      const [meta] = await file.getMetadata();
      if (meta.metadata?.sha256 !== hash) throw Object.assign(new Error('Original recording already exists. Retry the same upload.'), { code: 409 });
    }
  },
  async read(path) { await privateBucket(); return (await bucket.file(path).download())[0].toString('base64'); },
  async remove(path) { await privateBucket(); await bucket.file(path).delete({ ignoreNotFound: true }); }
};
const service = createService({ projectId: PROJECT, store, audio });
const allowedOrigin = origin => origin === 'https://fun-torah-tools.web.app' || origin === 'https://www.funtorah.com' || origin === 'https://funtorah.com';
exports.kriahAssessment = functions.region('us-central1').runWith({ timeoutSeconds: 120, memory: '256MB', maxInstances: 10 }).https.onRequest(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Origin');
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'Origin not allowed.' });
  res.set('Access-Control-Allow-Origin', req.headers.origin);
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  try {
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    if (!token) return res.status(401).json({ error: 'Sign in required.' });
    const identity = await admin.auth().verifyIdToken(token[1], true);
    res.json(await service.handle(identity, req.body));
  } catch (error) {
    const code = [400, 401, 403, 404, 409].includes(error.code) ? error.code : String(error.code || '').startsWith('auth/') ? 401 : 500;
    res.status(code).json({ error: code === 500 ? 'Could not save or load. Your recording stays on this page; retry.' : error.message });
  }
});
