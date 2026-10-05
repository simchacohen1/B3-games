/*
 * Which class a signed-in student is practicing in.
 *
 * B3's own classes (et/wt) and students with no class keep using the original
 * shared settings. Any other class is "its own space": its teacher controls its
 * content separately, and it starts empty until that teacher (or the admin)
 * adds something.
 */
(function (root) {
  'use strict';
  var LEGACY_CLASS_IDS = ['et', 'wt'];
  var VALID_ID = /^[A-Za-z0-9_-]{1,100}$/;

  function resolve(db, studentId) {
    var ws = root.B3_WORKSPACE_ID || (root.B3_APP_CONTEXT && root.B3_APP_CONTEXT.workspaceId) || 'b3-2026';
    return db.ref('b3Games/students/' + studentId + '/memberships').once('value').then(function (snap) {
      var memberships = snap.val() || {};
      var valid = Object.keys(memberships).map(function (k) { return memberships[k]; }).filter(function (m) {
        return m && m.active !== false && m.workspaceId === ws && m.classId;
      });
      var stored = '';
      try { stored = localStorage.getItem('b3Games_studentClass') || ''; } catch (e) {}
      var match = valid.find(function (m) { return m.classId === stored; }) ||
        valid.find(function (m) { return LEGACY_CLASS_IDS.indexOf(m.classId) >= 0; }) ||
        valid[0];
      var classId = match ? String(match.classId) : '';
      var ownSpace = !!classId && LEGACY_CLASS_IDS.indexOf(classId) < 0 && VALID_ID.test(classId);
      return { workspaceId: ws, classId: classId, ownSpace: ownSpace };
    });
  }

  root.FunTorahStudentClass = { resolve: resolve, LEGACY_CLASS_IDS: LEGACY_CLASS_IDS };
})(window);
