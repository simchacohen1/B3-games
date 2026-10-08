'use strict';
const admin = require('firebase-admin');
const crypto = require('node:crypto');
const { authenticate, reserve, hash } = require('./paid-api-core.cjs');
if (!admin.apps.length) admin.initializeApp();
const ALLOWED_ORIGINS = ['https://simchacohen1.github.io'];
const speechCache = new Map();
const inflight = new Map();
let speechCacheBytes = 0;

function cacheSpeech(key, value) {
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > 1024 * 1024) return;
  while (speechCache.size >= 128 || speechCacheBytes + bytes > 8 * 1024 * 1024) {
    const oldest = speechCache.keys().next().value;
    speechCacheBytes -= speechCache.get(oldest).bytes;
    speechCache.delete(oldest);
  }
  speechCache.set(key, { value, bytes });
  speechCacheBytes += bytes;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}

function paidHandler(name, category, handler) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
    const db = admin.database();
    const store = {
      get: async p => (await db.ref(p).get()).val(),
      tx: (p, fn) => db.ref(p).transaction(fn)
    };
    let cacheRef, lease, captured, originalJson, ownsSpeech = false, speechKey;
    try {
      const isAudio = category === 'grading';
      const size = req.rawBody?.length || Buffer.byteLength(JSON.stringify(req.body || {}));
      if (size > (isAudio ? 5 * 1024 * 1024 : 32000))
        return res.status(413).json({ error: 'Request too large.' });
      // Bound authentication attempts as well as paid calls. Fixed-size records
      // expire logically each minute; hashed addresses contain no raw IP data.
      const now = Date.now(), minute = Math.floor(now / 60000);
      const ipLimit = await store.tx('b3Private/paidApiAuthLimits/' + hash(req.ip || 'unknown'), c => {
        const count = c?.minute === minute ? c.count || 0 : 0;
        return count >= 240 ? undefined : { minute, count: count + 1 };
      });
      if (!ipLimit.committed) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
      const failurePath = 'b3Private/paidApiAuthFailures/' + hash(req.ip || 'unknown');
      const failures = await store.get(failurePath);
      if (failures?.until > now && failures.count >= 20)
        return res.status(429).json({ error: 'Too many unsuccessful sign-in checks. Please try in 10 minutes.' });
      let identity;
      try { identity = await authenticate(store, token => admin.auth().verifyIdToken(token, true), req.headers); }
      catch (error) {
        if (error.code === 401 || error.code === 403) await store.tx(failurePath, c =>
          c?.until > now ? { ...c, count: (c.count || 0) + 1 } : { count: 1, until: now + 600000 });
        throw error;
      }
      if (name === 'generateShorashimArt' && !identity.id.startsWith('teacher:'))
        return res.status(403).json({ error: 'Picture choices are a teacher tool.' });
      const characters = category === 'speech' ? String(req.body?.text || '').trim().length : 0;
      if (category === 'speech' && (!characters || characters > 3000))
        return res.status(400).json({ error: 'Speech text must be between 1 and 3000 characters.' });
      const cacheKey = hash(name + ':v1:' + JSON.stringify(stable(req.body || {})));
      if (category === 'speech' && speechCache.has(cacheKey))
        return res.status(200).json(speechCache.get(cacheKey).value);
      if (category === 'generation') {
        cacheRef = db.ref('b3Private/paidApiCache/' + name + '/' + cacheKey);
        const cached = (await cacheRef.get()).val();
        if (cached?.value) return res.status(200).json(cached.value);
        lease = crypto.randomUUID();
        const lock = await cacheRef.transaction(c => {
          if (c?.value || (c?.lease && c.until > Date.now())) return undefined;
          return { lease, until: Date.now() + 180000 };
        });
        if (!lock.committed) {
          const value = lock.snapshot.val()?.value;
          return value ? res.status(200).json(value) : res.status(409).json({ error: 'This content is already being prepared. Please try again shortly.' });
        }
      }
      if (category === 'speech' && inflight.has(cacheKey))
        return res.status(409).json({ error: 'This audio is already being prepared. Please try again shortly.' });
      if (category === 'speech') { inflight.set(cacheKey, true); ownsSpeech = true; speechKey = cacheKey; }
      await reserve(store, category, identity, characters);
      // Hold JSON until cache writes finish, so a successful response guarantees
      // that another student can reuse the result without another paid request.
      originalJson = res.json;
      res.json = value => { captured = value; return res; };
      await handler(req, res);
      res.json = originalJson;
      if (res.statusCode === 200 && captured) {
        if (cacheRef) await cacheRef.set({ value: captured, generatedAt: Date.now() });
        if (category === 'speech') cacheSpeech(cacheKey, captured);
      }
      if (captured !== undefined) return res.json(captured);
    } catch (error) {
      if (originalJson) res.json = originalJson;
      const code = Number.isInteger(error.code) ? error.code : 503;
      if (code === 503) console.error('Paid API protection failed', name, error.message);
      if (!res.headersSent) return res.status(code).json({ error: code === 503 ? 'Learning service temporarily unavailable. Please try later.' : error.message });
    } finally {
      if (originalJson) res.json = originalJson;
      if (ownsSpeech) inflight.delete(speechKey);
      if (cacheRef && lease) {
        try { await cacheRef.transaction(c => c?.lease === lease ? null : undefined); }
        catch (_) { /* the short lease expires if Firebase is temporarily down */ }
      }
    }
  };
}

module.exports = { paidHandler, ALLOWED_ORIGINS };
