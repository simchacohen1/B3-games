/*
 * Chayus Meter points link. The ONLY thing this file sends anywhere is one number: the counted seconds of the
 * signed-in student's day. No sound, no samples and no transcript ever leave the computer. The server decides
 * the level and pays the points (one per level, at most 10 a day), and never trusts the number blindly.
 * Without a signed-in student (a guest, a teacher preview) it stays quiet and the meter still works on screen.
 */
(function () {
  'use strict';
  if (window.ChayusPoints) return;
  const here = document.currentScript && document.currentScript.src ? document.currentScript.src : '';
  // The site's own copy of the Firebase SDK, so this works on staging (which blocks outside scripts) and live alike.
  const SDK = here ? new URL('../vendor/firebase/12.15.0/', here).href : '../vendor/firebase/12.15.0/';
  const configUrl = here ? new URL('../firebase-config.js', here).href : '../firebase-config.js';
  let authPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = src; tag.async = true;
      tag.onload = resolve; tag.onerror = () => reject(new Error('Could not load ' + src));
      document.head.append(tag);
    });
  }
  function getAuth() {
    if (!authPromise) {
      authPromise = (async () => {
        if (!window.firebase) await loadScript(SDK + 'firebase-app-compat.js');
        if (!window.firebase.auth) await loadScript(SDK + 'firebase-auth-compat.js');
        if (!window.B3_FIREBASE_CONFIG) await loadScript(configUrl);
        if (!window.firebase.apps.length) window.firebase.initializeApp(window.B3_FIREBASE_CONFIG);
        return window.firebase.auth();
      })();
      authPromise.catch(() => { authPromise = null; });
    }
    return authPromise;
  }
  async function currentUser() {
    const auth = await getAuth();
    if (auth.currentUser) return auth.currentUser;
    return new Promise(resolve => {
      let done = false;
      const finish = user => { if (!done) { done = true; resolve(user || null); } };
      const off = auth.onAuthStateChanged(user => { off(); finish(user); });
      setTimeout(() => finish(auth.currentUser), 4000);
    });
  }
  function endpoint() {
    const app = window.firebase && window.firebase.apps && window.firebase.apps[0];
    const projectId = (app && app.options && app.options.projectId) || (window.B3_FIREBASE_CONFIG && window.B3_FIREBASE_CONFIG.projectId);
    if (!projectId) throw new Error('Firebase is not configured on this page.');
    return 'https://us-central1-' + projectId + '.cloudfunctions.net/studentRewardsAutoAward';
  }
  async function call(body) {
    const user = await currentUser();
    if (!user) return { ok: false, signedOut: true, error: 'Sign in from the home page to save your Chayus points.' };
    const token = await user.getIdToken();
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status, error: data.error || ('HTTP ' + response.status) };
    return data;
  }

  window.ChayusPoints = {
    // Today's saved counted seconds, level and points for this student.
    status: () => call({ action: 'chayus-status' }).catch(error => ({ ok: false, error: String(error && error.message || error) })),
    // Reports the day's running counted-seconds total (a single number).
    report: countedSeconds => call({ action: 'chayus-report', countedSeconds: Math.max(0, Math.round(Number(countedSeconds) * 10) / 10) })
      .catch(error => ({ ok: false, error: String(error && error.message || error) }))
  };
})();
