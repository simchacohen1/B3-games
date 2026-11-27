/* Shows the "Teacher report" link on the student Chayus Meter page, only to a verified teacher or admin.
   Students never see it. It reads sign-in state only and writes nothing. Uses the site's own copy of the SDK. */
(function () {
  'use strict';
  var a = document.getElementById('teacherReport');
  if (!a) return;
  var here = document.currentScript && document.currentScript.src ? document.currentScript.src : '';
  function abs(p) { return here ? new URL(p, here).href : p; }
  function load(src, ready) {
    if (ready && ready()) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var t = document.createElement('script');
      t.src = src; t.onload = resolve; t.onerror = function () { reject(new Error('load ' + src)); };
      document.head.appendChild(t);
    });
  }
  var V = '../vendor/firebase/12.15.0/';
  load(abs(V + 'firebase-app-compat.js'), function () { return window.firebase; })
    .then(function () { return load(abs(V + 'firebase-auth-compat.js'), function () { return window.firebase.auth; }); })
    .then(function () { return load(abs(V + 'firebase-database-compat.js'), function () { return window.firebase.database; }); })
    .then(function () { return load(abs('../firebase-config.js'), function () { return window.B3_FIREBASE_CONFIG; }); })
    .then(function () { return load(abs('../site-settings.js?v=20261020-demo-student'), function () { return window.B3SiteSettings; }); })
    .then(function () {
      window.B3SiteSettings.onAuthStateChanged(function (user, authorized, access) {
        var ok = !!(user && authorized && access && (access.role === 'admin' || access.role === 'teacher'));
        if (ok) {
          var c = new URLSearchParams(location.search).get('class');
          if (c && /^[A-Za-z0-9_-]{1,100}$/.test(c)) a.href = 'teacher.html?class=' + encodeURIComponent(c);
        }
        a.hidden = !ok;
      });
    })
    .catch(function () { /* stay hidden */ });
})();
