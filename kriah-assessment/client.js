(function (root) {
  'use strict';
  const PROJECT = 'fun-torah-tools-staging';
  const host = root.location.hostname;
  const fixture = /^(localhost|127\.0\.0\.1)$/.test(host) && new URLSearchParams(root.location.search).get('fixture') === '1';
  const staging = host === PROJECT + '.web.app' || /^fun-torah-tools-staging--kriah-624-[a-z0-9-]+\.web\.app$/.test(host);
  const ENDPOINT = 'https://us-central1-' + PROJECT + '.cloudfunctions.net/kriahAssessment';
  let auth = null, actor = 'teacherA';
  function uid() { return fixture ? 'fixture-' + actor : auth?.currentUser?.uid || ''; }
  async function init(onIdentity) {
    if (fixture) { await onIdentity(uid()); return; }
    if (!staging) throw new Error('This center is available only on the isolated staging site or the local fictional demo.');
    // Never import the production firebase-config.js.
    await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '../staging/firebase-config.generated.js'; script.onload = resolve; script.onerror = () => reject(new Error('Staging Firebase configuration is missing.')); document.head.append(script); });
    const cfg = root.B3_STAGING_FIREBASE_CONFIG;
    if (cfg?.projectId !== PROJECT || cfg.authDomain !== PROJECT + '.firebaseapp.com' || cfg.databaseURL !== 'https://' + PROJECT + '-default-rtdb.firebaseio.com' || ![PROJECT + '.firebasestorage.app', PROJECT + '.appspot.com'].includes(cfg.storageBucket)) throw new Error('Refused non-staging configuration.');
    if (!root.firebase) throw new Error('Firebase sign-in library could not load.');
    if (firebase.apps.length && firebase.app().options.projectId !== PROJECT) throw new Error('Refused an existing non-staging Firebase session.');
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    auth = app.auth();
    auth.onAuthStateChanged(() => onIdentity(uid()));
  }
  async function call(body, { progress } = {}) {
    const identity = uid();
    if (!identity) throw new Error('Sign in on the staging homepage first.');
    const token = fixture ? null : await auth.currentUser.getIdToken();
    if (uid() !== identity) throw new Error('Account changed. Reload this center.');
    const url = fixture ? '/api/kriah' : ENDPOINT;
    const result = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest(); xhr.open('POST', url); xhr.timeout = 120000;
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (fixture) xhr.setRequestHeader('X-Kriah-Fixture-Actor', actor); else xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      if (progress) xhr.upload.onprogress = e => { if (e.lengthComputable) progress(Math.round(e.loaded * 100 / e.total)); };
      xhr.onload = () => { let data; try { data = JSON.parse(xhr.responseText); } catch (_) { reject(new Error('Server response was interrupted. Retry your saved recording.')); return; } if (xhr.status < 200 || xhr.status >= 300) reject(Object.assign(new Error(data.error || 'Request failed.'), { status: xhr.status })); else resolve(data); };
      xhr.onerror = xhr.ontimeout = () => reject(new Error('Connection interrupted. Your recording or draft is kept here. Try again.'));
      xhr.send(JSON.stringify(body));
    });
    if (uid() !== identity) throw new Error('Account changed. Reload this center.');
    return result;
  }
  function blob64(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Could not read this recording.')); reader.readAsDataURL(blob); }); }
  let dbPromise;
  function db() { if (!dbPromise) dbPromise = new Promise((resolve, reject) => { const request = indexedDB.open('ftt-kriah-fictional-drafts', 1); request.onupgradeneeded = () => request.result.createObjectStore('drafts'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Local recovery storage is unavailable. Keep this page open until saved.')); }); return dbPromise; }
  async function draft(key, value) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('drafts', arguments.length === 1 ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('drafts');
      const scoped = uid() + ':' + key;
      const request = arguments.length === 1 ? store.get(scoped) : value === null ? store.delete(scoped) : store.put(value, scoped);
      transaction.oncomplete = () => resolve(request.result); transaction.onerror = () => reject(new Error('Could not save recovery draft. Keep this page open.'));
    });
  }
  async function clearDrafts() {
    const database = await db(), prefix = uid() + ':';
    await new Promise((resolve, reject) => { const tx = database.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts'), req = store.openCursor(); req.onsuccess = () => { const cursor = req.result; if (cursor) { if (String(cursor.key).startsWith(prefix)) cursor.delete(); cursor.continue(); } }; tx.oncomplete = resolve; tx.onerror = reject; });
  }
  root.KriahClient = { fixture, staging, init, call, uid, blob64, draft, clearDrafts, async chooseActor(value) { actor = value; }, async signIn() { await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }, async signOut() { await clearDrafts(); if (auth) await auth.signOut(); } };
})(window);
