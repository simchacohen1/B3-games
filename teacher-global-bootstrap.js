/* Optional teacher toolbar bootstrap for standalone pages without Firebase imports. */
(function () {
  'use strict';
  if (window.self !== window.top || window.__fttTeacherBootstrap) return;
  window.__fttTeacherBootstrap = true;
  var current = document.currentScript;
  var base = new URL('./', current && current.src || location.href);
  function add(src) {
    return new Promise(function(resolve,reject) {
      var tag = document.createElement('script');
      tag.src = src; tag.onload = resolve;
      tag.onerror = function(){ reject(new Error('Could not load '+src)); };
      document.head.appendChild(tag);
    });
  }
  async function ensure(test, filename) {
    if (test()) return;
    try { await add('https://www.gstatic.com/firebasejs/12.15.0/'+filename); }
    catch (_) { await add(new URL('vendor/firebase/12.15.0/'+filename,base).href); }
  }
  async function start() {
    await ensure(function(){return !!window.firebase?.initializeApp;},'firebase-app-compat.js');
    await ensure(function(){return !!window.firebase?.auth;},'firebase-auth-compat.js');
    await ensure(function(){return !!window.firebase?.database;},'firebase-database-compat.js');
    if (!window.B3_FIREBASE_CONFIG) {
      // The shared config loads Gallery Share, which in turn loads the toolbar.
      await add(new URL('firebase-config.js',base).href);
    } else if (!window.__fttTeacherToolbarLoading) {
      await add(new URL('teacher-global-controls.js?v=20261020-quickbar',base).href);
    }
  }
  start().catch(function(error){console.warn('Teacher quick controls unavailable:',error);});
})();