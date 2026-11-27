/*
 * One class for the whole teacher site.
 *
 * A teacher picks a class once (Teacher Home or the small class button at the top of every
 * teacher page). It is remembered for that teacher's account on this browser, and every
 * teacher page opens on it. A ?class= link still wins and becomes the current class.
 *
 * This only decides which class a page OPENS on. Every page still checks the class against
 * the teacher's own classes, so this never grants access, and no data or permission changes.
 *
 * Loaded straight from firebase-config.js on teacher pages (before the page's own scripts),
 * so the link already carries ?class= when the page reads it. Also unit-tested in Node.
 */
(function (root) {
  'use strict';
  var KEY = 'b3SiteClass';        // JSON {accountId: classId | 'all'}
  var LAST = 'b3SiteClassLast';   // the account that chose last (known before sign-in finishes)
  var CONFIRMED = 'b3LastConfirmedClass'; // the older per-page confirm screen reads this too
  var ALL = 'all';
  var SAFE = /^[A-Za-z0-9_-]{1,100}$/;

  // Teacher pages that open on a class. Only these get ?class= added; student pages never do.
  var PAGES = [
    'rashi-letters/teacher.html', 'record_pesukim/teacher.html', 'record-mishnayos/teacher.html',
    'mishnayos/teacher.html', 'shorashim/teacher.html', 'chazara/teacher.html', 'chayus-meter/teacher.html',
    'student-rewards/teacher.html', 'daily-checklist/teacher.html', 'weekly-quiz/teacher.html',
    'activity-history/index.html', 'gematria/teacher.html', 'assignment-center/teacher.html',
    'follow-teacher/teacher.html', 'student-report/index.html', 'sync-to-nigri/index.html',
    'class-pointer-prototype/dashboard.html', 'class-pointer-prototype/classroom.html',
    'name-picker/index.html', 'game-show/teacher.html'
  ];
  // "All my classes" is only understood by Chazara; elsewhere a page asks for one class.
  var ALL_PAGES = ['chazara/teacher.html'];

  function pageOf(pathname) {
    var p = String(pathname || '').replace(/^\/+/, '');
    for (var i = 0; i < PAGES.length; i++) {
      var page = PAGES[i];
      if (p === page || p.slice(-(page.length + 1)) === '/' + page) return page;
    }
    return '';
  }
  // The Class Pointer room is also what students open; only the teacher's own link adds the class.
  function isTeacherPage(pathname, search) {
    var page = pageOf(pathname);
    if (!page) return false;
    if (page === 'class-pointer-prototype/classroom.html') {
      return new URLSearchParams(search || '').get('dashboard') === 'teacher';
    }
    return true;
  }

  function label(id, name) {
    if (id === 'et') return 'B3 ET';
    if (id === 'wt') return 'B3 WT';
    var n = String(name || '').replace(/^class\s+(?=b3\b)/i, '').trim();
    return n || String(id || '');
  }

  function store(win) { try { return (win || root).localStorage || null; } catch (e) { return null; } }
  function readMap(s) {
    try { var m = JSON.parse(s.getItem(KEY) || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; }
  }
  function valid(id) { return id === ALL || (typeof id === 'string' && SAFE.test(id)); }

  // The remembered class for one account ('' when none). accountId '' means "whoever chose last".
  function get(accountId, win) {
    var s = store(win); if (!s) return '';
    try {
      var who = accountId || s.getItem(LAST) || '';
      var id = who ? readMap(s)[who] : '';
      return valid(id) ? id : '';
    } catch (e) { return ''; }
  }
  function set(accountId, id, win) {
    var s = store(win);
    if (!s || !accountId || !valid(id)) return false;
    try {
      var m = readMap(s); m[accountId] = id;
      s.setItem(KEY, JSON.stringify(m)); s.setItem(LAST, accountId);
      if (id !== ALL) s.setItem(CONFIRMED, id);
      return true;
    } catch (e) { return false; }
  }
  function lastAccount(win) { var s = store(win); try { return s ? s.getItem(LAST) || '' : ''; } catch (e) { return ''; } }

  // The query string a teacher page should open with, or null to leave the link alone.
  function plan(pathname, search, remembered) {
    if (!isTeacherPage(pathname, search) || !valid(remembered)) return null;
    var params = new URLSearchParams(search || '');
    if (params.get('class')) return null;                 // a ?class= link always wins
    if (remembered === ALL && ALL_PAGES.indexOf(pageOf(pathname)) < 0) return null;
    params.set('class', remembered);
    return '?' + params.toString();
  }
  // Link to the same page on another class (null when the page is not a class page).
  function relink(href, id) {
    var url = new URL(href);
    if (!valid(id)) return null;
    if (id === ALL && ALL_PAGES.indexOf(pageOf(url.pathname)) < 0) url.searchParams.delete('class');
    else url.searchParams.set('class', id);
    return url.href;
  }

  var api = { KEY: KEY, LAST: LAST, ALL: ALL, PAGES: PAGES, pageOf: pageOf, isTeacherPage: isTeacherPage,
    label: label, get: get, set: set, lastAccount: lastAccount, plan: plan, relink: relink, valid: valid };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.B3SiteClass = api;
  root.B3ClassLabel = label;
  // Add ?class= before the page's own scripts read it. replaceState keeps history clean.
  try {
    var next = plan(root.location.pathname, root.location.search, get(''));
    if (next && root.history && root.history.replaceState) {
      root.history.replaceState(root.history.state, '', root.location.pathname + next + root.location.hash);
      root.__b3SiteClassInjected = get('');
    }
  } catch (e) {}
})(typeof window === 'undefined' ? globalThis : window);
