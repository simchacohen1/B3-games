'use strict';
// A boy in two classes picks one on the main site. The Posuk and Mishnayos pages sign him in again when they open; that
// request must name the picked class, or the server starts him in his first class and issues a token for the WRONG class
// (every read of the class he is actually in is then refused).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadCheckAccess(file, session) {
  const html = fs.readFileSync(`${__dirname}/../${file}`, 'utf8').split('\r\n').join('\n');
  const start = html.indexOf('async function checkAccess(');
  const end = html.indexOf('\n}\n', start) + 3;
  assert.ok(start > 0 && end > start, file + ': checkAccess not found');
  const calls = [];
  const respond = classId => ({ ok: true, id: 'kid', customToken: 'token-for-' + (classId || 'DEFAULT') });
  const context = {
    STUDENT_AUTH_URL: 'https://example.test/auth', calls, JSON, Promise, String, Number,
    AbortSignal: { timeout: () => undefined },
    sessionStorage: { getItem: key => (key in session ? session[key] : null) },
    window: { firebase: { auth: () => ({}) } },
    firebase: { auth: Object.assign(() => ({ setPersistence: async () => {}, signInWithCustomToken: async token => { calls.push({ signedInWith: token }); } }), { Auth: { Persistence: { SESSION: 'session' } } }) },
    studentRecord: async () => ({ active: true }),
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ body });
      if (context.rejectClass && body.classId === context.rejectClass) return { ok: false, status: 403, json: async () => ({ error: 'This student is not active in the selected class.' }) };
      return { ok: true, status: 200, json: async () => respond(body.classId) };
    }
  };
  vm.runInNewContext(html.slice(start, end) + '\nthis.checkAccess = checkAccess;', context);
  return { checkAccess: context.checkAccess, calls, context };
}

for (const file of ['record_pesukim/student.html', 'record-mishnayos/student.html']) {
  test(`${file}: the re-sign-in names the class the boy picked`, async () => {
    const { checkAccess, calls } = loadCheckAccess(file, { b3Games_studentId: 'kid', b3Games_studentClass: 'TEST-ALEF' });
    const result = await checkAccess('Kid', '1234', 'kid');
    assert.equal(result.ok, true);
    assert.equal(calls[0].body.classId, 'TEST-ALEF');
    assert.deepEqual(calls.find(c => c.signedInWith), { signedInWith: 'token-for-TEST-ALEF' });
  });

  test(`${file}: another boy's leftover class is never used, and a class he can no longer use falls back`, async () => {
    const other = loadCheckAccess(file, { b3Games_studentId: 'someone-else', b3Games_studentClass: 'TEST-ALEF' });
    await other.checkAccess('Kid', '1234', 'kid');
    assert.equal('classId' in other.calls[0].body, false, 'a different boy\'s class is not sent');
    const closed = loadCheckAccess(file, { b3Games_studentId: 'kid', b3Games_studentClass: 'OLD-CLASS' });
    closed.context.rejectClass = 'OLD-CLASS';
    const result = await closed.checkAccess('Kid', '1234', 'kid');
    assert.equal(result.ok, true);
    assert.equal(closed.calls.filter(c => c.body).length, 2, 'asked for the picked class, then without one');
    assert.equal('classId' in closed.calls.filter(c => c.body)[1].body, false);
  });
}
