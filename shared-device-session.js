/* Shared-device handoff: never leave a teacher's Firebase ID token active
 * while a student uses the computer. Distinct from teacher-only demo mode. */
(function(root){
  "use strict";
  const SITE_ROOT=(function(){
    try{return new URL(".",document.currentScript.src).href;}
    catch(_){return new URL(".",location.href).href;}
  })();
  let busy=false;
  function wipeStudentSession(){
    try { sessionStorage.clear(); } catch(_) {}
    try {
      localStorage.removeItem("b3TeacherWasSignedIn");
      localStorage.removeItem("b3TeacherBypass");
      localStorage.removeItem("b3TeacherEmailLinkPending");
    } catch(_) {}
  }
  async function switchUser(target,auth){
    if(target!=="student"&&target!=="teacher")throw Error("Unknown account type.");
    if(busy)throw Error("Account switch is already in progress.");
    if(!auth||typeof auth.signOut!=="function")
      throw Error("Secure sign-out is unavailable. Please close this browser and try again.");
    busy=true;
    try{
      // Must succeed BEFORE navigating. Do not rely on a tab-local flag:
      // teacher tokens in other tabs could otherwise authorize writes.
      await auth.signOut();
      wipeStudentSession();
      location.assign(SITE_ROOT+(target==="student"?"index.html?sharedDevice=student":"teacher-home.html?sharedDevice=teacher"));
    }finally{busy=false;}
  }
  root.B3SharedDevice={switchToStudent(auth){return switchUser("student",auth)},
    switchToTeacher(auth){return switchUser("teacher",auth)},
    wipeStudentSession};
})(typeof window==="object"?window:globalThis);
