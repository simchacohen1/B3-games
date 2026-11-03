(function (root) {
  'use strict';
  var WORKSPACE = root.B3_WORKSPACE_ID || (root.B3_APP_CONTEXT && root.B3_APP_CONTEXT.workspaceId) || 'b3-2026';
  var VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

  var functionsReady = null;
  // Older game pages load Firebase without the Functions library. Load the same version from the same host on demand.
  function ensureFunctions() {
    if (root.firebase && typeof root.firebase.functions === 'function') return Promise.resolve();
    if (!root.firebase || !root.document) return Promise.reject(new Error('The class access service is unavailable.'));
    if (functionsReady) return functionsReady;
    var version = String(root.firebase.SDK_VERSION || '');
    var file = parseInt(version, 10) <= 8 ? 'firebase-functions.js' : 'firebase-functions-compat.js';
    functionsReady = new Promise(function (resolve, reject) {
      var script = root.document.createElement('script');
      script.src = 'https://www.gstatic.com/firebasejs/' + version + '/' + file;
      script.onload = function () { typeof root.firebase.functions === 'function' ? resolve() : reject(new Error('The class access service is unavailable.')); };
      script.onerror = function () { reject(new Error('The class access service is unavailable.')); };
      root.document.head.appendChild(script);
    }).catch(function (error) { functionsReady = null; throw error; });
    return functionsReady;
  }

  async function resolve(db, user, requestedClassId, requestedStudentId) {
    if (!db || !user) throw new Error('Sign in to play.');
    var token = await user.getIdTokenResult();
    var claims = token && token.claims || {};
    var classId = '', participantId = '', name = '', role = '';
    if (claims.b3StudentRole === 'student' && claims.b3StudentId && claims.b3ClassId) {
      participantId = String(claims.b3StudentId);
      classId = String(claims.b3ClassId);
      if (requestedStudentId && requestedStudentId !== participantId) throw new Error('Your student sign-in has changed. Sign in again.');
      await ensureFunctions();
      var response = await root.firebase.app().functions('us-central1').httpsCallable('multiplayerGameAction')({
        action: 'identity', workspaceId: WORKSPACE
      });
      var identity = response && response.data || {};
      if (identity.role !== 'student' || identity.classId !== classId || identity.participantId !== participantId || identity.workspaceId !== WORKSPACE) {
        throw new Error('Your active class membership is required.');
      }
      name = String(identity.participantName || claims.b3StudentName || participantId);
      return { workspaceId: WORKSPACE, classId: classId, participantId: participantId, participantName: name.slice(0, 32),
        role: 'student', className: String(identity.className || classId), teacherClasses: null };
    } else {
      var teacher = (await db.ref('b3Games/workspaces/' + WORKSPACE + '/teachers/' + user.uid).once('value')).val();
      if (!teacher || teacher.active !== true) throw new Error('Sign in with an authorized teacher account.');
      var assigned = Object.keys(teacher.classIds || {}).filter(function (id) { return teacher.classIds[id] === true && VALID_ID.test(id); });
      var ownerMode = teacher.role === 'owner';
      if (teacher.role !== 'teacher' && !ownerMode) throw new Error('Sign in with an authorized teacher account.');
      if (ownerMode) {
        var admin = (await db.ref('b3Games/admins/' + user.uid).once('value')).val();
        if (!admin || admin.active === false) throw new Error('Sign in with an authorized teacher account.');
      }
      classId = String(requestedClassId || assigned[0] || (ownerMode ? 'et' : ''));
      if (!VALID_ID.test(classId) || !ownerMode && assigned.indexOf(classId) < 0) throw new Error('Choose a class assigned to your teacher account.');
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
