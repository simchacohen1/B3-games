'use strict';
// Checks (and optionally repairs) the fictional staging data the Class Pointer teacher dashboard needs:
// the fictional teacher's record, a class they teach with the class-pointer tool on, and its fictional students.
//
//   node staging/class-pointer-test-data.cjs            read-only: lists what is missing
//   node staging/class-pointer-test-data.cjs --apply    adds ONLY what is missing; never overwrites a value
//
//   node staging/class-pointer-test-data.cjs --google-teacher=<your-google-email> [--apply]
//       makes YOUR Google account a teacher of the fictional class TEST-ALEF on staging, so you can sign in with
//       Google on the staging site and pick that class. Sign in with Google on staging once first (it will say
//       you are not authorized; that is expected) so the account exists, then run this.
//
// STAGING ONLY: the project is fixed below and the script refuses anything else. It uses your own
// `gcloud auth application-default` login, like staging/provision-fictional-accounts.ps1. It never reads or
// prints passwords or passcodes (it only checks that a passcode exists), and it never touches production.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT = 'fun-torah-tools-staging';
const DB = 'https://' + PROJECT + '-default-rtdb.firebaseio.com';
const FIXTURE = path.join(__dirname, 'fictional-accounts.json');

// Pure: compares what staging has with what the dashboard needs. `have` holds the current values (null when absent).
// Returns { problems: [text], patch: { 'db/path': value } }. The patch only ever fills in blanks.
function diagnose({ workspaceId, role, uid, have }) {
  const problems = [], patch = {};
  const base = 'b3Games/workspaces/' + workspaceId;
  const classId = role.classId;
  const t = have.teacher, c = have.cls;
  const teacherPath = base + '/teachers/' + uid, classPath = base + '/classes/' + classId;

  if (!t) {
    problems.push('Teacher record is missing (' + teacherPath + '). The dashboard cannot read the class without it.');
    patch[teacherPath] = { uid, email: role.email, displayName: role.displayName, active: true, role: 'teacher', title: 'teacher', classIds: { [classId]: true } };
  } else {
    if (t.active !== true) { problems.push('Teacher record is not active:true. The database rules refuse the class read, which shows "Could not load your classes".'); patch[teacherPath + '/active'] = true; }
    if (!t.classIds || t.classIds[classId] !== true) { problems.push('Teacher record does not list class ' + classId + '.'); patch[teacherPath + '/classIds/' + classId] = true; }
  }
  if (!c) {
    problems.push('Class ' + classId + ' is missing (' + classPath + ').');
    patch[classPath] = { id: classId, name: role.className, active: true, siteEnabled: true, toolGrants: { 'class-pointer': true }, teacherIds: { [uid]: true }, members: {} };
  } else {
    if (c.active === false) { problems.push('Class ' + classId + ' is switched off (active:false).'); patch[classPath + '/active'] = true; }
    if (!c.toolGrants || c.toolGrants['class-pointer'] !== true) { problems.push('Class ' + classId + ' does not have the class-pointer tool turned on.'); patch[classPath + '/toolGrants/class-pointer'] = true; }
    if (!c.teacherIds || c.teacherIds[uid] !== true) { problems.push('Class ' + classId + ' does not list this teacher in teacherIds.'); patch[classPath + '/teacherIds/' + uid] = true; }
  }
  for (const s of role.students) {
    if (!c || !c.members || !c.members[s.id]) {
      problems.push('Student ' + s.name + ' (' + s.id + ') is not a member of ' + classId + '.');
      const member = { active: true, name: s.name, studentId: s.id, toolAccess: {} };
      // A whole new class is written in one piece (Firebase rejects overlapping paths in one update).
      if (!c) patch[classPath].members[s.id] = member; else patch[classPath + '/members/' + s.id] = member;
    } else if (c.members[s.id].active === false) {
      problems.push('Student ' + s.name + ' is inactive in ' + classId + '.'); patch[classPath + '/members/' + s.id + '/active'] = true;
    }
    const rec = have.students[s.id];
    if (!rec || !rec.profile) {
      problems.push('Student ' + s.name + ' has no profile record.');
      patch['b3Games/students/' + s.id + '/profile'] = { id: s.id, name: s.name, active: true, classId };
    }
    if (!rec || !rec.membership) {
      problems.push('Student ' + s.name + ' has no membership record for ' + classId + '.');
      patch['b3Games/students/' + s.id + '/memberships/' + workspaceId + '_' + classId] = { workspaceId, classId, active: true };
    }
    if (!have.passcodes[s.id]) problems.push('Student ' + s.name + ' has no passcode, so cannot sign in. This tool does not create passcodes: reset it in Teacher Center (staging) or re-provision.');
  }
  return { problems, patch };
}

// The invitation id the site looks up for a signed-in Google account (see site-settings.js).
const inviteIdFor = email => String(email).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const EMAIL_RE = /^[^\s@<>"'`\\]+@[^\s@<>"'`\\]+\.[^\s@<>"'`\\]+$/;

// Pure: refuses anything that is not an ordinary, verified Google account on the staging project.
function checkGoogleTeacher(email, user) {
  if (!EMAIL_RE.test(email || '') || email.length > 200) throw new Error('--google-teacher needs a full email address, for example --google-teacher=<your-google-email>');
  if (/@funtorahtools-staging\.test$/i.test(email)) throw new Error('That is a fictional staging address, not a Google account. Use --teacher= for those.');
  if (!user) throw new Error('No account for ' + email + ' on staging yet. Open the staging site, click "Sign in with Google" once with this account (it will say you are not authorized, that is expected), then run this again.');
  if (user.emailVerified !== true) throw new Error('That staging account has an unverified email; refusing.');
  if (!(user.providerUserInfo || []).some(p => p.providerId === 'google.com')) throw new Error('That staging account did not sign in with Google; refusing.');
}

// Pure: the records that make a Google account a teacher of the fictional class. Reuses diagnose() for the teacher
// record, class, Class Pointer setting and fictional students, and adds the invitation the site also looks up.
// Only fills blanks. The class is always the fictional one from fictional-accounts.json; admin rights are never granted.
function diagnoseGoogleTeacher({ workspaceId, role, email, uid, displayName, have, removeAdmin = false }) {
  const mail = String(email).trim().toLowerCase();
  const me = { ...role, email: mail, displayName: displayName || 'Staging Google tester' };
  const r = diagnose({ workspaceId, role: me, uid, have });
  const invitePath = 'b3Games/workspaces/' + workspaceId + '/teacherInvites/' + inviteIdFor(mail), inv = have.invite;
  if (!inv) {
    r.problems.push('No teacher invitation for ' + mail + ' (a fallback the site also checks).');
    r.patch[invitePath] = { email: mail, name: me.displayName, active: true, classIds: { [role.classId]: true } };
  } else {
    if (inv.active === false) { r.problems.push('The teacher invitation for ' + mail + ' is switched off.'); r.patch[invitePath + '/active'] = true; }
    if (!inv.classIds || inv.classIds[role.classId] !== true) { r.problems.push('The teacher invitation does not list ' + role.classId + '.'); r.patch[invitePath + '/classIds/' + role.classId] = true; }
  }
  // A teacher login must not also be an admin. The site treats an admin as someone who may read EVERY class and
  // reads the whole class list, which the staging rules only allow for the fictional owner: that read is refused
  // ("permission_denied at .../classes") and the dashboard shows "Could not load your classes".
  const adminPath = 'b3Games/admins/' + uid, adm = have.admin;
  if (adm && adm.active !== false) {
    r.problems.push('This account has an ADMIN record on staging (' + adminPath + '), so the site treats it as an admin and reads the whole class list, ' +
      'which the staging rules refuse. A teacher login must not have one. Re-run with --remove-staging-admin --apply to switch it off (it is kept, set to active:false).');
    if (removeAdmin) r.patch[adminPath + '/active'] = false;
  }
  return r;
}

// On Windows gcloud is gcloud.cmd, which Node cannot start without a shell (that is the "spawnSync gcloud ENOENT" error).
// The arguments below are fixed strings, never user input, so using a shell there is safe.
const spawnOptions = platform => ({ encoding: 'utf8', shell: platform === 'win32', windowsHide: true });
function gcloudToken(platform = process.platform) {
  let out;
  try {
    out = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], spawnOptions(platform)).trim();
  } catch (error) {
    throw new Error('Could not run gcloud (' + (error.code || error.message) + '). Install the Google Cloud CLI and run: gcloud auth application-default login');
  }
  if (out.length < 20) throw new Error('Google Application Default Credentials are unavailable. Run: gcloud auth application-default login');
  return out;
}
async function main() {
  const apply = process.argv.includes('--apply');
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const emailArg = process.argv.find(a => a.startsWith('--teacher='));
  const googleArg = process.argv.find(a => a.startsWith('--google-teacher='));
  if (googleArg && emailArg) throw new Error('Use either --teacher= or --google-teacher=, not both.');
  const googleEmail = googleArg ? googleArg.slice('--google-teacher='.length).trim().toLowerCase() : null;
  // Check the address is well formed and not a fictional one before anything is contacted.
  if (googleEmail !== null) checkGoogleTeacher(googleEmail, { emailVerified: true, providerUserInfo: [{ providerId: 'google.com' }] });
  const email = googleEmail ? googleEmail : (emailArg ? emailArg.slice(10) : 'teacher.alef@funtorahtools-staging.test');
  // Your Google account is attached to the fictional Alef class: the fixture teacher record supplies the class and students.
  const role = fixture.roles.find(r => r.email === (googleEmail ? 'teacher.alef@funtorahtools-staging.test' : email));
  if (!role || role.role !== 'teacher') throw new Error('Not a fictional staging teacher: ' + email);
  const token = gcloudToken();
  const headers = { Authorization: 'Bearer ' + token, 'x-goog-user-project': PROJECT };
  const lookup = await (await fetch('https://identitytoolkit.googleapis.com/v1/projects/' + PROJECT + '/accounts:lookup', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: [email] })
  })).json();
  const user = (lookup.users || []).find(u => String(u.email || '').toLowerCase() === email.toLowerCase());
  if (googleEmail) checkGoogleTeacher(googleEmail, user);
  else {
    if (!user) throw new Error('No Auth account for ' + email + ' on staging. Run staging/provision-fictional-accounts.ps1 first.');
    let claims = null; try { claims = JSON.parse(user.customAttributes || 'null'); } catch { /* none */ }
    if (!claims || claims.b3StagingAccount !== true) throw new Error('That account is not a staging fixture account; refusing.');
  }
  const uid = user.localId;
  const get = async p => { const r = await fetch(DB + '/' + p + '.json', { headers }); if (!r.ok) throw new Error('Read ' + p + ' failed: HTTP ' + r.status); return r.json(); };
  const ws = fixture.workspaceId, students = role.students = fixture.students.filter(s => s.classId === role.classId);
  const have = { teacher: await get('b3Games/workspaces/' + ws + '/teachers/' + uid), cls: await get('b3Games/workspaces/' + ws + '/classes/' + role.classId), students: {}, passcodes: {} };
  for (const s of students) {
    const rec = await get('b3Games/students/' + s.id);
    have.students[s.id] = { profile: rec && rec.profile, membership: rec && rec.memberships && rec.memberships[ws + '_' + role.classId] };
    have.passcodes[s.id] = (await get('b3Private/passcodes/' + s.id + '/updatedAt')) != null;
  }
  if (googleEmail) {
    have.invite = await get('b3Games/workspaces/' + ws + '/teacherInvites/' + inviteIdFor(googleEmail));
    have.admin = await get('b3Games/admins/' + uid);
  }
  const { problems, patch } = googleEmail
    ? diagnoseGoogleTeacher({ workspaceId: ws, role, email: googleEmail, uid, displayName: user.displayName, have, removeAdmin: process.argv.includes('--remove-staging-admin') })
    : diagnose({ workspaceId: ws, role, uid, have });
  console.log('Staging project: ' + PROJECT + '   Teacher: ' + email + (googleEmail ? ' (your Google account)' : '') + '   Class: ' + role.classId);
  if (googleEmail) {
    const t = have.teacher, adm = have.admin;
    console.log('Found for this account (uid ' + uid + '): admin record: ' + (adm ? (adm.active === false ? 'yes, switched off' : 'YES, active') : 'no') +
      ' | teacher record: ' + (t ? 'yes, active=' + (t.active !== false) + ', classes=' + Object.keys(t.classIds || {}).join(',') : 'no') +
      ' | invitation: ' + (have.invite ? 'yes' : 'no'));
  }
  if (!problems.length) { console.log('OK: everything the Class Pointer dashboard needs is present.'); return; }
  problems.forEach(p => console.log(' - ' + p));
  const paths = Object.keys(patch);
  if (!apply) { console.log('\nRun again with --apply to add the ' + paths.length + ' missing item(s). Nothing was changed.'); return; }
  const res = await fetch(DB + '/.json?print=silent', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error('Write failed: HTTP ' + res.status);
  console.log('\nAdded/changed: ' + paths.join(', '));
}

module.exports = { diagnose, diagnoseGoogleTeacher, checkGoogleTeacher, inviteIdFor, spawnOptions, PROJECT };
if (require.main === module) main().catch(e => { console.error('Error: ' + e.message); process.exit(1); });
