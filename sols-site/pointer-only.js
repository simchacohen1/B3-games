/*
 * sols.tools front door (issue #832, widened).
 *
 * A visitor who is NOT signed in still sees only the home page, the teacher sign-in page and Class Pointer:
 * any other page sends them back to the home page, and the home pages show Class Pointer only.
 * Anyone who is SIGNED IN (teacher, student or administrator) gets the whole site, the same as funtorahtools.com.
 * This file never grants access. Every page and the server still run their own checks (class permissions,
 * teacher assignment, owner-only pages), so a signed-in person sees exactly what they could on funtorahtools.com.
 *
 * Previously (issue #832): sols.tools showed only Class Pointer to teachers and students.
 *
 * This file is NOT loaded by funtorahtools.com. sols-site/build.mjs puts it at the
 * start of /sols-brand.js, the one extra script every page of the sols.tools copy
 * loads, so it runs before anything else on the page.
 *
 * What it does, for everyone except a site administrator (the owner):
 *   1. Any page that is not the home page, the teacher home page or a Class Pointer
 *      page sends the visitor straight back to the home page.
 *   2. On the student home page the other tools are not shown.
 *   3. On the teacher home page only the Class Pointer tiles are shown.
 *
 * It changes what people SEE on sols.tools. It does not touch accounts, saved
 * work, Firebase paths or rules: the same account still has every tool its class
 * was given on funtorahtools.com. It is a tidy front door, not a security lock.
 *
 * A site administrator keeps the whole site. That is remembered in this browser
 * (FULL_KEY) once the administrator has signed in on sols.tools, and forgotten
 * when anyone else signs in or the administrator signs out.
 */
(function (root) {
  'use strict';

  var FULL_KEY = 'solsFullSite';
  var POINTER_DIR = '/class-pointer-prototype/';
  var HOME_PAGES = ['/', '/index.html', '/teacher-home.html'];

  // Pages a signed-out visitor may open on sols.tools. Clean links count too: /teacher-home, /index, /class-pointer-prototype.
  function allowedPath(pathname) {
    var path = String(pathname || '/');
    if (path.charAt(0) !== '/') path = '/' + path;
    var clean = path.replace(/\.html$/, '').replace(/\/index$/, '/');
    if (clean.length > 1) clean = clean.replace(/\/+$/, '');
    if (clean === '' || clean === '/' || clean === '/index' || clean === '/teacher-home') return true;
    return (clean + '/').indexOf(POINTER_DIR) === 0;
  }
  // Does a link on a home page lead to Class Pointer?
  function isPointerHref(href) {
    var text = String(href || '');
    if (!text || /^(javascript|data|mailto|tel):/i.test(text)) return false;
    var path = text.replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/[?#].*$/, '');
    if (path.charAt(0) !== '/') path = '/' + path.replace(/^(\.\/)+/, '');
    return path.indexOf(POINTER_DIR) === 0;
  }
  // 'limited' (nobody signed in), 'full' (somebody is signed in: the whole site, with every page's own checks), '' (not known yet).
  function viewerKind(authKnown, user) {
    if (!authKnown) return '';
    return user ? 'full' : 'limited';
  }

  var api = { FULL_KEY: FULL_KEY, allowedPath: allowedPath, isPointerHref: isPointerHref, viewerKind: viewerKind };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  if (!root || !root.document || root.__solsPointerOnly) return;
  root.__solsPointerOnly = api;

  var doc = root.document;
  function readFull() { try { return root.localStorage.getItem(FULL_KEY) === '1'; } catch (e) { return false; } }
  function writeFull(on) { try { if (on) root.localStorage.setItem(FULL_KEY, '1'); else root.localStorage.removeItem(FULL_KEY); } catch (e) {} }

  var full = readFull();
  root.SOLS_POINTER_ONLY = !full;

  // 1. Any other page, for someone who is not signed in: back to the home page. Whether anyone is signed in is not known
  // until the site's sign-in has answered, so the page stays hidden until then. If the page has no sign-in at all (or it
  // never answers) the page is shown: its own checks still apply.
  var pendingBounce = false;
  function showPage() { try { doc.documentElement.style.visibility = ''; } catch (e) {} }
  if (!full && !allowedPath(root.location.pathname)) {
    pendingBounce = true;
    try { doc.documentElement.style.visibility = 'hidden'; } catch (e) {}
    root.setTimeout(function () { if (pendingBounce) { pendingBounce = false; showPage(); } }, 8000);
  }

  // 2 and 3. The two home pages show Class Pointer only.
  var path = root.location.pathname;
  var studentHome = path === '/' || path === '/index.html';
  var teacherHome = path === '/teacher-home.html';

  function addStyle() {
    if (doc.getElementById('solsPointerOnlyStyle') || !doc.head) return;
    var style = doc.createElement('style');
    style.id = 'solsPointerOnlyStyle';
    style.textContent =
      // Student home: no other tools, no "nothing is available" note, no homework link.
      (studentHome ? '#gamesArea,#disabledMessage,#lockedCard,#homeworkStudentLink{display:none!important}' : '') +
      '.sols-pointer-note{max-width:640px;margin:18px auto;padding:16px 18px;border-radius:14px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;font:600 17px/1.45 system-ui,sans-serif;text-align:center}';
    doc.head.appendChild(style);
  }
  // A signed-in student sees one friendly line where the tools used to be.
  function studentNote() {
    var bar = doc.getElementById('studentBar');
    var signedIn = !!bar && !bar.classList.contains('hidden');
    var note = doc.getElementById('solsPointerNote');
    if (!signedIn) { if (note) note.remove(); return; }
    if (note) return;
    note = doc.createElement('p');
    note.id = 'solsPointerNote';
    note.className = 'sols-pointer-note';
    note.textContent = 'When your teacher starts a lesson, it opens here by itself.';
    bar.parentNode.insertBefore(note, bar.nextSibling);
  }
  // Teacher home: in every class card keep the Class Pointer tiles and hide the rest.
  function hide(el, on) {
    if (on) el.style.setProperty('display', 'none', 'important'); else el.style.removeProperty('display');
  }
  function limitTeacherHome() {
    var cards = doc.querySelectorAll('.class-card');
    for (var i = 0; i < cards.length; i += 1) {
      var tiles = cards[i].querySelectorAll('a[href], button.act-as-student, button[data-act-as-student]');
      for (var j = 0; j < tiles.length; j += 1) {
        hide(tiles[j], !(tiles[j].nodeName === 'A' && isPointerHref(tiles[j].getAttribute('href'))));
      }
      // A place on the map with nothing left in it goes too.
      var groups = cards[i].querySelectorAll('.game-group');
      for (var k = 0; k < groups.length; k += 1) {
        var links = groups[k].querySelectorAll('a[href]'), any = false;
        for (var m = 0; m < links.length; m += 1) if (isPointerHref(links[m].getAttribute('href'))) any = true;
        hide(groups[k], !any);
      }
    }
  }
  var queued = false;
  function tidy() {
    queued = false;
    if (root.SOLS_POINTER_ONLY !== true) return;
    addStyle();
    if (studentHome) studentNote();
    if (teacherHome) limitTeacherHome();
  }
  function queueTidy() {
    if (queued) return;
    queued = true;
    // A plain timer: it also runs while the tab is in the background.
    root.setTimeout(tidy, 30);
  }
  if (!full && (studentHome || teacherHome)) {
    tidy();
    new MutationObserver(queueTidy).observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', tidy);
  }

  // Who is signed in? The site's own sign-in code already knows; this only listens.
  // A teacher's Google login is remembered by a SECOND Firebase app ("FTTRememberedTeacher", see site-settings.js) and is copied
  // into the page's own sign-in a moment after the page loads. In a new tab (a typed link, a bookmark) the page's own sign-in
  // first answers "nobody" before that copy has happened, so that first answer alone must not send a teacher home: wait for the
  // remembered login to answer too. Student tabs and tabs that chose "Switch student" never restore it, so they do not wait.
  var authKnown = false, user = null, hooked = false;
  var rememberedKnown = false, rememberedUser = null, rememberedHooked = false;
  var REMEMBERED_APP = 'FTTRememberedTeacher';
  function noRememberedTeacher() {
    try {
      var s = root.sessionStorage;
      return !!(s.getItem('b3Games_studentId') || s.getItem('b3ActingAsStudent') || s.getItem('b3NoTeacherRestore') === '1');
    } catch (e) { return false; }
  }
  function hookRemembered() {
    if (rememberedHooked) return;
    var fb = root.firebase;
    if (!fb || typeof fb.auth !== 'function' || !fb.apps || !fb.apps.length) return;
    rememberedHooked = true;
    if (noRememberedTeacher()) { rememberedKnown = true; return; }
    try {
      var app;
      try { app = fb.app(REMEMBERED_APP); } catch (e) { app = fb.initializeApp(fb.app().options, REMEMBERED_APP); }
      app.auth().onAuthStateChanged(function (next) { rememberedKnown = true; rememberedUser = next || null; check(); }, function () { rememberedKnown = true; check(); });
    } catch (e) { rememberedKnown = true; }
    // If it never answers, fall back to the page's own sign-in alone.
    root.setTimeout(function () { if (!rememberedKnown) { rememberedKnown = true; check(); } }, 4000);
  }
  function hookAuth() {
    if (hooked) return true;
    var fb = root.firebase;
    if (!fb || typeof fb.auth !== 'function') return false;
    try {
      if (!fb.apps || !fb.apps.length) return false;
      fb.auth().onAuthStateChanged(function (next) { authKnown = true; user = next || null; check(); });
      hooked = true;
    } catch (e) { return false; }
    hookRemembered();
    return true;
  }
  function check() {
    hookAuth();
    // Signed in on this page, or (once the remembered login has answered) signed in as the remembered teacher.
    var known = authKnown && (!!user || rememberedKnown);
    var kind = viewerKind(known, user || rememberedUser);
    if (!kind) return;
    if (pendingBounce && kind === 'limited') { pendingBounce = false; root.location.replace('/'); return; }
    var wantFull = kind === 'full';
    if (wantFull === full) return;
    // The view changes: remember it and load the page again in the new view.
    writeFull(wantFull);
    full = wantFull;
    root.location.reload();
  }
  root.setInterval(check, 1500);
  // While a page is waiting to learn whether anyone is signed in, look often so it does not stay hidden.
  var fast = root.setInterval(function () { if (!pendingBounce) { root.clearInterval(fast); return; } check(); }, 250);
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', check); else check();
})(typeof window === 'undefined' ? null : window);
