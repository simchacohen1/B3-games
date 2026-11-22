/* One Google sign-in for every teacher/owner page.
 *
 * Pages that used their own Google popup only signed in this tab, so the next
 * page or tab asked for Google again. B3SiteSettings.signInWithGoogle() also
 * saves the login to the remembered teacher app, so every page restores it.
 *
 * window.B3TeacherSignIn() loads site-settings.js (and the Firebase database
 * library it needs) only if the page has not loaded them already, then calls
 * B3SiteSettings.signInWithGoogle(). It resolves to the signed-in user, or
 * null when Google sends the browser away and back (redirect sign-in).
 */
(function () {
  'use strict';
  var BASE = (function () {
    try { return new URL('.', document.currentScript.src).href; } catch (e) { return ''; }
  })();
  var SETTINGS_VERSION = '20261020-demo-student';

  function load(src) {
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = src; tag.onload = resolve;
      tag.onerror = function () { reject(new Error('Sign-in could not load. Check your connection and try again.')); };
      document.head.appendChild(tag);
    });
  }

  function ready() {
    var chain = Promise.resolve();
    if (!window.firebase || !window.firebase.auth) return Promise.reject(new Error('Firebase sign-in is not available on this page.'));
    if (!window.firebase.database) chain = chain.then(function () { return load(BASE + 'vendor/firebase/12.15.0/firebase-database-compat.js'); });
    if (!window.B3SiteSettings) chain = chain.then(function () { return load(BASE + 'site-settings.js?v=' + SETTINGS_VERSION); });
    return chain.then(function () {
      if (!window.B3SiteSettings || !window.B3SiteSettings.signInWithGoogle) throw new Error('Sign-in could not load.');
      return window.B3SiteSettings;
    });
  }

  window.B3TeacherSignIn = function () {
    return ready().then(function (settings) { return settings.signInWithGoogle(); });
  };
})();
