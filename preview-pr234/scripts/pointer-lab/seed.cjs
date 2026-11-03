'use strict';
// Seeds the Pointer lab emulators with SYNTHETIC data only: class "Pointer Test", two students, a teacher.
// The passcodes below exist only inside the lab and mean nothing anywhere else.
const path = require('node:path');
const DEPS = process.env.LAB_DEPS;
if (!DEPS) { console.error('Set LAB_DEPS (see README.md).'); process.exit(1); }
process.env.NODE_PATH = path.join(DEPS, 'node_modules');
require('node:module').Module._initPaths();
const PROJECT = 'demo-pointer-lab';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROJECT, databaseURL: 'https://' + PROJECT + '-default-rtdb.firebaseio.com' });
const db = admin.database();

const WS = 'b3-2026', CLASS = 'pointer-test';
const STUDENTS = { studentA: { name: 'Pointer Test Student A', pin: '1111' }, studentB: { name: 'Pointer Test Student B', pin: '2222' } };
// access-check people: C is in a different class with fewer tools, D was removed from the class
const OTHER = { studentC: { name: 'Other Class Student C', pin: '3333' } }, REMOVED = { studentD: { name: 'Removed Student D', pin: '4444' } };
const TEACHER_EMAIL = 'teacher@pointer.lab', OWNER_EMAIL = 'simcha5770@gmail.com';

async function labGoogleUser(email, name) { // an emulator-only Google-style account the sign-in popup will list
  const idp = JSON.stringify({ sub: 'lab-' + email, email, email_verified: true, display_name: name, provider_id: 'google.com' });
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=lab-fake-api-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postBody: 'id_token=' + encodeURIComponent(idp) + '&providerId=google.com', requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true }) });
  const j = await r.json(); if (!j.localId) throw new Error('could not create ' + email + ': ' + JSON.stringify(j)); return j.localId;
}
(async () => {
  const teacherUid = await labGoogleUser(TEACHER_EMAIL, 'Lab Teacher');
  const ownerUid = await labGoogleUser(OWNER_EMAIL, 'Lab Owner');
  const members = {}, students = {}, passcodes = {};
  for (const [id, s] of Object.entries(STUDENTS)) {
    members[id] = { active: true, name: s.name };
    students[id] = { profile: { id, name: s.name, active: true, classId: CLASS }, memberships: { [WS + '_' + CLASS]: { workspaceId: WS, classId: CLASS, active: true } } };
    passcodes[id] = { passcode: s.pin, updatedAt: Date.now(), chosenPinVersion: 1 };
  }
  const otherMembers = {}, removedMembers = {};
  for (const [id, s] of Object.entries(OTHER)) { otherMembers[id] = { active: true, name: s.name }; students[id] = { profile: { id, name: s.name, active: true, classId: 'other-class' }, memberships: { [WS + '_other-class']: { workspaceId: WS, classId: 'other-class', active: true } } }; passcodes[id] = { passcode: s.pin, updatedAt: Date.now(), chosenPinVersion: 1 }; }
  for (const [id, s] of Object.entries(REMOVED)) { members[id] = { active: false, name: s.name }; students[id] = { profile: { id, name: s.name, active: true, classId: CLASS }, memberships: { [WS + '_' + CLASS]: { workspaceId: WS, classId: CLASS, active: false } } }; passcodes[id] = { passcode: s.pin, updatedAt: Date.now(), chosenPinVersion: 1 }; }
  await db.ref().update({
    ['b3Games/workspaces/' + WS + '/classes/other-class']: { id: 'other-class', name: 'Other Test Class', active: true, members: otherMembers, toolGrants: { gematria: true } },
    ['b3Games/workspaces/' + WS + '/classes/' + CLASS]: { id: CLASS, name: 'Pointer Test', active: true, members, teacherIds: { [teacherUid]: true }, toolGrants: { 'class-pointer': true, shorashim: true, chazara: true, 'rashi-letters': true, gematria: true, 'posuk-practice-scroll': true, 'weekly-quiz': true, halacha: true, yiddish: true, 'sefer-hamitzvos': true } },
    ['b3Games/workspaces/' + WS + '/teachers/' + teacherUid]: { active: true, email: TEACHER_EMAIL, name: 'Lab Teacher', classIds: { [CLASS]: true } },
    ['b3Games/students']: students,
    ['b3Private/passcodes']: passcodes,
    ['b3Games/siteSettings/studentWebsiteEnabled']: true,
  });
  console.log('Seeded. Class "Pointer Test" with', Object.values(STUDENTS).map(s => s.name).join(' and '));
  console.log('Teacher account (pick it in the Google pop-up): ' + TEACHER_EMAIL + '   Owner/admin test account: ' + OWNER_EMAIL);
  console.log('Access-check students: C (other class, only Gematria) = 3333, D (removed) = 4444');
  console.log('Student passcodes (lab only): A = ' + STUDENTS.studentA.pin + ', B = ' + STUDENTS.studentB.pin);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
