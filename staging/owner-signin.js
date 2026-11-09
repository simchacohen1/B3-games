/*
 * Staging only (issue #710): one-click "Sign in as staging owner" button for
 * the Owner Admin sign-in box.
 *
 * The live owner-admin.html never loads this file: the script tag is added
 * only to the packaged staging copy by staging/prepare-site.cjs. As a second
 * lock, the script does nothing unless the page is on the staging site and
 * connected to the staging Firebase project. The server side is a function
 * that exists only in the staging project and can only sign in the fictional
 * staging owner account.
 */
(function (root) {
  'use strict';

  var PROJECT = 'fun-torah-tools-staging';
  var HOST = 'fun-torah-tools-staging.web.app';
  var ENDPOINT = 'https://us-central1-' + PROJECT + '.cloudfunctions.net/stagingOwnerSignIn';

  function projectOf(config) { return config && typeof config === 'object' ? config.projectId : undefined; }

  // Every check must pass. Anything missing or unexpected means "not staging".
  function isStagingSite(win) {
    try {
      var loc = win.location;
      if (!loc || loc.protocol !== 'https:' || String(loc.hostname).toLowerCase() !== HOST) return false;
      if (win.B3_STAGING_MODE !== true) return false;
      if (projectOf(win.B3_STAGING_FIREBASE_CONFIG) !== PROJECT || projectOf(win.B3_FIREBASE_CONFIG) !== PROJECT) return false;
      var fb = win.firebase;
      if (!fb || !fb.apps || !fb.apps.length || typeof fb.auth !== 'function') return false;
      return projectOf(fb.app().options) === PROJECT;
    } catch (_) { return false; }
  }

  function mount(win) {
    if (!isStagingSite(win)) return false;
    var doc = win.document;
    var gate = doc.getElementById('gate');
    if (!gate || doc.getElementById('stagingOwnerSignIn')) return false;

    var box = doc.createElement('div');
    box.style.cssText = 'margin-top:18px;padding-top:16px;border-top:1px dashed #e4c46e';
    var button = doc.createElement('button');
    button.type = 'button';
    button.id = 'stagingOwnerSignIn';
    button.textContent = 'Sign in as staging owner';
    button.style.cssText = 'background:#b45309';
    var note = doc.createElement('p');
    note.id = 'stagingOwnerSignInMsg';
    note.setAttribute('role', 'status');
    note.style.cssText = 'margin:10px 0 0;font-size:14px;color:#754d00';
    var idle = 'Staging only. Signs in as the fictional test owner.';
    note.textContent = idle;
    box.appendChild(button);
    box.appendChild(note);
    gate.appendChild(box);

    button.addEventListener('click', function () {
      if (!isStagingSite(win)) return;
      button.disabled = true;
      note.textContent = 'Signing in…';
      win.fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (data) {
            if (!response.ok || !data || typeof data.customToken !== 'string') {
              throw new Error((data && data.error) || 'The staging sign-in service did not answer.');
            }
            return win.firebase.auth().signInWithCustomToken(data.customToken);
          });
        })
        .then(function () { note.textContent = idle; button.disabled = false; })
        .catch(function (error) {
          if (win.console) win.console.error(error);
          note.textContent = 'Could not sign in as staging owner. ' + ((error && error.message) || 'Please try again.');
          button.disabled = false;
        });
    });
    return true;
  }

  var api = { PROJECT: PROJECT, HOST: HOST, ENDPOINT: ENDPOINT, isStagingSite: isStagingSite, mount: mount };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  if (!root || !root.document) return;
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', function () { mount(root); }, { once: true });
  else mount(root);
})(typeof window !== 'undefined' ? window : globalThis);
