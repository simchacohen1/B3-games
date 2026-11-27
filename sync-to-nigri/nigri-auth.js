/* Shared helper: sends the owner's Google sign-in proof (a Firebase ID token) to the Nigri sync server.
   Sign-in is tried first. A caller may pass the old shared key as a fallback; it is used only when there is
   no sign-in or the server answers 401 (refused before doing anything), so a failed sign-in never stops work.
   Nothing here stores or logs the token or the key. */
(function () {
  'use strict';
  const BASE = 'https://nigrisync.onrender.com';

  // The sync service sleeps when idle and needs up to a minute to wake (first open of the day). Ask it to wake as
  // soon as the page loads, and make every call wait for it, instead of failing and needing a refresh.
  const WAKE_LIMIT_MS = 120000;
  let wakePromise = null;
  function wake() {
    if (wakePromise) return wakePromise;
    wakePromise = (async () => {
      if (typeof fetch !== 'function') return false;
      const stop = Date.now() + WAKE_LIMIT_MS;
      while (Date.now() < stop) {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), 20000) : null;
        try {
          const res = await fetch(BASE + '/health', { cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined });
          if (res.status < 500) return true;          // any real answer from the app (not the host's "waking" page)
        } catch (error) { /* still waking or offline: try again */ }
        finally { if (timer) clearTimeout(timer); }
        await new Promise(r => setTimeout(r, 2000));
      }
      return false;
    })();
    wakePromise.then(ok => { if (!ok) wakePromise = null; });   // a failed wake may be tried again later
    return wakePromise;
  }
  // Waits until the service is awake. onConnecting() is called once if that takes more than a moment, so the page can say "Connecting…".
  async function ensureAwake(onConnecting) {
    const p = wake();
    const timer = onConnecting ? setTimeout(() => { try { onConnecting(); } catch (e) {} }, 1200) : null;
    try { return await p; } finally { if (timer) clearTimeout(timer); }
  }
  function resetWake() { wakePromise = null; }
  wake();

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
          const timer = setTimeout(() => { if (off) off(); resolve(null); }, 10000);
          off = auth.onAuthStateChanged(current => { clearTimeout(timer); if (off) off(); resolve(current); });
        });
      }
      return user ? await user.getIdToken() : null;
    } catch (error) { return null; }
  }

  // Calls the server. Returns { response, via } where via is 'signin', 'key' or 'none' (response is null for 'none').
  async function request(path, options, fallbackKey, onConnecting) {
    const base = options || {};
    const headers = base.headers || {};
    await ensureAwake(onConnecting);
    const token = await getToken();
    let first = null;
    if (token) {
      first = await fetch(BASE + path, { ...base, headers: { ...headers, Authorization: 'Bearer ' + token } });
      // 502/503 come from the host while the service is still starting: nothing was processed, so one retry is safe.
      if (first.status === 502 || first.status === 503) {
        resetWake(); await ensureAwake(onConnecting);
        first = await fetch(BASE + path, { ...base, headers: { ...headers, Authorization: 'Bearer ' + token } });
      }
      if (first.status !== 401) return { response: first, via: 'signin' };
    }
    if (fallbackKey) {
      const second = await fetch(BASE + path, { ...base, headers: { ...headers, 'X-Sync-Key': fallbackKey } });
      return { response: second, via: 'key' };
    }
    return first ? { response: first, via: 'signin' } : { response: null, via: 'none' };
  }

  window.NigriAuth = { BASE, getToken, request, wake: ensureAwake };
})();
