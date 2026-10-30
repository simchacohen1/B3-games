(function (root) {
  'use strict';
  var WORKSPACE = root.B3_WORKSPACE_ID || (root.B3_APP_CONTEXT && root.B3_APP_CONTEXT.workspaceId) || 'b3-2026';
  var VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

  async function resolve(db, user, requestedClassId, requestedStudentId) {
    if (!db || !user) throw new Error('Sign in to play.');
    var token = await user.getIdTokenResult();
    var claims = token && token.claims || {};
    var classId = '', participantId = '', name = '', role = '';
    if (claims.b3StudentRole === 'student' && claims.b3StudentId && claims.b3ClassId) {
      participantId = String(claims.b3StudentId);
      classId = String(claims.b3ClassId);
      if (requestedStudentId && requestedStudentId !== participantId) throw new Error('Your student sign-in has changed. Sign in again.');
      var membership = (await db.ref('b3Games/students/' + participantId + '/memberships/' + WORKSPACE + '_' + classId).once('value')).val();
      var studentClass = (await db.ref('b3Games/workspaces/' + WORKSPACE + '/classes/' + classId).once('value')).val();
      var student = studentClass && studentClass.members && studentClass.members[participantId];
      if (!membership || membership.active === false || membership.classId !== classId || membership.workspaceId !== WORKSPACE || !student || student.active === false) {
        throw new Error('Your active class membership is required.');
      }
      name = String(claims.b3StudentName || student.name || participantId);
      role = 'student';
    } else {
      var teacher = (await db.ref('b3Games/workspaces/' + WORKSPACE + '/teachers/' + user.uid).once('value')).val();
      if (!teacher || teacher.active !== true || teacher.role !== 'teacher') throw new Error('Sign in with an authorized teacher account.');
      var assigned = Object.keys(teacher.classIds || {}).filter(function (id) { return teacher.classIds[id] === true && VALID_ID.test(id); });
      classId = String(requestedClassId || assigned[0] || '');
      if (!VALID_ID.test(classId) || assigned.indexOf(classId) < 0) throw new Error('Choose a class assigned to your teacher account.');
      participantId = 'teacher_' + user.uid;
      name = String(teacher.displayName || user.displayName || 'Teacher');
      role = 'teacher';
    }
    if (!VALID_ID.test(classId) || !VALID_ID.test(participantId)) throw new Error('This account cannot join the selected class.');
    var cls = (await db.ref('b3Games/workspaces/' + WORKSPACE + '/classes/' + classId).once('value')).val();
    if (!cls || cls.active === false) throw new Error('This class is unavailable.');
    var enabled;
    if (classId === 'et' || classId === 'wt') {
      var settings = (await db.ref('b3Games/siteSettings').once('value')).val() || {};
      enabled = settings.games?.['multiplayer-center'] !== false && settings.classGames?.[classId]?.['multiplayer-center'] !== false;
    } else enabled = cls.toolGrants?.['multiplayer-center'] === true;
    if (role === 'teacher' && cls.teacherIds?.[user.uid] !== true) throw new Error('This teacher is not assigned to the selected class.');
    if (!enabled || role === 'student' && cls.members?.[participantId]?.toolAccess?.['multiplayer-center'] === false) {
      throw new Error('Multiplayer Center is not enabled for this class.');
    }
    return { workspaceId: WORKSPACE, classId: classId, participantId: participantId, participantName: name.slice(0, 32), role: role,
      className: String(cls.name || classId), teacherClasses: role === 'teacher' ? Object.fromEntries(assigned.map(function (id) { return [id, String(id === classId ? cls.name || id : id)]; })) : null };
  }

  root.B3MultiplayerIdentity = { resolve: resolve };
})(window);
