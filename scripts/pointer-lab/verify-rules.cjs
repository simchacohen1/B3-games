'use strict';
// Repeatable check of a checkout's database rules against what Classroom Pointer and the student pages need.
// Run it against a lab started from that checkout (see README.md): node scripts/pointer-lab/verify-rules.cjs
// It uses only the lab's Auth and Database emulators and the made-up Pointer Test class. Exit code 0 = all pass.
const BASE = process.env.LAB_URL || 'http://localhost:8787';
const DB = 'http://127.0.0.1:9000', NS = 'demo-pointer-lab-default-rtdb', AUTH = 'http://127.0.0.1:9099';
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  -> ' + detail : '')); };
const rest = async (method, path, { token, body } = {}) => {
  const r = await fetch(DB + '/' + path + '.json?ns=' + NS + (token ? '&auth=' + encodeURIComponent(token) : ''), { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json };
};
const denied = r => r.status === 401 || r.status === 403 || (r.json && r.json.error === 'Permission denied');
async function googleToken(email) {
  const idp = JSON.stringify({ sub: 'lab-' + email, email, email_verified: true, provider_id: 'google.com' });
  const r = await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=lab-fake-api-key', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postBody: 'id_token=' + encodeURIComponent(idp) + '&providerId=google.com', requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true }) });
  const j = await r.json(); return { token: j.idToken, uid: j.localId };
}
async function studentToken(name, pin) {
  const r = await fetch(BASE + '/_fn/funTorahStudentAuth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', name, pin }) });
  const d = await r.json(); if (!d.customToken) throw new Error('student login gave no token: ' + JSON.stringify(d).slice(0, 120));
  const s = await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=lab-fake-api-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: d.customToken, returnSecureToken: true }) });
  return { token: (await s.json()).idToken, id: d.id, classId: d.classId };
}
(async () => {
  const CLASS = 'b3Games/workspaces/b3-2026/classes/pointer-test';
  // 1. strangers (no sign-in) cannot read private lists, but the public site switch stays readable
  for (const p of ['b3Games/students', 'b3Games/students/studentA/profile', 'b3Games/workspaces/b3-2026/classes', CLASS, CLASS + '/toolGrants', 'b3Games/workspaces/b3-2026/teachers', 'b3Games/admins'])
    check('anonymous cannot read ' + p, denied(await rest('GET', p)));
  check('anonymous can read the public student-website switch', (await rest('GET', 'b3Games/siteSettings/studentWebsiteEnabled')).json === true);
  // 2. a signed-in student can read exactly what the student pages need for their own class
  const st = await studentToken('Pointer Test Student A', '1111');
  for (const f of ['name', 'active', 'toolGrants', 'access', 'siteEnabled', 'members/' + st.id]) {
    const r = await rest('GET', CLASS + '/' + f, { token: st.token });
    check('student can read own class ' + f, !denied(r) && r.status === 200, denied(r) ? 'PERMISSION DENIED' : '');
  }
  check('student can read own profile', !denied(await rest('GET', 'b3Games/students/' + st.id + '/profile', { token: st.token })));
  check('student cannot read the whole student list', denied(await rest('GET', 'b3Games/students', { token: st.token })));
  check('student cannot read a classmate profile', denied(await rest('GET', 'b3Games/students/studentB/profile', { token: st.token })));
  check('student cannot read private passcodes', denied(await rest('GET', 'b3Private/passcodes', { token: st.token })));
  check('student cannot write class settings', denied(await rest('PUT', CLASS + '/toolGrants', { token: st.token, body: { gematria: true } })));
  // 3. the assigned teacher can run Pointer; strangers and students cannot touch the private permission rows
  const teacherLogin = await googleToken('teacher@pointer.lab'), teacher = teacherLogin.token;
  const room = 'class-pointer-00000000-0000-0000-0000-000000000000', perm = 'b3Private/classPointerSharePermissions/b3-2026/pointer-test/' + room;
  const w = await rest('PUT', perm, { token: teacher, body: { studentA: { screenSharingDenied: false } } });
  check('assigned teacher can write private Pointer permissions', !denied(w) && w.status === 200, denied(w) ? 'PERMISSION DENIED' : '');
  const sess = await rest('PUT', CLASS + '/classPointerSessions/' + room, { token: teacher, body: { roomId: room, createdAt: Date.now(), teacherUid: teacherLogin.uid, studentScreenSharing: false } });
  check('assigned teacher can publish a Pointer session', !denied(sess) && sess.status === 200, denied(sess) ? 'PERMISSION DENIED' : '');
  check('student cannot write private Pointer permissions', denied(await rest('PUT', perm, { token: st.token, body: { studentA: { screenSharingDenied: true } } })));
  check('anonymous cannot write private Pointer permissions', denied(await rest('PUT', perm, { body: { x: 1 } })));
  check('student can read the Pointer session of own class', !denied(await rest('GET', CLASS + '/classPointerSessions', { token: st.token })));
  check('anonymous cannot read Pointer sessions', denied(await rest('GET', CLASS + '/classPointerSessions')));
  await rest('DELETE', perm); await rest('DELETE', CLASS + '/classPointerSessions/' + room);
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' checks passed' + (failed.length ? '; FAILED: ' + failed.map(f => f.name).join('; ') : ''));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('verify-rules error:', e.message); process.exit(2); });
