/* Homework mode for activity pages (#649).
   An activity page loads this file; it does nothing unless the URL has ?hw=<assignmentId>&hwItem=<itemId>
   (homework-items.js builds those links). In homework mode it:
   - shows a "Back to my homework" bar at the top,
   - hides and blocks links that lead to other parts of the site,
   - lets the page report that the assigned part is finished (HomeworkMode.complete()),
     which ticks the item on the student's homework through the Homework Portal.
   The activity itself saves the student's work to its normal progress records, as always.
   Activities with no automatic check call HomeworkMode.allowManualDone() to show an "I finished this" button. */
(function (root) {
  'use strict';
  var params = new URLSearchParams(root.location.search);
  var assignmentId = params.get('hw') || '', itemId = params.get('hwItem') || '';
  var KEY = /^[A-Za-z0-9_-]{1,100}$/;
  var active = KEY.test(assignmentId) && KEY.test(itemId);
  var script = document.currentScript;
  var here = script && script.src ? script.src : root.location.href;
  var homeworkUrl = new URL('student.html', here).href;
  var commonUrl = new URL('homework-common.js', here).href;
  var doneKey = 'homeworkItemDone_' + assignmentId + '_' + itemId;

  function ss(k) { try { return root.sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  var api = {
    active: active, params: params, assignmentId: assignmentId, itemId: itemId,
    title: (params.get('hwTitle') || 'Homework').slice(0, 80),
    since: Number(params.get('hwSince')) || 0,
    homeworkUrl: homeworkUrl,
    isDone: function () { return ss(doneKey) === '1'; },
    setStatus: function () {}, complete: function () { return Promise.resolve(false); },
    allowManualDone: function () {}, back: function () {}
  };
  root.HomeworkMode = api;
  if (!active) return;

  // <script ... data-manual-done>: this activity has no automatic check, so show "I finished this".
  var bar, statusText, doneBtn, retryBtn, backBtn, toast, saving = null, manual = !!(script && script.hasAttribute('data-manual-done'));

  function addStyles() {
    var s = el('style'); s.id = 'b3-homework-mode-styles';
    s.textContent = [
      // body padding-top follows the bar's real height (see fitBar), so nothing hides under it.
      'html.b3-homework-mode body{padding-top:calc(var(--b3-hw-bar,62px) + var(--b3-hw-pad,0px))!important}',
      '#b3-homework-bar{position:fixed;top:0;left:0;right:0;z-index:2147483600;display:flex;align-items:center;gap:10px;flex-wrap:wrap;',
      'padding:8px 14px;background:#1d3f75;color:#fff;font:600 15px/1.3 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;box-shadow:0 3px 12px rgba(0,0,0,.25)}',
      '#b3-homework-bar.done{background:#14733f}',
      '#b3-homework-bar .hwm-title{flex:1 1 180px;min-width:0;overflow-wrap:anywhere}',
      '#b3-homework-bar .hwm-title b{display:block;font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.85}',
      '#b3-homework-bar button{font:800 15px system-ui,-apple-system,"Segoe UI",Arial,sans-serif;border:0;border-radius:999px;padding:9px 16px;cursor:pointer;min-height:40px}',
      '#b3-homework-bar .hwm-back{background:#fff;color:#1d3f75}',
      '#b3-homework-bar .hwm-done,#b3-homework-bar .hwm-retry{background:#ffd75e;color:#3d2a00}',
      '#b3-homework-bar button[hidden]{display:none}',
      '#b3-homework-bar button:focus-visible{outline:3px solid #ffd75e;outline-offset:2px}',
      '.b3-homework-toast{position:fixed;left:50%;top:72px;transform:translateX(-50%);z-index:2147483601;max-width:min(460px,92vw);background:#1e293b;color:#fff;',
      'border-radius:14px;padding:12px 16px;font:700 15px/1.4 system-ui,sans-serif;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.3);transition:opacity .3s}',
      // Ways to leave the activity: the site back button, page header links, switching student.
      'html.b3-homework-mode #b3BackNav,html.b3-homework-mode #b3BackNavBar,html.b3-homework-mode #switchStudentBtn,',
      'html.b3-homework-mode [data-homework-hidden]{display:none!important}',
      '.b3-homework-toast{top:calc(var(--b3-hw-bar,62px) + 10px)}',
      '@media print{#b3-homework-bar{display:none}}'
    ].join('');
    document.head.append(s);
  }
  function say(text) {
    if (!toast) { toast = el('div', null, 'b3-homework-toast'); toast.setAttribute('role', 'status'); document.body.append(toast); }
    toast.textContent = text; toast.style.opacity = '1';
    clearTimeout(say.t); say.t = setTimeout(function () { toast.style.opacity = '0'; }, 3500);
  }
  function setStatus(text) { if (statusText) statusText.textContent = text; }

  // Links to anywhere outside this activity page are hidden and blocked.
  // Exception: the site's sign-in / class-lock screen (game-gate.js) keeps its own link,
  // so a signed-out student is never stuck.
  function leavesPage(a) {
    if (!a || !a.getAttribute || !a.getAttribute('href') || a.hasAttribute('download')) return false;
    if (bar && bar.contains(a)) return false;
    if (a.closest && a.closest('#b3-gate-overlay')) return false;
    var u;
    try { u = new URL(a.href, root.location.href); } catch (e) { return false; }
    if (u.protocol === 'blob:' || u.protocol === 'data:' || u.protocol === 'javascript:') return false;
    return u.origin !== root.location.origin || u.pathname !== root.location.pathname;
  }
  function hideLinks(scope) {
    var links = (scope || document).querySelectorAll ? (scope || document).querySelectorAll('a[href]') : [];
    Array.prototype.forEach.call(links, function (a) { if (leavesPage(a)) a.setAttribute('data-homework-hidden', ''); });
  }
  document.addEventListener('click', function (event) {
    var a = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (a && leavesPage(a)) {
      event.preventDefault(); event.stopPropagation();
      say('You are doing homework. Finish here, then tap “Back to my homework”.');
    }
  }, true);

  function back() {
    try {
      if (root.opener && !root.opener.closed && root.opener.location.pathname === new URL(homeworkUrl).pathname) {
        root.opener.focus(); root.close();
        setTimeout(function () { root.location.href = homeworkUrl; }, 300); // close() is refused if this tab was not opened by script
        return;
      }
    } catch (e) { /* opener is another site: just go there */ }
    root.location.href = homeworkUrl;
  }

  function loadCommon() {
    if (root.HomeworkCommon) return Promise.resolve(root.HomeworkCommon);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = commonUrl;
      s.onload = function () { root.HomeworkCommon ? resolve(root.HomeworkCommon) : reject(new Error('Homework could not load.')); };
      s.onerror = function () { reject(new Error('Homework could not load. Check your internet connection.')); };
      document.head.append(s);
    });
  }
  function showDone() {
    bar.classList.add('done');
    setStatus('✅ Done! This item is ticked on your homework.');
    doneBtn.hidden = true; retryBtn.hidden = true;
    backBtn.textContent = '← Back to my homework';
  }
  // Ticks this item on the student's homework. Safe to call more than once.
  function complete() {
    if (api.isDone()) { showDone(); return Promise.resolve(true); }
    if (saving) return saving;
    var auth = { studentId: ss('b3Games_studentId'), studentName: ss('b3Games_studentName'), pin: ss('b3Games_classPin'), classId: ss('b3Games_studentClass') };
    if (!auth.studentId || !auth.pin) {
      setStatus('Finished! (Preview only: sign in as a student to tick homework.)');
      return Promise.resolve(false);
    }
    setStatus('Great work! Saving to your homework…');
    retryBtn.hidden = true;
    saving = loadCommon().then(function (H) {
      return H.call(Object.assign({ action: 'itemDone', assignmentId: assignmentId, itemId: itemId }, auth));
    }).then(function () {
      try { root.sessionStorage.setItem(doneKey, '1'); } catch (e) { /* the server has it */ }
      showDone(); say('✅ Homework item done!');
      return true;
    }).catch(function (error) {
      setStatus('Finished, but it could not be ticked yet. ' + String(error.message || 'Please try again').replace(/\.+$/, '') + '.');
      retryBtn.hidden = false; doneBtn.hidden = true;
      return false;
    }).finally(function () { saving = null; });
    return saving;
  }

  function mount() {
    if (document.getElementById('b3-homework-bar')) return;
    // Keep the page's own top padding, measured before homework mode changes it.
    var docStyle = document.documentElement.style;
    docStyle.setProperty('--b3-hw-pad', (parseFloat(getComputedStyle(document.body).paddingTop) || 0) + 'px');
    document.documentElement.classList.add('b3-homework-mode');
    addStyles();
    bar = el('div'); bar.id = 'b3-homework-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Homework');
    var t = el('div', null, 'hwm-title'); t.append(el('b', '📌 Homework'), el('span', api.title));
    statusText = el('div', '', 'hwm-status'); statusText.setAttribute('aria-live', 'polite'); t.append(statusText);
    doneBtn = el('button', '✓ I finished this', 'hwm-done'); doneBtn.type = 'button'; doneBtn.hidden = !manual;
    doneBtn.onclick = function () { complete(); };
    retryBtn = el('button', 'Try again', 'hwm-retry'); retryBtn.type = 'button'; retryBtn.hidden = true;
    retryBtn.onclick = function () { complete(); };
    backBtn = el('button', '← Back to my homework', 'hwm-back'); backBtn.type = 'button'; backBtn.onclick = back;
    bar.append(t, doneBtn, retryBtn, backBtn);
    document.body.prepend(bar);
    var fitBar = function () { docStyle.setProperty('--b3-hw-bar', bar.offsetHeight + 'px'); };
    fitBar();
    if (root.ResizeObserver) new root.ResizeObserver(fitBar).observe(bar); else root.addEventListener('resize', fitBar);
    hideLinks(document);
    new MutationObserver(function (list) {
      list.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) { if (n.matches && n.matches('a[href]') && leavesPage(n)) n.setAttribute('data-homework-hidden', ''); hideLinks(n); } }); });
    }).observe(document.body, { childList: true, subtree: true });
    if (api.isDone()) showDone();
  }

  api.setStatus = function (text) { if (!api.isDone()) setStatus(text); };
  api.complete = complete;
  api.back = back;
  api.allowManualDone = function () { manual = true; if (doneBtn && !api.isDone()) doneBtn.hidden = false; };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
})(typeof window !== 'undefined' ? window : globalThis);
