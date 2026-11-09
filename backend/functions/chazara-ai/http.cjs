'use strict';
/**
 * HTTP adapter for the Chazara AI Practice service (shared by the production
 * function and the staging-only codebase). Handles CORS, size limits, sign-in
 * and multipart parsing, then calls service.cjs.
 */
const { authorizePracticeStudent } = require('../student-practice-auth.cjs');
const studentTools = require('../student-tool-policy.js');
const { createService } = require('./service.cjs');

const MAX_FILES = 6, MAX_FILE_BYTES = 1.5 * 1024 * 1024;

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {}, files = [];
    let failed = false;
    const stop = (status, message) => { if (!failed) { failed = true; reject(Object.assign(new Error(message), { code: status })); } };
    let bb;
    try {
      const Busboy = require('busboy'); // loaded on first upload only
      bb = Busboy({ headers: req.headers, limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES, fields: 10, fieldSize: 200 } });
    } catch (_) { return stop(400, 'Please record again.'); }
    bb.on('field', (name, value, info) => { if (info?.valueTruncated) return stop(400, 'Please record again.'); fields[name] = value; });
    bb.on('filesLimit', () => stop(413, 'Too many recordings.'));
    bb.on('file', (name, stream, info) => {
      const m = /^audio(\d)$/.exec(name);
      const chunks = [];
      stream.on('limit', () => stop(413, 'That recording is too long. Keep each pasuk under one minute.'));
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => { if (m) files[Number(m[1])] = { buffer: Buffer.concat(chunks), mimeType: info?.mimeType || '' }; });
    });
    bb.on('error', () => stop(400, 'Please record again.'));
    bb.on('finish', () => { if (!failed) resolve({ fields, files }); });
    bb.end(req.rawBody);
  });
}

/**
 * @param {object} deps
 * @param {object} deps.admin            firebase-admin app
 * @param {(origin:string)=>boolean} deps.allowedOrigin
 * @param {()=>object} deps.getProviders lazily builds { decode, recognize, judge }
 */
function createHandler({ admin, allowedOrigin, getProviders }) {
  let service = null;
  const store = () => {
    const db = admin.database();
    return {
      get: async p => (await db.ref(p).once('value')).val(),
      set: (p, v) => db.ref(p).set(v),
      update: changes => db.ref().update(changes),
      tx: async (p, fn) => {
        const ref = db.ref(p);
        const snap = await ref.once('value');
        // The first pass can see an empty cached copy; hand it back unchanged so Firebase retries with real data.
        const res = await ref.transaction(cur => (cur === null && snap.val() !== null ? cur : fn(cur)));
        return { committed: res.committed, value: res.snapshot.val() };
      }
    };
  };
  const getService = () => service || (service = createService({ store: store(), providers: getProviders() }));

  return async function handler(req, res) {
    const origin = req.get ? req.get('Origin') : req.headers.origin;
    res.set('Cache-Control', 'no-store');
    res.set('Vary', 'Origin');
    if (origin && allowedOrigin(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Max-Age', '3600');
    } else if (origin) return res.status(403).json({ error: 'Origin not allowed.' });
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
    try {
      const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
      if (!bearer) return res.status(401).json({ error: 'Please sign in again.' });
      let decoded;
      try { decoded = await admin.auth().verifyIdToken(bearer[1], true); }
      catch (_) { return res.status(401).json({ error: 'Please sign in again.' }); }
      const svc = getService();
      const multipart = /multipart\/form-data/i.test(req.headers['content-type'] || '');
      if (multipart) {
        const { fields, files } = await parseMultipart(req);
        if (fields.action !== 'evaluate') return res.status(400).json({ error: 'Unknown action.' });
        const student = await authorizeStudent(admin, req);
        return res.json(await svc.evaluate(student, fields, files));
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (Buffer.byteLength(JSON.stringify(body)) > 40000) return res.status(413).json({ error: 'Request too large.' });
      switch (body.action) {
        case 'studentList': return res.json(await svc.studentList(await authorizeStudent(admin, req)));
        case 'teacherList': return res.json(await svc.teacherList(decoded, body));
        case 'teacherSave': return res.json(await svc.teacherSave(decoded, body));
        case 'teacherArchive': return res.json(await svc.teacherArchive(decoded, body));
        case 'usageReport': return res.json(await svc.usageReport(decoded));
        default: return res.status(400).json({ error: 'Unknown action.' });
      }
    } catch (error) {
      const code = Number.isInteger(error.code) && error.code >= 400 && error.code < 600 ? error.code : 500;
      if (code === 500) console.error('chazaraAiPractice', error && error.message);
      return res.status(code).json({ error: code === 500 ? 'AI Practice could not finish right now. Please try again.' : error.message });
    }
  };
}

async function authorizeStudent(admin, req) {
  const db = admin.database();
  const result = await authorizePracticeStudent({
    authorization: req.headers.authorization,
    verifyToken: t => admin.auth().verifyIdToken(t, true),
    get: async p => (await db.ref(p).get()).val(),
    source: 'chazara',
    studentTools
  });
  if (!result.ok) throw Object.assign(new Error(result.error), { code: result.status || 403 });
  return { studentId: result.studentId, classId: result.classId };
}

module.exports = { createHandler, parseMultipart };
