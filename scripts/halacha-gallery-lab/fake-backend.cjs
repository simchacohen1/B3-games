'use strict';
// In-memory, synthetic-only stand-in for the Firebase services used by the
// Halacha -> Class Gallery flow. It runs the REAL Cloud Function handlers from
// backend/functions with a fake firebase-admin, and (optionally) evaluates
// client reads/writes against a Realtime Database rules file with targaryen.
// Nothing here talks to the network or to the production project.
const path = require('node:path');
const Module = require('node:module');

const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const parts = p => String(p || '').split('/').filter(Boolean);

function createStore(seed) {
  let data = clone(seed) || {};
  const get = p => { let n = data; for (const k of parts(p)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : clone(n); };
  const prune = (obj) => { if (!obj || typeof obj !== 'object') return obj; for (const k of Object.keys(obj)) { obj[k] = prune(obj[k]); if (obj[k] === null || obj[k] === undefined || (typeof obj[k] === 'object' && !Object.keys(obj[k]).length)) delete obj[k]; } return obj; };
  const set = (p, v) => {
    const ks = parts(p);
    if (!ks.length) { data = clone(v) || {}; return; }
    let n = data;
    for (const k of ks.slice(0, -1)) { if (!n[k] || typeof n[k] !== 'object') n[k] = {}; n = n[k]; }
    if (v === null || v === undefined) delete n[ks.at(-1)]; else n[ks.at(-1)] = clone(v);
    prune(data);
  };
  const update = (p, patch) => { for (const [k, v] of Object.entries(patch || {})) set(parts(p).concat(parts(k)).join('/'), v); };
  return { get, set, update, snapshot: () => clone(data) };
}

let pushCounter = 0;
const pushKey = () => '-Syn' + Date.now().toString(36) + (pushCounter++).toString(36).padStart(4, '0');

// Fake tokens are plain base64 JSON. They are ONLY understood by this lab.
const makeToken = claims => 'fake.' + Buffer.from(JSON.stringify(claims)).toString('base64url');
const readToken = token => {
  const m = /^fake\.([A-Za-z0-9_-]+)$/.exec(String(token || ''));
  if (!m) throw Object.assign(new Error('Invalid token'), { code: 401 });
  return JSON.parse(Buffer.from(m[1], 'base64url').toString());
};

function fakeAdmin(store, files) {
  const ref = p => {
    const node = {
      key: parts(p).at(-1) || null,
      child: c => ref(parts(p).concat(parts(c)).join('/')),
      once: async () => ({ val: () => store.get(p), exists: () => store.get(p) !== null }),
      get: async () => { const v = store.get(p); return { val: () => v, exists: () => v !== null, child: c => ({ val: () => { let n = v; for (const k of parts(c)) n = n == null ? null : n[k]; return n === undefined ? null : n; }, exists() { return this.val() !== null; } }) }; },
      set: async v => store.set(p, v),
      update: async v => store.update(p, v),
      remove: async () => store.set(p, null),
      push: () => ref(parts(p).concat(pushKey()).join('/')),
      transaction: async fn => { const next = fn(store.get(p)); if (next === undefined) return { committed: false, snapshot: { val: () => store.get(p) } }; store.set(p, next); return { committed: true, snapshot: { val: () => store.get(p) } }; }
    };
    return node;
  };
  return {
    apps: [{}], initializeApp() {},
    database: () => ({ ref }),
    storage: () => ({ bucket: name => ({ name, file: fp => ({
      save: async (bytes, opts) => { files.set(fp, { bytes: Buffer.from(bytes), opts }); },
      delete: async () => { files.delete(fp); }
    }) }) }),
    auth: () => ({
      createCustomToken: async (uid, claims) => makeToken({ uid, ...claims }),
      verifyIdToken: async token => { const c = readToken(token); return { ...c, firebase: { sign_in_provider: c.provider || 'custom' } }; }
    })
  };
}

// Load a real function module with firebase-admin / firebase-functions swapped out.
function loadFunction(file, exportName, admin) {
  const full = path.resolve(file);
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'firebase-admin') return admin;
    if (request === 'firebase-functions/v2/https') return { onRequest: (opts, handler) => Object.assign(handler, { __opts: opts }) };
    return originalLoad.apply(this, arguments);
  };
  try {
    delete require.cache[full];
    return require(full)[exportName];
  } finally { Module._load = originalLoad; }
}

// Minimal express-like req/res for the onRequest handlers.
async function invoke(handler, { method = 'POST', body = {}, headers = {}, query = {}, ip = '127.0.0.1' } = {}) {
  let status = 200, payload, resHeaders = {};
  const res = {
    set(k, v) { resHeaders[k] = v; return res; },
    status(n) { status = n; return res; },
    json(v) { payload = v; return res; },
    send(v) { payload = v; return res; }
  };
  await handler({ method, body, headers, query, ip }, res);
  return { status, body: payload, headers: resHeaders };
}

function createBackend({ seed, repoRoot, rulesFile, targaryen }) {
  const store = createStore(seed);
  const files = new Map();
  const admin = fakeAdmin(store, files);
  const fnDir = path.join(repoRoot, 'backend/functions');
  const handlers = {
    classGallerySubmit: loadFunction(path.join(fnDir, 'class-gallery-submit.js'), 'classGallerySubmit', admin),
    classGalleryRead: loadFunction(path.join(fnDir, 'class-gallery-read.js'), 'classGalleryRead', admin),
    funTorahStudentAuth: loadFunction(path.join(fnDir, 'student-auth.js'), 'funTorahStudentAuth', admin)
  };
  const rules = rulesFile ? require(path.resolve(rulesFile)) : null;
  // Evaluate a client operation exactly as the RTDB rules would (targaryen).
  function client(op, p, value, token) {
    const now = Date.now();
    const sv = v => v && typeof v === 'object' ? (v['.sv'] === 'timestamp' ? now : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sv(x)]))) : v;
    value = sv(value);
    const auth = token ? (() => { const c = readToken(token); return { uid: c.uid, provider: c.provider || 'custom', token: c }; })() : null;
    if (rules && targaryen) {
      const db = targaryen.database(rules, store.snapshot()).with({ debug: false });
      const actor = db.as(auth);
      const result = op === 'read' ? actor.read('/' + parts(p).join('/'))
        : op === 'update' ? actor.update('/' + parts(p).join('/'), value || {})
        : actor.write('/' + parts(p).join('/'), value === undefined ? null : value);
      if (!result.allowed) return { ok: false, error: 'PERMISSION_DENIED' };
    }
    if (op === 'read') return { ok: true, value: store.get(p) };
    if (op === 'update') store.update(p, value); else store.set(p, value);
    return { ok: true };
  }
  return { store, files, admin, handlers, client, invoke, makeToken, readToken };
}

module.exports = { createBackend, createStore, makeToken, readToken, invoke, loadFunction, fakeAdmin };
