'use strict';
// Wrong-passcode limiter for the Homework and Messaging endpoints (they are reachable
// without sign-in, so passcodes must not be guessable by trying them all).
// - Per student name/id: 8 failures in 15 minutes => that account is paused for 15 minutes.
// - Per caller address:  40 failures in 1 hour    => that address is paused for 1 hour.
// A correct passcode clears the student's count. Lock-outs are brief on purpose so a
// prankster cannot keep a child out of class. Counters live in b3Private (no browser access).
const crypto = require('node:crypto');
const LIMITS = { studentFails: 8, studentWindow: 15 * 60000, ipFails: 40, ipWindow: 3600000 };
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 32);
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 80);
const tooMany = () => Object.assign(new Error('Too many wrong passcodes. Please wait a few minutes and try again.'), { code: 429 });
const root = 'b3Private/authAttempts/';

async function blocked(store, path, now) {
  const row = await store.get(path);
  return !!(row && row.until && row.until > now);
}
async function bump(store, path, now, max, windowMs) {
  await store.tx(path, cur => {
    const r = cur && now - cur.start < windowMs ? cur : { start: now, count: 0 };
    const count = r.count + 1;
    return { start: r.start, count, until: count >= max ? now + windowMs : 0 };
  });
}

// run(): the real passcode check. Throws a 401 (or anything else) on failure.
async function guarded(store, { ip, studentKey }, now, run) {
  const sPath = root + 's_' + sha(norm(studentKey));
  const iPath = ip ? root + 'i_' + sha(ip) : null;
  if (await blocked(store, sPath, now) || (iPath && await blocked(store, iPath, now))) throw tooMany();
  try {
    const result = await run();
    await store.set(sPath, null);
    return result;
  } catch (e) {
    if (e && (e.code === 401 || e.code === 409)) {
      await bump(store, sPath, now, LIMITS.studentFails, LIMITS.studentWindow);
      if (iPath) await bump(store, iPath, now, LIMITS.ipFails, LIMITS.ipWindow);
    }
    throw e;
  }
}
module.exports = { guarded, LIMITS };
