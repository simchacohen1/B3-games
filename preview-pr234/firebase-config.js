/* Preview-only safety wrapper; candidate source c3f7e22. */
(function(){
'use strict';
window.FTT_PR234_PREVIEW=true;
const temporaryStudents=["student_56848fe7d1544f5b81bd25b130615c79","student_eea1b121b2ec4e81aff9df7e7b633b6f"];
const permitted=p=>temporaryStudents.some(id=>p==='posukPractice/shorashimLearning/students/'+id||p.startsWith('posukPractice/shorashimLearning/students/'+id+'/'))||/^b3Games\/workspaces\/b3-2026\/classes\/(et|wt|pointer_test|testing)\/access\/previewPr234(?:\/|$)/.test(p)||/^b3Games\/workspaces\/b3-2026\/classes\/(pointer_test|testing)\/classPointerSessions\//.test(p)||/^b3Private\/classPointerSharePermissions\/b3-2026\/(pointer_test|testing)\//.test(p);
const pathOf=ref=>decodeURIComponent(new URL(ref.toString()).pathname).replace(/^\//,'');
const deny=()=>{throw Error('Preview safety: student-data writes and production class controls are disabled.');};
if(window.firebase?.database?.Reference){
 const proto=firebase.database.Reference.prototype;
 for(const key of ['set','remove','transaction','setPriority','setWithPriority']){const old=proto[key];if(old)proto[key]=function(...args){if(!permitted(pathOf(this)))return deny();return old.apply(this,args);};}
 const update=proto.update;proto.update=function(values,...args){const base=pathOf(this);if(!Object.keys(values||{}).every(k=>permitted([base,k].filter(Boolean).join('/'))))return deny();return update.call(this,values,...args);};
 const od=proto.onDisconnect;proto.onDisconnect=function(){if(!permitted(pathOf(this)))return deny();return od.call(this);};
}
if(window.firebase?.storage?.Reference){const proto=firebase.storage.Reference.prototype;for(const key of ['put','putString','delete','updateMetadata'])if(proto[key])proto[key]=deny;}
const originalFetch=window.fetch.bind(window);window.fetch=function(input,options){const url=String(input?.url||input);if(url.includes('cloudfunctions.net/')&&options?.method?.toUpperCase()==='POST'){
 const body=JSON.parse(options.body||'{}');
 if(url.includes('/classPointerShareAuth')){if(!['pointer_test','testing'].includes(body.classId))return Promise.reject(Error('Preview: Class Pointer is limited to existing test classes.'));}
 else if(!(url.includes('/funTorahStudentAuth')&&['login','verify'].includes(body.action)) && !(url.includes('/funTorahManageStudents')&&body.action==='list'))return Promise.reject(Error('Preview: this data-changing service is disabled.'));
 }return originalFetch(input,options);};
document.addEventListener('DOMContentLoaded',()=>{const notice=document.createElement('div');notice.textContent='PR #234 TEST PREVIEW · only named temporary test saves allowed';notice.style.cssText='position:fixed;bottom:0;left:0;z-index:2147483647;background:#fff2af;color:#171717;font:700 12px system-ui;padding:5px 9px;pointer-events:none';document.body.append(notice);});
})();

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


// Load the shared student-only Add to Gallery button in every activity that
// already loads Firebase configuration. Button waits for a live verified API.
(function () {
  if (typeof document === 'undefined' || window.__fttGalleryShareLoading) return;
  window.__fttGalleryShareLoading = true;
  const current = document.currentScript;
  if (!current || !current.src) return;
  const loader = document.createElement('script');
  loader.src = new URL('gallery-share.js?v=20261011b', current.src).href;
  loader.async = true;
  (document.head || document.documentElement).appendChild(loader);
})();
