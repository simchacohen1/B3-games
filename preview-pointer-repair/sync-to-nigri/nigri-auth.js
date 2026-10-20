/* Shared helper: sends the owner's Google sign-in proof (a Firebase ID token) to the Nigri sync server.
   Sign-in is tried first. A caller may pass the old shared key as a fallback; it is used only when there is
   no sign-in or the server answers 401 (refused before doing anything), so a failed sign-in never stops work.
   Nothing here stores or logs the token or the key. */
(function () {
  'use strict';
  const BASE = 'https://nigrisync.onrender.com';

  function firebaseAuth() {
    try {
      if (!window.firebase || !window.firebase.auth) return null;
      const app = window.firebase.apps.length ? window.firebase.app() : window.firebase.initializeApp(window.B3_FIREBASE_CONFIG);
      return app.auth();
    } catch (error) { return null; }
  }

  // Returns the current ID token, or null if nobody is signed in (or Firebase is unavailable).
  async function getToken() {
    const auth = firebaseAuth();
    if (!auth) return null;
    try {
      let user = auth.currentUser;
      if (!user) {
        user = await new Promise(resolve => {
          let off = null;
          const timer = setTimeout(() => { if (off) off(); resolve(null); }, 3000);
          off = auth.onAuthStateChanged(current => { clearTimeout(timer); if (off) off(); resolve(current); });
        });
      }
      return user ? await user.getIdToken() : null;
    } catch (error) { return null; }
  }

  // Calls the server. Returns { response, via } where via is 'signin', 'key' or 'none' (response is null for 'none').
  async function request(path, options, fallbackKey) {
    const base = options || {};
    const headers = base.headers || {};
    const token = await getToken();
    let first = null;
    if (token) {
      first = await fetch(BASE + path, { ...base, headers: { ...headers, Authorization: 'Bearer ' + token } });
      if (first.status !== 401) return { response: first, via: 'signin' };
    }
    if (fallbackKey) {
      const second = await fetch(BASE + path, { ...base, headers: { ...headers, 'X-Sync-Key': fallbackKey } });
      return { response: second, via: 'key' };
    }
    return first ? { response: first, via: 'signin' } : { response: null, via: 'none' };
  }

  window.NigriAuth = { BASE, getToken, request };
})();
