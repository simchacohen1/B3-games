'use strict';
// Checks (and optionally repairs) the fictional staging data the Class Pointer teacher dashboard needs:
// the fictional teacher's record, a class they teach with the class-pointer tool on, and its fictional students.
//
//   node staging/class-pointer-test-data.cjs            read-only: lists what is missing
//   node staging/class-pointer-test-data.cjs --apply    adds ONLY what is missing; never overwrites a value
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
  const email = emailArg ? emailArg.slice(10) : 'teacher.alef@funtorahtools-staging.test';
  const role = fixture.roles.find(r => r.email === email);
  if (!role || role.role !== 'teacher') throw new Error('Not a fictional staging teacher: ' + email);
  const token = gcloudToken();
  const headers = { Authorization: 'Bearer ' + token, 'x-goog-user-project': PROJECT };
  const lookup = await (await fetch('https://identitytoolkit.googleapis.com/v1/projects/' + PROJECT + '/accounts:lookup', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: [email] })
  })).json();
  const user = (lookup.users || []).find(u => u.email === email);
  if (!user) throw new Error('No Auth account for ' + email + ' on staging. Run staging/provision-fictional-accounts.ps1 first.');
  let claims = null; try { claims = JSON.parse(user.customAttributes || 'null'); } catch { /* none */ }
  if (!claims || claims.b3StagingAccount !== true) throw new Error('That account is not a staging fixture account; refusing.');
  const uid = user.localId;
  const get = async p => { const r = await fetch(DB + '/' + p + '.json', { headers }); if (!r.ok) throw new Error('Read ' + p + ' failed: HTTP ' + r.status); return r.json(); };
  const ws = fixture.workspaceId, students = role.students = fixture.students.filter(s => s.classId === role.classId);
  const have = { teacher: await get('b3Games/workspaces/' + ws + '/teachers/' + uid), cls: await get('b3Games/workspaces/' + ws + '/classes/' + role.classId), students: {}, passcodes: {} };
  for (const s of students) {
    const rec = await get('b3Games/students/' + s.id);
    have.students[s.id] = { profile: rec && rec.profile, membership: rec && rec.memberships && rec.memberships[ws + '_' + role.classId] };
    have.passcodes[s.id] = (await get('b3Private/passcodes/' + s.id + '/updatedAt')) != null;
  }
  const { problems, patch } = diagnose({ workspaceId: ws, role, uid, have });
  console.log('Staging project: ' + PROJECT + '   Teacher: ' + email + '   Class: ' + role.classId);
  if (!problems.length) { console.log('OK: everything the Class Pointer dashboard needs is present.'); return; }
  problems.forEach(p => console.log(' - ' + p));
  const paths = Object.keys(patch);
  if (!apply) { console.log('\nRun again with --apply to add the ' + paths.length + ' missing item(s). Nothing was changed.'); return; }
  const res = await fetch(DB + '/.json?print=silent', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error('Write failed: HTTP ' + res.status);
  console.log('\nAdded: ' + paths.join(', '));
}

module.exports = { diagnose, spawnOptions, PROJECT };
if (require.main === module) main().catch(e => { console.error('Error: ' + e.message); process.exit(1); });
