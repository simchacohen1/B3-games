/* Nigri pages: show the page only to the owner and to teachers whose school has
 * "Syncs to Nigri" on. Everyone else sees a short message instead.
 *
 * Load it as the first script in <head>:  <script src=".../sync-to-nigri/nigri-school-gate.js"></script>
 * Add data-mode="panel" to leave the page alone and only expose window.B3NigriGate.ready
 * (used by pages where Nigri is one part of a bigger page, e.g. Weekly Quiz Results).
 *
 * This is a display rule only. The NigriSync server makes the same check itself.
 */
(function () {
  'use strict';
  if (window.B3NigriGate) return;
  const script = document.currentScript;
  const base = new URL('../', script && script.src || location.href); // site root
  const panelOnly = !!(script && script.dataset.mode === 'panel');
  // data-owner-only="1": older pages that still sync with the service's own account; teachers use School Marks instead.
  const ownerOnly = !!(script && script.dataset.ownerOnly === '1');
  let settle;
  const ready = new Promise(resolve => { settle = resolve; });
  window.B3NigriGate = { ready };

  const COVER_ID = 'fttNigriGate';
  if (!panelOnly) {
    const style = document.createElement('style');
    style.textContent = 'html.ftt-nigri-locked body>*:not(#' + COVER_ID + '){display:none!important}' +
      '#' + COVER_ID + '{font-family:Arial,sans-serif;max-width:520px;margin:12vh auto;padding:24px;background:#fff;border:1px solid #bdd5e8;border-radius:14px;color:#18324a;text-align:center}' +
      '#' + COVER_ID + ' a,#' + COVER_ID + ' button{display:inline-block;margin-top:14px;padding:10px 16px;border-radius:9px;border:0;background:#2d6ea3;color:#fff;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}';
    document.head.appendChild(style);
    document.documentElement.classList.add('ftt-nigri-locked');
  }

  function cover(text, withSignIn) {
    if (panelOnly) return;
    const show = () => {
      let box = document.getElementById(COVER_ID);
      if (!box) { box = document.createElement('div'); box.id = COVER_ID; document.body.prepend(box); }
      box.textContent = '';
      const p = document.createElement('p'); p.textContent = text; box.appendChild(p);
      if (withSignIn) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Sign in with Google';
        b.onclick = () => window.firebase.auth().signInWithPopup(new window.firebase.auth.GoogleAuthProvider()).catch(() => {});
        box.appendChild(b);
      } else {
        const a = document.createElement('a'); a.href = new URL('index.html', base).href; a.textContent = 'Back to Fun Torah Tools'; box.appendChild(a);
      }
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
  }
  function unlock() {
    const box = document.getElementById(COVER_ID); if (box) box.remove();
    document.documentElement.classList.remove('ftt-nigri-locked');
  }

  function add(src) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script'); tag.src = src; tag.onload = resolve;
      tag.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(tag);
    });
  }
  // Use the page's own Firebase if it has one; otherwise load the site's copy.
  async function ensure(test, file) {
    if (test()) return;
    await add(new URL('vendor/firebase/12.15.0/' + file, base).href);
  }
  async function firebaseApp() {
    // Give the page's own <script> tags a moment to define Firebase first.
    if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
    // Pages using teacher-global-bootstrap.js load Firebase themselves a moment later;
    // wait for that instead of loading a second copy at the same time.
    // The Teacher Tools gate loads Firebase itself; wait for it so a second copy is not loaded over the first.
    if (window.__b3TeacherGateReady) { try { await window.__b3TeacherGateReady; } catch (e) { /* fall through to the checks below */ } }
    const loaded = () => !!(window.firebase && window.firebase.initializeApp && window.firebase.auth && window.firebase.database);
    if (document.querySelector('script[src*="teacher-global-bootstrap.js"]')) {
      for (let i = 0; i < 50 && !(loaded() && window.B3_FIREBASE_CONFIG); i++) await new Promise(r => setTimeout(r, 100));
    }
    await ensure(() => !!(window.firebase && window.firebase.initializeApp), 'firebase-app-compat.js');
    await ensure(() => !!window.firebase.auth, 'firebase-auth-compat.js');
    await ensure(() => !!window.firebase.database, 'firebase-database-compat.js');
    if (!window.firebase.apps.length && !window.B3_FIREBASE_CONFIG) await add(new URL('firebase-config.js', base).href);
    if (!window.B3SchoolScope) await add(new URL('school-scope.js?v=20261107', base).href);
    return window.firebase.apps.length ? window.firebase.app() : window.firebase.initializeApp(window.B3_FIREBASE_CONFIG);
  }

  async function start() {
    const app = await firebaseApp();
    const auth = app.auth();
    const db = app.database();
    const workspaceId = (window.B3_APP_CONTEXT && window.B3_APP_CONTEXT.workspaceId) || 'b3-2026';
    let first = true;
    auth.onAuthStateChanged(async user => {
      if (!user) {
        cover(window.B3SchoolScope.message('signed-out'), true);
        if (first) { first = false; settle({ allowed: false, reason: 'signed-out' }); }
        return;
      }
      let result = await window.B3SchoolScope.checkNigri({ db, user, workspaceId });
      if (ownerOnly && result.allowed && result.reason !== 'owner') result = Object.assign({}, result, { allowed: false, reason: 'owner-only' });
      if (result.allowed) unlock();
      else cover(result.reason === 'owner-only' ? 'This older page is for the owner. Use School Marks → Nigri to sync your marks.' : window.B3SchoolScope.message(result.reason), false);
      window.B3NigriGate.result = result;
      if (first) { first = false; settle(result); }
    });
  }
  start().catch(error => {
    console.warn('Nigri school check unavailable:', error);
    cover('Could not check your school right now. Refresh the page to try again.', false);
    settle({ allowed: false, reason: 'check-failed' });
  });
})();
