/*
 * Student lock check. Every student page loads this one file, with the feature it is:
 *     <script defer src="../student-lock.js?v=..." data-feature="gematria"></script>
 * (data-feature="home" is the student home page: it never covers itself, it puts a lock on the locked tiles.)
 *
 * It follows the locks of ALL the student's classes (so of all his teachers) live. The moment a feature is locked, even
 * for a student already inside the page, the page is covered by "Locked by your teacher" (within about a second of the
 * change reaching the browser); when it opens again the cover goes away. The rules are in student-lock-core.js.
 *
 * If the lock data cannot be read (no internet) the last known state is kept; with none, the page stays open (the server
 * refuses the actions that matter, for example in the Arcade).
 */
(function () {
  'use strict';
  if (window.__b3StudentLockLoaded) return;
  window.__b3StudentLockLoaded = true;
  var script = document.currentScript;
  var feature = script && script.getAttribute('data-feature') || '';
  // A page that serves two tiles (practice and ?mode=quiz) names the quiz tile's feature in data-feature-quiz.
  var featureQuiz = script && script.getAttribute('data-feature-quiz') || '';
  if (featureQuiz) { try { var qp = new URLSearchParams(location.search); if (qp.get('mode') === 'quiz' || qp.get('tool') === 'test-me') feature = featureQuiz; } catch (e) { /* practice tile */ } }
  var base = new URL('./', script && script.src || location.href);
  var WS = 'b3-2026', FB = 'https://www.gstatic.com/firebasejs/12.15.0/';
  var CACHE_KEY = 'b3StudentLockCache', CACHE_MS = 30 * 60 * 1000;
  var listeners = [], locksByClass = {}, studentId = '', states = {}, core = null, started = false, readFailed = false, overrideSignature = '', classPointerLocked = false;

  function load(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = url; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
  }
  function emit() { listeners.slice().forEach(function (fn) { try { fn(states); } catch (e) { /* a listener must not stop the others */ } }); }

  // ---------- the cover ----------
  var cover = null, wasInert = false;
  function showCover() {
    if (!cover) {
      cover = document.createElement('div'); cover.id = 'b3StudentLockCover';
      cover.setAttribute('role', 'alertdialog'); cover.setAttribute('aria-live', 'assertive'); cover.setAttribute('aria-label', 'Locked by your teacher');
      cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;' +
        'background:linear-gradient(160deg,#1e3a8a,#0f172a);color:#fff;text-align:center;font-family:system-ui,Segoe UI,Arial,sans-serif;padding:24px';
      var lock = document.createElement('div'); lock.textContent = '🔒'; lock.style.cssText = 'font-size:96px;line-height:1';
      var title = document.createElement('div'); title.textContent = 'Locked by your teacher'; title.style.cssText = 'font-size:clamp(28px,6vw,52px);font-weight:800';
      cover.append(lock, title);
      if (feature !== 'home') {
        var back = document.createElement('a'); back.href = new URL('index.html', base).href; back.textContent = 'Back to home';
        back.style.cssText = 'margin-top:10px;padding:14px 26px;border-radius:14px;background:#fff;color:#1e3a8a;font-weight:800;font-size:20px;text-decoration:none';
        cover.append(back);
      }
      document.documentElement.appendChild(cover);
    }
    cover.hidden = false;
    if (document.body) {
      if (!document.body.hasAttribute('data-b3-lock-inert')) { wasInert = document.body.inert === true; document.body.setAttribute('data-b3-lock-inert', '1'); }
      document.body.inert = true;
    }
    document.documentElement.style.overflow = 'hidden';
    // Anything playing stops while the page is locked.
    Array.prototype.forEach.call(document.querySelectorAll('audio,video'), function (m) { try { m.pause(); } catch (e) { /* ignore */ } });
  }
  function hideCover() {
    if (cover) cover.hidden = true;
    if (document.body && document.body.hasAttribute('data-b3-lock-inert')) { document.body.removeAttribute('data-b3-lock-inert'); document.body.inert = wasInert; }
    document.documentElement.style.overflow = '';
  }

  // ---------- locked tiles on the student home page ----------
  var TILE_ALIAS = { 'gallery': 'class-gallery', 'tag': 'class-gallery', 'rashi': 'rashi-letters' };
  function decorateTiles() {
    Array.prototype.forEach.call(document.querySelectorAll('.game-card[data-game-id]'), function (card) {
      var id = card.getAttribute('data-tile-key') || card.getAttribute('data-game-id'), f = TILE_ALIAS[id] || id, st = states[f];
      var locked = !!(st && st.locked);
      card.toggleAttribute('data-teacher-locked', locked);
      if (locked) card.setAttribute('aria-disabled', 'true'); else card.removeAttribute('aria-disabled');
      var badge = card.querySelector('.b3-lock-badge');
      if (locked && !badge) {
        badge = document.createElement('span'); badge.className = 'b3-lock-badge'; badge.textContent = '🔒'; badge.setAttribute('aria-label', 'Locked by your teacher');
        badge.style.cssText = 'position:absolute;left:8px;top:8px;font-size:30px;z-index:3;filter:drop-shadow(0 1px 2px #0008)';
        if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
        card.appendChild(badge);
      } else if (!locked && badge) badge.remove();
      card.style.opacity = locked ? '0.55' : '';
    });
  }
  function toast(text) {
    var t = document.getElementById('b3StudentLockToast');
    if (!t) { t = document.createElement('div'); t.id = 'b3StudentLockToast'; t.setAttribute('role', 'status');
      t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483646;background:#0f172a;color:#fff;padding:14px 22px;border-radius:14px;font:700 18px system-ui,sans-serif;box-shadow:0 8px 30px #0006';
      document.documentElement.appendChild(t); }
    t.textContent = text; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(function () { t.hidden = true; }, 2500);
  }
  if (feature === 'home') {
    // A locked tile does not open (capture phase: before the tile's own click handling).
    document.addEventListener('click', function (e) {
      var card = e.target.closest && e.target.closest('.game-card[data-teacher-locked]');
      if (card) { e.preventDefault(); e.stopPropagation(); toast('🔒 Locked by your teacher'); }
    }, true);
    try { new MutationObserver(function () { decorateTiles(); }).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) { /* tiles are still decorated on every check */ }
  }

  // ---------- deciding ----------
  function evaluate() {
    if (!core) return;
    // The locks come from the class the student is in right now (live lesson's class, else the class in session);
    // only when neither applies is a tool locked because ANY of his classes locks it.
    var now = Date.now(), live = String(window.ClassPointerLiveClass || ''),
      current = typeof core.contextClass === 'function' ? core.contextClass(locksByClass, live, now) : null,
      list = current ? [locksByClass[current]] : Object.keys(locksByClass).map(function (k) { return locksByClass[k]; });
    states = core.evaluateStudent(list, now);
    var mine = states[feature];
    if (feature && feature !== 'home' && mine && mine.locked) showCover(); else hideCover();
    // Class Pointer is spread over many pages (lesson overlay, whiteboard, share button), not one page of its own: while it
    // is locked those pieces are hidden everywhere, and the sharing code is told to leave the lesson and stop sharing.
    var pointerLocked = !!(states['class-pointer'] && states['class-pointer'].locked);
    if (pointerLocked !== classPointerLocked) {
      classPointerLocked = pointerLocked;
      var css = document.getElementById('b3ClassPointerLockStyle');
      if (pointerLocked && !css) {
        css = document.createElement('style'); css.id = 'b3ClassPointerLockStyle';
        css.textContent = '#fttActivityScreenShare,#fttTeacherLessonOverlay,#fttShowTeacherLesson,#fttEmbeddedPointerStage,#fttReturnPointerBoard,#fttLessonWaiting,#fttConnectionSign,#fttShareShell{display:none!important}';
        (document.head || document.documentElement).appendChild(css);
      } else if (!pointerLocked && css) css.remove();
      try { window.dispatchEvent(new CustomEvent('b3lock:class-pointer', { detail: { locked: pointerLocked } })); } catch (e) { /* ignore */ }
    }
    // The older page gate (game-gate.js) honours a teacher's temporary unlock; tell it when one starts or ends.
    var sig = Object.keys(states).filter(function (k) { return states[k].kind === 'override-open'; }).join(',');
    if (sig !== overrideSignature) { overrideSignature = sig; try { window.dispatchEvent(new Event('b3lock:override')); } catch (e) { /* ignore */ } }
    if (feature === 'home') decorateTiles();
    emit();
  }
  function remember() {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), id: studentId, locks: locksByClass })); } catch (e) { /* private mode */ }
  }

  // ---------- Firebase ----------
  function firebaseLoading() { return !!document.querySelector('script[src*="firebasejs"],script[src*="firebase-"]'); }
  async function ensureFirebase() {
    // Other scripts on the page may be loading Firebase right now: wait for them instead of loading a second copy.
    for (var i = 0; i < 30 && !(window.firebase && window.firebase.database) && firebaseLoading(); i++) await new Promise(function (r) { setTimeout(r, 200); });
    if (window.B3GameGateAuthReady) { try { await window.B3GameGateAuthReady; } catch (e) { /* carry on */ } }
    var own = false;
    if (!window.firebase) await load(FB + 'firebase-app-compat.js');
    if (!window.firebase.database) await load(FB + 'firebase-database-compat.js');
    if (!window.firebase.auth) { await load(FB + 'firebase-auth-compat.js'); own = true; }
    if (!window.B3_FIREBASE_CONFIG) await load(new URL('firebase-config.js', base).href);
    if (!firebase.apps.length) firebase.initializeApp(window.B3_FIREBASE_CONFIG);
    if (own) {
      // The saved student sign-in comes back a moment after start; the database refuses reads before it does.
      var a = firebase.auth();
      await Promise.race([typeof a.authStateReady === 'function' ? a.authStateReady() : new Promise(function (r) { var off = a.onAuthStateChanged(function () { off(); r(); }); }), new Promise(function (r) { setTimeout(r, 8000); })]);
    }
    return firebase.database();
  }
  async function classIdsOf(db) {
    var snap = await db.ref('b3Games/students/' + studentId + '/memberships').once('value'), m = snap.val() || {}, ids = [];
    Object.keys(m).forEach(function (k) { var r = m[k]; if (r && r.active !== false && r.workspaceId === WS && /^[A-Za-z0-9_-]{1,100}$/.test(String(r.classId || '')) && ids.indexOf(r.classId) < 0) ids.push(r.classId); });
    if (!ids.length) {
      // Students from before classes (ET/WT) are found the way the rest of the site finds them.
      try {
        if (!window.FunTorahStudentClass) await load(new URL('student-class.js', base).href);
        var scope = await window.FunTorahStudentClass.resolve(db, studentId);
        if (scope && scope.workspaceId === WS && /^[A-Za-z0-9_-]{1,100}$/.test(scope.classId || '')) ids.push(scope.classId);
      } catch (e) { /* no class found: nothing to lock */ }
    }
    return ids;
  }
  async function follow() {
    var db = await ensureFirebase(), ids = await classIdsOf(db);
    Object.keys(locksByClass).forEach(function (k) { if (ids.indexOf(k) < 0) delete locksByClass[k]; });
    ids.forEach(function (cid) {
      db.ref('b3Games/workspaces/' + WS + '/classes/' + cid + '/locks').on('value', function (snap) {
        readFailed = false; locksByClass[cid] = snap.val() || {}; remember(); evaluate();
      }, function () { readFailed = true; /* keep the last known state */ });
    });
    evaluate();
  }

  async function start() {
    if (started) return; started = true;
    try {
      if (!window.B3StudentLockCore) await load(new URL('student-lock-core.js', base).href + (script && /[?]/.test(script.src) ? '?' + script.src.split('?')[1] : ''));
      core = window.B3StudentLockCore;
      // What was known on the previous page: covers at once, before the network answers.
      try {
        var c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
        if (c && c.id === studentId && Date.now() - c.at < CACHE_MS && c.locks) { locksByClass = c.locks; evaluate(); }
      } catch (e) { /* no cache */ }
      setInterval(evaluate, 1000);   // schedules and overrides start and end by the clock
      await follow();
    } catch (error) { console.warn('Student lock check unavailable; the page stays open.', error); }
  }

  // The sharing code tells us which class's lesson the student is following; his locks then come from that class.
  window.addEventListener('b3:live-class', function () { evaluate(); });

  // ---------- who is the student ----------
  function whoIsHere() { try { return sessionStorage.getItem('b3Games_studentId') || ''; } catch (e) { return ''; } }
  function waitForStudent() {
    studentId = whoIsHere();
    if (studentId) return start();
    // Not signed in yet (the sign-in screen): keep checking, never cover a page with no student on it.
    var timer = setInterval(function () { studentId = whoIsHere(); if (studentId) { clearInterval(timer); start(); } }, 500);
    window.addEventListener('fttStudentSignedIn', function () { studentId = whoIsHere(); if (studentId) { clearInterval(timer); start(); } }, { once: true });
  }

  window.B3StudentLock = {
    feature: feature,
    isLocked: function (id) { return !!(states[id] && states[id].locked); },
    state: function (id) { return states[id] || null; },
    states: function () { return states; },
    // A teacher's temporary unlock is honoured by the older page gate too.
    overrideOpen: function (id) { return !!(states[id] && states[id].kind === 'override-open'); },
    onChange: function (fn) { listeners.push(fn); },
    get readFailed() { return readFailed; }
  };
  if (!feature) { console.warn('student-lock.js needs data-feature on its script tag.'); return; }
  waitForStudent();
})();
