'use strict';
// Single source for the Shorashim Realtime Database rules (issue #627).
// Writes the same block into firebase-rules.json and firebase-rules.hardened.json:
//   node scripts/shorashim-rules.cjs          -> rewrite both files
//   node scripts/shorashim-rules.cjs --check  -> exit 1 if either file differs
//
// Who can do what under posukPractice/shorashimLearning:
// - Owner (verified email) and active admins: read and write everything.
// - B3's own classes (et/wt) use the base lists at the top level. Their active teachers
//   read and write those lists and read their students' work. Only et/wt students read them.
// - Every other class lives under classes/<classId>. Only that class's active teachers read
//   or write it. Only that class's students (b3ClassId claim) read its word list, settings,
//   ticked pictures and leaderboards, and each student writes only their own records.
// - Pictures a teacher added (shorashimTeacherPictures/<uid>) are readable only by that
//   teacher, the owner and admins. When the teacher ticks one, the page copies it into
//   <class space>/pictures/<uid>/<pictureId>, which that class's students can read.
// - Nothing else in shorashimLearning is readable or writable.
const fs = require('node:fs');
const path = require('node:path');

const OWNER = "auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true";
const ADMIN = "root.child('b3Games/admins/' + auth.uid + '/active').val() == true";
const STAFF = `auth != null && (${OWNER} || ${ADMIN})`;
const teacherOf = cls => `root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/' + ${cls}).val() == true`;
const LEGACY_TEACHER = `auth != null && (${teacherOf("'et'")} || ${teacherOf("'wt'")})`;
const LEGACY_STUDENT_OR_TEACHER = `auth != null && (auth.token.b3ClassId == 'et' || auth.token.b3ClassId == 'wt' || ${teacherOf("'et'")} || ${teacherOf("'wt'")})`;
const SELF = "auth != null && auth.token.b3StudentId == $studentId";
// Base-list student records: a teacher reads one student at a time, and only when that
// student's profile class is one of the teacher's own classes.
const TEACHER_OF_STUDENT = `auth != null && root.child('b3Games/students/' + $studentId + '/profile/classId').val() != null && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/' + root.child('b3Games/students/' + $studentId + '/profile/classId').val()).val() == true`;
const SELF_OR_TEACHER = `(${SELF}) || (${TEACHER_OF_STUDENT})`;
const SELF_IN_CLASS = "auth != null && auth.token.b3StudentId == $studentId && auth.token.b3ClassId == $classId";
const CLASS_TEACHER = `auth != null && ${teacherOf('$classId')}`;
const CLASS_STUDENT = 'auth != null && auth.token.b3ClassId == $classId';

// A picture copied into a class: { data: <small image data URL>, createdAt: <number> }.
const PICTURE_VALIDATE = "newData.hasChildren(['data', 'createdAt']) && newData.child('createdAt').isNumber() && newData.child('data').isString() && newData.child('data').val().length <= 200000 && (newData.child('data').val().beginsWith('data:image/webp;base64,') || newData.child('data').val().beginsWith('data:image/jpeg;base64,') || newData.child('data').val().beginsWith('data:image/png;base64,'))";
const pictureNode = () => ({
  '$uid': {
    '$pictureId': {
      '.validate': PICTURE_VALIDATE,
      'data': { '.validate': true },
      'createdAt': { '.validate': true },
      '$other': { '.validate': false }
    }
  }
});
const perStudent = (read, write) => ({ '$studentId': { '.read': read, '.write': write } });

function shorashimLearning() {
  return {
    '.read': STAFF,
    '.write': STAFF,
    // Base lists: B3's own et/wt classes.
    'catalog': { '.read': LEGACY_STUDENT_OR_TEACHER, '.write': LEGACY_TEACHER },
    'settings': { '.read': LEGACY_STUDENT_OR_TEACHER, '.write': LEGACY_TEACHER },
    'pictures': { '.read': LEGACY_STUDENT_OR_TEACHER, '.write': LEGACY_TEACHER, ...pictureNode() },
    'students': perStudent(SELF_OR_TEACHER, SELF_OR_TEACHER),
    'recordingEvents': perStudent(SELF_OR_TEACHER, SELF_OR_TEACHER),
    'recordings': perStudent(SELF_OR_TEACHER, SELF_OR_TEACHER),
    'leaderboards': {
      '.read': LEGACY_STUDENT_OR_TEACHER,
      'match': { '$pairCount': { '$studentId': { '.read': SELF_OR_TEACHER, '.write': SELF } } }
    },
    // Every other class: its own space, owned by that class's teachers.
    'classes': {
      '$classId': {
        '.read': CLASS_TEACHER,
        '.write': CLASS_TEACHER,
        'catalog': { '.read': CLASS_STUDENT },
        'settings': { '.read': CLASS_STUDENT },
        'pictures': { '.read': CLASS_STUDENT, ...pictureNode() },
        'leaderboards': {
          '.read': CLASS_STUDENT,
          'match': { '$pairCount': { '$studentId': { '.write': SELF_IN_CLASS } } }
        },
        'students': perStudent(SELF_IN_CLASS, SELF_IN_CLASS),
        'recordingEvents': perStudent(SELF_IN_CLASS, SELF_IN_CLASS),
        'recordings': perStudent(SELF_IN_CLASS, SELF_IN_CLASS)
      }
    }
  };
}

// A teacher's own added pictures: only that teacher (create or delete, never overwrite),
// the owner and admins can read or write them. Students never read this node.
function shorashimTeacherPictures() {
  const own = "auth != null && $uid == auth.uid && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true";
  return {
    '$uid': {
      '.read': `(${own}) || (${STAFF})`,
      '$pictureId': {
        '.write': `((${own}) && (!data.exists() || !newData.exists())) || (${STAFF})`,
        '.validate': PICTURE_VALIDATE,
        'data': { '.validate': true },
        'createdAt': { '.validate': true },
        '$other': { '.validate': false }
      }
    }
  };
}

const FILES = ['firebase-rules.json', 'firebase-rules.hardened.json'];
function apply(rules) {
  rules.posukPractice.shorashimLearning = shorashimLearning();
  rules.shorashimTeacherPictures = shorashimTeacherPictures();
  return rules;
}
module.exports = { shorashimLearning, shorashimTeacherPictures, apply, FILES };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const check = process.argv.includes('--check');
  let stale = [];
  for (const f of FILES) {
    const file = path.join(root, f);
    const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const json = JSON.parse(before);
    apply(json.rules);
    const after = JSON.stringify(json, null, 2) + '\n';
    if (after !== before) { if (check) stale.push(f); else fs.writeFileSync(file, after); }
  }
  if (check && stale.length) { console.log('Shorashim rules out of date in: ' + stale.join(', ') + '. Run node scripts/shorashim-rules.cjs'); process.exit(1); }
  console.log(check ? 'Shorashim rules up to date.' : 'Shorashim rules written to ' + FILES.join(', '));
}
