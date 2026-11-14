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
  async function refresh() { busy(true); render(await C.status(env)); busy(false); }

  $('form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var u = user.value.trim(), p = pass.value;
    if (!u || !p) { msg.textContent = 'Enter both your Nigri username and password.'; msg.className = 'error'; return; }
    busy(true); msg.textContent = 'Saving…'; msg.className = '';
    var r = await C.save(env, u, p);
    pass.value = ''; if (r.ok) user.value = '';   // the password never stays on the page
    render(r); if (r.ok) msg.textContent = 'Saved. Your password is locked on the server and cannot be shown again.';
    busy(false);
  });
  $('remove').addEventListener('click', async function () {
    if (!confirm('Remove your saved Nigri login?')) return;
    busy(true); var r = await C.remove(env); render(r); if (r.ok) msg.textContent = 'Removed.'; busy(false);
  });
  $('signin').addEventListener('click', async function () {
    try { await auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()); } catch (e) { /* refresh shows the state */ }
    refresh();
  });
  refresh();
})();
