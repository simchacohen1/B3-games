/* Lab-only stand-in for the Firebase compat SDK. Every database call is
   forwarded to window.__labDb (exposed by the Playwright runner), which applies
   the selected RTDB rules to synthetic data. Never ship this file. */
(function () {
  'use strict';
  if (window.firebase && window.firebase.__lab) return;
  const listeners = new Set();
  const apps = [];
  const split = p => String(p || '').split('/').filter(Boolean);
  const pick = (v, p) => { let n = v; for (const k of split(p)) n = n == null ? null : n[k]; return n === undefined ? null : n; };
  let pushN = 0;
  const pushKey = () => '-Lab' + Date.now().toString(36) + (pushN++).toString(36).padStart(4, '0');
  function snap(path, value) {
    return {
      key: split(path).at(-1) || null,
      val: () => value === undefined ? null : JSON.parse(JSON.stringify(value)),
      exists: () => value !== null && value !== undefined,
      child: c => snap(split(path).concat(split(c)).join('/'), pick(value, c)),
      hasChild: c => pick(value, c) !== null,
      numChildren: () => value && typeof value === 'object' ? Object.keys(value).length : 0,
      forEach(cb) { if (value && typeof value === 'object') for (const k of Object.keys(value)) if (cb(snap(path + '/' + k, value[k])) === true) return true; return false; },
      toJSON: () => value
    };
  }
  function permission() { const e = new Error('PERMISSION_DENIED: Permission denied'); e.code = 'PERMISSION_DENIED'; return e; }
  function makeAuth(app) {
    const storeKey = '__labAuth:' + app.name;
    let user = null;
    const subs = new Set();
    const toUser = token => { const claims = JSON.parse(atob(token.slice(5).replace(/-/g, '+').replace(/_/g, '/'))); return {
      uid: claims.uid, isAnonymous: false, email: claims.email || null, emailVerified: !!claims.email_verified,
      providerData: [], getIdToken: async () => token, getIdTokenResult: async () => ({ token, claims }), __token: token }; };
    try { const t = sessionStorage.getItem(storeKey); if (t) user = toUser(t); } catch (_) {}
    const emit = () => subs.forEach(cb => { try { cb(user); } catch (e) { console.error(e); } });
    const auth = {
      app, get currentUser() { return user; },
      onAuthStateChanged(cb) { subs.add(cb); setTimeout(() => subs.has(cb) && cb(user), 0); return () => subs.delete(cb); },
      onIdTokenChanged(cb) { return auth.onAuthStateChanged(cb); },
      authStateReady: async () => {},
      setPersistence: async () => {},
      async signInWithCustomToken(token) { user = toUser(token); try { sessionStorage.setItem(storeKey, token); } catch (_) {} emit(); return { user }; },
      async updateCurrentUser(u) { user = u; emit(); },
      async signOut() { user = null; try { sessionStorage.removeItem(storeKey); } catch (_) {} emit(); },
      signInWithPopup: async () => { throw new Error('Google sign-in is not available in the lab.'); },
      signInWithRedirect: async () => { throw new Error('Google sign-in is not available in the lab.'); },
      getRedirectResult: async () => ({ user: null })
    };
    return auth;
  }
  function makeDb(app) {
    const token = () => app.auth().currentUser && app.auth().currentUser.__token || null;
    const call = async (op, path, value) => {
      const r = await window.__labDb(JSON.stringify({ op, path, value, token: token() }));
      const res = JSON.parse(r);
      if (!res.ok) throw permission();
      return res.value;
    };
    function ref(path) {
      path = split(path).join('/');
      const r = {
        key: split(path).at(-1) || null,
        get parent() { return ref(split(path).slice(0, -1).join('/')); },
        get root() { return ref(''); },
        toString: () => 'lab://' + path,
        child: c => ref(split(path).concat(split(c)).join('/')),
        orderByChild: () => r, orderByKey: () => r, orderByValue: () => r, equalTo: () => r, startAt: () => r, endAt: () => r, limitToLast: () => r, limitToFirst: () => r,
        async once(_ev, cb, errCb) { try { const s = snap(path, await call('read', path)); if (typeof cb === 'function') cb(s); return s; } catch (e) { if (typeof errCb === 'function') errCb(e); throw e; } },
        get: async () => snap(path, await call('read', path)),
        on(ev, cb, errCb) { if (ev !== 'value') return cb; call('read', path).then(v => cb(snap(path, v)), e => typeof errCb === 'function' && errCb(e)); listeners.add(cb); return cb; },
        off(_ev, cb) { listeners.delete(cb); },
        set: async v => { await call('write', path, v === undefined ? null : v); },
        update: async v => { await call('update', path, v); },
        remove: async () => { await call('write', path, null); },
        push(v) { const child = ref(path + '/' + pushKey()); if (v === undefined) return child; const p = child.set(v).then(() => child); child.then = p.then.bind(p); child.catch = p.catch.bind(p); return child; },
        async transaction(fn) { const cur = await call('read', path); const next = fn(cur); if (next === undefined) return { committed: false, snapshot: snap(path, cur) }; await call('write', path, next); return { committed: true, snapshot: snap(path, next) }; },
        onDisconnect: () => ({ set: async () => {}, remove: async () => {}, update: async () => {}, cancel: async () => {} }),
        isEqual: o => o && o.toString && o.toString() === r.toString()
      };
      return r;
    }
    return { app, ref: p => ref(p || ''), goOffline() {}, goOnline() {} };
  }
  function initializeApp(options, name) {
    name = name || '[DEFAULT]';
    if (apps.some(a => a.name === name)) throw new Error('Firebase App named ' + name + ' already exists');
    const app = { name, options };
    let a, d;
    app.auth = () => a || (a = makeAuth(app));
    app.database = () => d || (d = makeDb(app));
    app.delete = async () => { apps.splice(apps.indexOf(app), 1); };
    apps.push(app);
    return app;
  }
  const appFor = name => { const a = apps.find(x => x.name === (name || '[DEFAULT]')); if (!a) throw new Error('No Firebase App ' + (name || '[DEFAULT]')); return a; };
  const auth = n => appFor(n && n.name).auth();
  auth.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };
  auth.GoogleAuthProvider = function () { this.setCustomParameters = () => {}; this.addScope = () => {}; };
  const database = n => appFor(n && n.name).database();
  database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' }, increment: n => n };
  window.firebase = { __lab: true, SDK_VERSION: '9.23.0', apps, initializeApp, app: appFor, auth, database };
})();
