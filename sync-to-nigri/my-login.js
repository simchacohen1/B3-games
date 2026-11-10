/* Screen logic for sync-to-nigri/my-login.html (staging only). Never stores the password anywhere. */
(function () {
  'use strict';
  var C = window.NigriLoginClient, $ = function (id) { return document.getElementById(id); };
  if (!C.isStagingHost(location.hostname)) { $('blocked').hidden = false; return; }
  var base = C.serverBase(location, window.NIGRI_LOGIN_SERVER);
  if (!base) { $('noServer').hidden = false; return; }
  $('staging').hidden = false;

  function auth() {
    try {
      var app = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.B3_FIREBASE_CONFIG);
      return app.auth();
    } catch (e) { return null; }
  }
  var env = {
    base: base, fetch: function () { return window.fetch.apply(window, arguments); },
    getToken: async function () {
      var a = auth(); if (!a) return null;
      var user = a.currentUser || await new Promise(function (resolve) {
        var off = a.onAuthStateChanged(function (u) { off(); resolve(u); });
        setTimeout(function () { off(); resolve(null); }, 3000);
      });
      return user ? user.getIdToken() : null;
    }
  };
  var msg = $('msg'), state = $('state'), user = $('username'), pass = $('password');
  function busy(on) { ['save', 'remove'].forEach(function (id) { $(id).disabled = on; }); }
  function render(r) {
    if (!r.ok) { msg.textContent = r.message; msg.className = 'error'; return; }
    msg.textContent = ''; msg.className = '';
    state.textContent = r.text;
    $('remove').hidden = !r.saved;
    $('save').textContent = r.saved ? 'Replace my Nigri login' : 'Save my Nigri login';
  }
  async function refresh() { busy(true); render(await C.status(env)); busy(false); loadClasses(); }

  // His own classes come from his teacher record; the server re-checks every class, so this list is only a convenience.
  var pick = $('classPick'), gradeLine = $('gradeLine'), list = $('courseList'), WS = 'b3-2026';
  async function loadClasses() {
    try {
      var a = auth(); var u = a && a.currentUser; if (!u) { pick.innerHTML = ''; return; }
      var db = firebase.database(); var root = 'b3Games/workspaces/' + WS;
      var ids = Object.keys((await db.ref(root + '/teachers/' + u.uid + '/classIds').once('value')).val() || {});
      var opts = await Promise.all(ids.map(async function (id) {
        var name = (await db.ref(root + '/classes/' + id + '/name').once('value')).val();
        var o = document.createElement('option'); o.value = id; o.textContent = name || id; return o;
      }));
      pick.innerHTML = ''; opts.forEach(function (o) { pick.appendChild(o); });
      showCourses();
    } catch (e) { pick.innerHTML = ''; gradeLine.textContent = 'Could not load your classes.'; }
  }
  async function showCourses() {
    list.innerHTML = ''; gradeLine.textContent = '';
    if (!pick.value) return;
    var r = await C.courses(env, pick.value);
    if (!r.ok) { gradeLine.textContent = r.message; return; }
    gradeLine.textContent = 'Nigri grade: ' + r.grade;
    r.courses.forEach(function (c) { var li = document.createElement('li'); li.textContent = C.courseLine(c); list.appendChild(li); });
  }
  pick.addEventListener('change', showCourses);

  $('form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var u = user.value.trim(), p = pass.value;
    if (!u || !p) { msg.textContent = 'Enter both your Nigri username and password.'; msg.className = 'error'; return; }
    busy(true); msg.textContent = 'Saving…'; msg.className = '';
    var r = await C.save(env, u, p);
    pass.value = ''; if (r.ok) user.value = '';   // the password never stays on the page
    render(r); if (r.ok) msg.textContent = 'Saved. Your password is locked on the server and cannot be shown again.';
    busy(false); if (r.ok) showCourses();   // which classes his login can see may have changed
  });
  $('remove').addEventListener('click', async function () {
    if (!confirm('Remove your saved Nigri login?')) return;
    busy(true); var r = await C.remove(env); render(r); if (r.ok) msg.textContent = 'Removed.'; busy(false); if (r.ok) showCourses();
  });
  $('signin').addEventListener('click', async function () {
    try { await auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()); } catch (e) { /* refresh shows the state */ }
    refresh();
  });
  refresh();
})();
