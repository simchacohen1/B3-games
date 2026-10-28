'use strict';
// Staging-only policy overlay. Never apply this module to production rules.
function installStagingClassPointerRules(rules) {
  if (!rules || rules['.read'] !== false || rules['.write'] !== false ||
      !rules.b3Private || rules.b3Private['.read'] !== false ||
      rules.b3Private['.write'] !== false) {
    throw new Error('Class Pointer staging rules require private deny-by-default ancestors.');
  }
  const base = "'b3Games/workspaces/' + $workspaceId + '/classes/' + $classId";
  const classValue = suffix => "root.child(" + base + suffix + ").val()";
  const activeClass = classValue(" + '/active'") + ' == true';
  const grant = classValue(" + '/toolGrants/class-pointer'") + ' == true';
  const owner = "(auth.token.email == 'owner@funtorahtools-staging.test' && auth.token.email_verified == true)";
  const admin = "root.child('b3Games/admins/' + auth.uid + '/active').val() == true";
  const teacher = "(root.child('b3Games/workspaces/' + $workspaceId + '/teachers/' + auth.uid + '/active').val() == true && root.child('b3Games/workspaces/' + $workspaceId + '/teachers/' + auth.uid + '/classIds/' + $classId).val() == true)";
  const teacherAuthorized = 'auth != null && ' + activeClass + ' && ' + grant + ' && (' + owner + ' || ' + admin + ' || ' + teacher + ')';
  const member = classValue(" + '/members/' + $studentId + '/active'") + ' == true';
  const profile = "root.child('b3Games/students/' + $studentId + '/profile/active').val() == true";
  const room = classValue(" + '/classPointerSessions/' + $roomId + '/roomId'") + ' == $roomId';
  // A stale room must not expose a student's private permissions after the lesson ends.
  // Match the four-hour session lifetime enforced by classPointerShareAuth.
  const roomCreated = "root.child(" + base + " + '/classPointerSessions/' + $roomId + '/createdAt')";
  const freshRoom = roomCreated + '.isNumber() && ' + roomCreated + '.val() >= now - 14400000 && ' + roomCreated + '.val() <= now + 60000';
  const studentAuthorized = "auth != null && auth.token.b3StudentRole == 'student' && auth.token.b3StudentId == $studentId && auth.token.b3ClassId == $classId && $workspaceId == 'b3-2026' && " +
    activeClass + ' && ' + grant + ' && ' + member + ' && ' + profile + ' && ' + room + ' && ' + freshRoom;
  rules.b3Private.classPointerSharePermissions = {
    '$workspaceId': {
      '$classId': {
        '$roomId': {
          '.read': teacherAuthorized,
          '.write': teacherAuthorized,
          '$studentId': {
            '.read': studentAuthorized,
            '.validate': "newData.hasChild('screenSharingDenied') || newData.hasChild('whiteboardDenied')",
            'screenSharingDenied': { '.validate': 'newData.isBoolean()' },
            'whiteboardDenied': { '.validate': 'newData.isBoolean()' },
            '$other': { '.validate': false }
          }
        }
      }
    }
  };
  return rules;
}
module.exports = { installStagingClassPointerRules };
