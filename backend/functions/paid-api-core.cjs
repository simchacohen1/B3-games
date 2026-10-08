'use strict';
const crypto = require('node:crypto');
const { key, equal, readPasscode } = require('./student-passcodes.cjs');
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

// Counts are shared by every function instance. Failed provider calls count too:
// they can still incur charges, and retrying must not bypass these allowances.
const LIMITS = {
  grading: { minute: 120, day: 2000, month: 20000, userDay: 300 },
  generation: { minute: 20, day: 100, month: 1000, userDay: 30 },
  speech: { minute: 120, day: 3000, month: 30000, userDay: 500, characters: 1000000 }
};

async function authenticate(store, verifyToken, headers) {
  const bearer = /^Bearer (.+)$/i.exec(headers.authorization || '');
  if (bearer) {
    let token;
    try { token = await verifyToken(bearer[1]); }
    catch (_) { fail(401, 'Please sign in again.'); }
    if (key(token.b3StudentId)) {
      const profile = await store.get('b3Games/students/' + token.b3StudentId + '/profile');
      if (!profile || profile.active === false) fail(403, 'Your student account is unavailable.');
      return { id: 'student:' + token.b3StudentId };
    }
    if (token.email_verified !== true || token.firebase?.sign_in_provider !== 'google.com')
      fail(403, 'Use your teacher Google account.');
    const [admin, teacher] = await Promise.all([
      store.get('b3Games/admins/' + token.uid),
      store.get('b3Games/workspaces/b3-2026/teachers/' + token.uid)
    ]);
    if (String(token.email).toLowerCase() !== 'simcha5770@gmail.com' &&
        !(admin && admin.active !== false) && !(teacher && teacher.active === true))
      fail(403, 'This account cannot use the learning tools.');
    return { id: 'teacher:' + token.uid };
  }
  const id = headers['x-b3-student-id'], pin = headers['x-b3-student-pin'];
  if (!key(id) || typeof pin !== 'string' || !pin || pin.length > 100)
    fail(401, 'Please sign in from the Fun Torah Tools home page.');
  const [profile, legacy] = await Promise.all([
    store.get('b3Games/students/' + id + '/profile'),
    store.get('posukPractice/allowedStudents/' + id)
  ]);
  if ((!profile && !legacy) || (profile || legacy).active === false)
    fail(403, 'Your student account is unavailable.');
  const code = await readPasscode(store.get, id, { allowLegacyDefault: true });
  if (!equal(code.passcode, pin)) fail(401, 'Your passcode changed. Sign in again.');
  return { id: 'student:' + id };
}

async function reserve(store, category, identity, characters = 0, now = Date.now()) {
  const limits = LIMITS[category];
  if (!limits) throw new Error('Unknown paid API category');
  const day = new Date(now).toISOString().slice(0, 10), month = day.slice(0, 7);
  const minute = Math.floor(now / 60000);
  // One fixed-size counter per category; old dates are replaced, never appended.
  const result = await store.tx('b3Private/paidApiUsage/' + category, current => {
    const c = current || {};
    const users = c.day === day ? { ...(c.users || {}) } : {};
    const actor = hash(identity.id);
    const minuteCount = c.minute === minute ? c.minuteCount || 0 : 0;
    const dayCount = c.day === day ? c.dayCount || 0 : 0;
    const monthCount = c.month === month ? c.monthCount || 0 : 0;
    const monthChars = c.month === month ? c.monthChars || 0 : 0;
    if (minuteCount >= limits.minute || dayCount >= limits.day ||
        monthCount >= limits.month || (users[actor] || 0) >= limits.userDay ||
        (limits.characters && monthChars + characters > limits.characters)) return undefined;
    users[actor] = (users[actor] || 0) + 1;
    return { minute, day, month, minuteCount: minuteCount + 1,
      dayCount: dayCount + 1, monthCount: monthCount + 1,
      monthChars: monthChars + characters, users };
  });
  if (!result.committed) fail(429, 'The learning service has reached its usage allowance. Please try later or ask your teacher.');
}

module.exports = { authenticate, reserve, LIMITS, hash };
