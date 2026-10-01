window.B3_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDaheO5K2qL8qe3rHIZY4nTd0wuEUG_DEs",
  authDomain: "b3-games.firebaseapp.com",
  databaseURL: "https://b3-games-default-rtdb.firebaseio.com",
  projectId: "b3-games",
  storageBucket: "b3-games.firebasestorage.app",
  messagingSenderId: "568530046190",
  appId: "1:568530046190:web:fd765fdd27e55a3c73f7ff"
};

/*
 * Multi-teacher / multi-class foundation.
 *
 * Vocabulary:
 * - workspace: a school/teacher space that owns configuration
 * - teacher: an authenticated adult account
 * - class: a teaching group inside a workspace
 * - student: one person who may belong to multiple classes
 * - membership: the link between a student and a class
 * - shared resource: an explicitly shared area (for example a gallery) that
 *   multiple classes may opt into without sharing their unrelated settings.
 *
 * During migration, ET/WT keep their existing short IDs so all current B3
 * behavior continues to work while data is moved into the new model.
 */
window.B3_APP_CONTEXT = Object.freeze({
  // This identifies the current legacy workspace only. Teachers, classes,
  // students and PINs are loaded from Firebase rather than embedded here.
  workspaceId: "b3-2026",
  workspaceName: "B3 2026-27"
});

/*
 * Canonical Firebase paths for the scalable model. Apps should build new
 * multi-class features from these helpers instead of inventing global paths.
 *
 * A student can belong to any number of classes because membership is stored
 * separately from the student profile. Class settings therefore never overlap.
 * Shared resources are separate objects with explicit class membership.
 */
window.B3_DATA_MODEL = Object.freeze({
  version: 2,
  root: "b3Games",
  workspace: function (workspaceId) {
    return "b3Games/workspaces/" + String(workspaceId || "");
  },
  teacher: function (teacherId) {
    return "b3Games/teachers/" + String(teacherId || "");
  },
  student: function (studentId) {
    return "b3Games/students/" + String(studentId || "");
  },
  class: function (workspaceId, classId) {
    return "b3Games/workspaces/" + String(workspaceId || "") + "/classes/" + String(classId || "");
  },
  classMembership: function (workspaceId, classId, studentId) {
    return "b3Games/workspaces/" + String(workspaceId || "") + "/classes/" +
      String(classId || "") + "/members/" + String(studentId || "");
  },
  studentMemberships: function (studentId) {
    return "b3Games/students/" + String(studentId || "") + "/memberships";
  },
  sharedResource: function (workspaceId, resourceId) {
    return "b3Games/workspaces/" + String(workspaceId || "") + "/sharedResources/" + String(resourceId || "");
  }
});
