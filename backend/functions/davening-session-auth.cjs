'use strict';

const { validKey, readClassForStudent } = require('./student-practice-auth.cjs');

function deny() {
  throw Object.assign(new Error('Active Davening class access is required.'), { status: 403 });
}

async function authorize(get, identity, classId) {
  if (!['et', 'wt'].includes(classId) || !validKey(identity?.uid)) deny();
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
      || cls.active === false) deny();
    return { role: 'student', classId, studentId, name: String(profile.name || member.name || 'Student').slice(0, 100) };
  }

  if (identity.email_verified !== true || identity.firebase?.sign_in_provider !== 'google.com') deny();
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
