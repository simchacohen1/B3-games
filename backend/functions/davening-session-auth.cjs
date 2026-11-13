'use strict';

const { validKey, readClassForStudent } = require('./student-practice-auth.cjs');
const defaultDeployment = require('./davening-deployment.cjs');

function deny() {
  throw Object.assign(new Error('Active Davening class access is required.'), { status: 403 });
}

// `page` is the Davening page asking ('et' or 'wt'). The deployment settings
// name the one class record that page may use; nothing else is reachable.
async function authorize(get, identity, page, deployment = defaultDeployment) {
  const classId = typeof page === 'string' && Object.hasOwn(deployment.classMap, page)
    ? deployment.classMap[page] : null;
  if (!validKey(classId) || !validKey(identity?.uid)) deny();
  const workspace = 'b3Games/workspaces/b3-2026';
  if (identity.b3StudentRole === 'student') {
    const studentId = identity.b3StudentId;
    if (!validKey(studentId) || identity.b3ClassId !== classId) deny();
    const student = `b3Games/students/${studentId}`;
    const [cls, profile, memberships] = await Promise.all([
      readClassForStudent(get, classId, studentId),
      get(`${student}/profile`),
      get(`${student}/memberships`)
    ]);
    const member = cls?.members[studentId];
    const rows = Object.values(memberships || {});
    const enrolled = rows.length
      ? rows.some(row => row?.active !== false && row?.workspaceId === 'b3-2026' && row?.classId === classId)
      : profile?.classId === classId;
    if (!profile || profile.active === false || !enrolled || !member || member.active === false
      || cls.active === false || cls.toolGrants?.davening !== true) deny();
    return { role: 'student', classId, studentId, name: String(profile.name || member.name || 'Student').slice(0, 100) };
  }

  const provider = identity.firebase?.sign_in_provider;
  // Fictional staging teachers sign in with a password; only the staging build allows them.
  const stagingTeacher = deployment.stagingPasswordTeachers === true
    && identity.b3StagingAccount === true && provider === 'password';
  if (identity.email_verified !== true || (provider !== 'google.com' && !stagingTeacher)) deny();
  const [cls, admin, teacher] = await Promise.all([
    get(`${workspace}/classes/${classId}`),
    get(`b3Games/admins/${identity.uid}`),
    get(`${workspace}/teachers/${identity.uid}`)
  ]);
  const owner = identity.email?.toLowerCase() === 'simcha5770@gmail.com'
    || Boolean(admin && admin.active !== false);
  const assigned = teacher && teacher.active !== false && teacher.classIds?.[classId] === true;
  if (!cls || cls.active === false || (!owner && (!assigned || cls.toolGrants?.davening !== true))) deny();
  return { role: 'teacher', classId };
}

module.exports = { authorize };
