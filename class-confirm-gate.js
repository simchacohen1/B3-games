/*
 * Shared "confirm your class" screen for teacher pages.
 * A page never starts on a class by itself. It calls
 *   B3ClassGate.choose({ids, names, requested, reload})
 * after sign-in and waits for the answer before loading anything.
 *  - A class named in the link (?class=, e.g. from a Teacher Center card) is an
 *    explicit choice, so it is accepted without asking.
 *  - Otherwise a full-screen box covers the page and everything behind it is
 *    inert (cannot be clicked or tabbed to) until the teacher confirms.
 *  - The class is chosen ONCE for the whole teacher site (Teacher Home, or the
 *    first teacher page opened) and remembered for that teacher's account on
 *    this browser. Every later page opens on it with no question. The class
 *    button on the teacher toolbar switches it everywhere.
 *  - A teacher with exactly one class is never asked.
 *  - "All classes" is a valid site choice. A page that can only work on one
 *    class uses the teacher's most recent single class instead.
 */
(function (root) {
  'use strict';
  var KEY = 'b3LastConfirmedClass';      // legacy, still written for older readers
  var SITE = 'b3TeacherClass:';          // + account id -> the site-wide class ('all' allowed)
  var LAST = 'b3TeacherClassLast:';      // + account id -> most recent single class
  var ANY = '*';                         // newest signed-in teacher on this browser (used before sign-in settles)
  var SAFE = /^[A-Za-z0-9_-]{1,100}$/;
  var ALL = 'all';

  function uid() {
    try { var u = root.firebase && root.firebase.auth && root.firebase.auth().currentUser; return u && u.uid || ''; }
    catch (e) { return ''; }
  }
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  // One naming rule everywhere: B3 ET, B3 WT; any other class keeps its own name.
  function label(id, name) {
    if (id === ALL) return 'All classes';
    if (id === 'et' || id === 'wt') return 'B3 ' + id.toUpperCase();
    return name || String(id);
  }
  // The account's saved class. Before sign-in settles (no account id yet) the
  // newest teacher's choice on this browser is used; once the account is known
  // only that account's own choice counts.
  function readSite() { var u = uid(); return lsGet(SITE + (u || ANY)); }
  function readLast() { var u = uid(); return lsGet(LAST + (u || ANY)) || lsGet(KEY); }
  function writeLast(id) { lsSet(KEY, id); }
  function setSite(id) {
    if (id !== ALL && !SAFE.test(id || '')) return;
    var u = uid();
    if (u) lsSet(SITE + u, id);
    lsSet(SITE + ANY, id);
    if (id !== ALL) { if (u) lsSet(LAST + u, id); lsSet(LAST + ANY, id); writeLast(id); }
    try { root.dispatchEvent(new root.CustomEvent('b3-class-changed', { detail: { id: id } })); } catch (e) {}
  }
  // The owner's class pickers list only B3 ET and B3 WT; every other class is
  // reached through Teacher Tools (a ?class= link still opens any class).
  function isOwner() {
    try { var a = root.B3SiteSettings && root.B3SiteSettings.getCurrentAccess && root.B3SiteSettings.getCurrentAccess(); return !!a && a.role === 'admin'; }
    catch (e) { return false; }
  }
  function pickable(ids) {
    ids = ids || [];
    if (!isOwner()) return ids;
    var two = ids.filter(function (id) { return id === 'et' || id === 'wt'; });
    return two.length ? two : ids;
  }
  function labelOf(id, names) { return label(id, names && names[id]); }

  // Pure decision, unit-tested: what should the screen show?
  // allowAll adds an "All classes" choice (id 'all') on pages that can use it.
  // saved is the account's site-wide class; lastSingle its latest single class.
  function plan(ids, requested, saved, allowAll, lastSingle) {
    ids = (ids || []).filter(function (id) { return SAFE.test(id); });
    if (!ids.length) return { mode: 'none' };
    if (allowAll && requested === ALL) return { mode: 'explicit', id: ALL };
    if (requested && ids.indexOf(requested) >= 0) return { mode: 'explicit', id: requested };
    if (saved === ALL && allowAll) return { mode: 'saved', id: ALL };
    if (saved && saved !== ALL && ids.indexOf(saved) >= 0) return { mode: 'saved', id: saved };
    // "All classes" on a one-class page: use the latest single class instead.
    if (saved === ALL && lastSingle && ids.indexOf(lastSingle) >= 0) return { mode: 'saved', id: lastSingle };
    if (ids.length === 1) return { mode: 'only', id: ids[0] };
    return { mode: 'choose' };
  }

  var memo = null;
  function choose(opts) {
    // Ask once per page load; later sign-in refreshes reuse the answer.
    if (memo) return memo.then(function (id) {
      if ((opts && opts.ids || []).indexOf(id) >= 0 || (opts && opts.allowAll && id === ALL)) return id;
      memo = null; return choose(opts);
    });
    memo = choose1(opts);
    memo.catch(function () { memo = null; });
    return memo;
  }
  function choose1(opts) {
    opts = opts || {};
    var ids = opts.ids || [], names = opts.names || {};
    var requested = opts.requested === undefined
      ? (new URLSearchParams(root.location.search).get('class') || '').trim() : opts.requested;
    api.allowAll = !!opts.allowAll;
    var p = plan(ids, requested, readSite(), opts.allowAll, readLast());
    if (p.mode !== 'choose' && p.mode !== 'none') {
      // A class named in the link is the teacher's choice for the whole site.
      // A saved or only class is used as it is.
      if (p.mode === 'explicit') setSite(p.id);
      else if (!readSite()) setSite(p.id);
      api.effective = p.id;
      if (opts.reload) {
        var cur = new URL(root.location.href);
        if (!(cur.searchParams.get('class') || '').trim()) {
          cur.searchParams.set('class', p.id);
          root.location.replace(cur.href);
          return new Promise(function () {}); // the page reloads with the class in the link
        }
      }
      return Promise.resolve(p.id);
    }
    return new Promise(function (resolve, reject) {
      if (p.mode === 'none') { reject(new Error('No classes are assigned to this account.')); return; }
      var doc = root.document, body = doc.body;
      var held = [];
      Array.prototype.forEach.call(body.children, function (n) {
        if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return;
        held.push([n, n.hasAttribute('inert')]);
        n.setAttribute('inert', '');
        n.setAttribute('aria-hidden', 'true');
      });
      var wrap = doc.createElement('div');
      wrap.id = 'b3ClassGate';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-label', 'Confirm your class');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:#f1f5f9;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a';
      var card = doc.createElement('div');
      card.style.cssText = 'background:#fff;border:1px solid #cbd5e1;border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 10px 30px rgba(15,23,42,.15);text-align:center';
      wrap.appendChild(card);

      function btn(text, primary) {
        var b = doc.createElement('button');
        b.type = 'button'; b.textContent = text;
        b.style.cssText = 'display:block;width:100%;margin-top:12px;padding:14px;font-size:17px;font-weight:700;border-radius:12px;cursor:pointer;border:2px solid #1d4ed8;' +
          (primary ? 'background:#1d4ed8;color:#fff' : 'background:#fff;color:#1d4ed8');
        return b;
      }
      function finish(id) {
        setSite(id);
        api.effective = id;
        held.forEach(function (h) {
          if (!h[1]) h[0].removeAttribute('inert');
          h[0].removeAttribute('aria-hidden');
        });
        wrap.remove();
        if (opts.reload) {
          var u = new URL(root.location.href);
          u.searchParams.set('class', id);
          root.location.replace(u.href);
          return; // stay pending: the page reloads with the class in the link
        }
        resolve(id);
      }
      function showPicker() {
        card.textContent = '';
        var h = doc.createElement('h1');
        h.textContent = 'Which class?';
        h.style.cssText = 'margin:0 0 6px;font-size:22px';
        var sub = doc.createElement('p');
        sub.textContent = 'You pick once. Every teacher page then uses it until you change it.';
        sub.style.cssText = 'margin:0 0 14px;color:#475569';
        var sel = doc.createElement('select');
        sel.setAttribute('aria-label', 'Choose a class');
        sel.style.cssText = 'width:100%;padding:12px;font-size:17px;border-radius:10px;border:2px solid #94a3b8';
        var ph = doc.createElement('option'); ph.value = ''; ph.textContent = 'Choose a class\u2026'; sel.appendChild(ph);
        if (opts.allowAll) { var oa = doc.createElement('option'); oa.value = ALL; oa.textContent = 'All classes'; sel.appendChild(oa); }
        pickable(ids).forEach(function (id) {
          if (!SAFE.test(id)) return;
          var o = doc.createElement('option'); o.value = id; o.textContent = labelOf(id, names); sel.appendChild(o);
        });
        var go = btn('Open this class', true);
        go.disabled = true; go.style.opacity = '.5';
        sel.onchange = function () { go.disabled = !sel.value; go.style.opacity = sel.value ? '1' : '.5'; };
        go.onclick = function () { if (sel.value) finish(sel.value); };
        card.append(h, sub, sel, go);
        sel.focus();
      }
      body.appendChild(wrap);
      showPicker();
    });
  }

  // For pages that read the class from the link (?class=) before anything else:
  // with no class in the link, ask first, then reload the page with the choice.
  // get(path) must return the value at a database path. Never resolves when it
  // asks (the page reloads); resolves when the link already names a class.
  function requireInUrl(get, access, workspace, allowAll) {
    var q = (new URLSearchParams(root.location.search).get('class') || '').trim();
    if (q) {
      // A class named in the link is the teacher's class for the whole site (only if it is theirs).
      var mine = access && (access.role === 'admin' || (access.classIds || []).indexOf(q) >= 0);
      // (A one-class page that was sent here because the choice is "All classes" keeps that choice.)
      var kept = readSite() === ALL && !allowAll && q === readLast();
      if (mine && !kept && (SAFE.test(q) || (allowAll && q === ALL))) { setSite(q); api.effective = q; }
      return Promise.resolve(q);
    }
    var base = 'b3Games/workspaces/' + (workspace || 'b3-2026') + '/classes';
    var idsP = access && access.role === 'admin'
      ? get(base).then(function (all) {
          all = all || {};
          return Object.keys(all).filter(function (id) { return all[id] && all[id].active !== false; }).sort();
        })
      : Promise.resolve((access && access.classIds || []).filter(function (id) { return SAFE.test(id) && id !== '*'; }));
    return idsP.then(function (ids) {
      return Promise.all(ids.map(function (id) { return get(base + '/' + id + '/name').catch(function () { return null; }); }))
        .then(function (list) {
          var names = {}; ids.forEach(function (id, i) { names[id] = list[i] || String(id).toUpperCase(); });
          return choose({ ids: ids, names: names, requested: '-', reload: true, allowAll: !!allowAll });
        });
    });
  }

  // Pages with their own class dropdown: a teacher's pick there is the site-wide
  // class too, and the two classes are always spelled B3 ET / B3 WT.
  var SELECT_IDS = { classSelect: 1, classSel: 1, cls: 1, fClass: 1 };
  // More teacher-page class pickers the owner sees limited (they do not change the site-wide class).
  var LIMIT_IDS = { classSelect: 1, classSel: 1, cls: 1, fClass: 1, pointerClassChoice: 1, classChoice: 1, homeClassPick: 1, fttTeacherQuickClass: 1, fttTeacherModalClass: 1, liveClassSelect: 1, launchClass: 1, progressClass: 1, wpnClass: 1 };
  function relabelOptions(scope) {
    try {
      Array.prototype.forEach.call(scope.querySelectorAll('select option[value="et"],select option[value="wt"]'), function (o) {
        var want = label(o.value);
        if (o.textContent !== want) o.textContent = want;
      });
    } catch (e) {}
  }
  // The owner's class dropdowns inside tools list only B3 ET and B3 WT (admin pages keep every class).
  // The option the page has selected is never removed, so a link to another class still shows it.
  function limitOwnerDropdowns(scope) {
    try {
      if (/(?:^|\/)(?:admin|owner-admin)\.html$/.test(root.location.pathname) || !isOwner()) return;
      Object.keys(LIMIT_IDS).forEach(function (id) {
        var sel = scope.getElementById(id);
        if (!sel || sel.tagName !== 'SELECT') return;
        var classOpts = Array.prototype.filter.call(sel.options, function (o) { return SAFE.test(o.value) && o.value !== ALL; });
        if (!classOpts.some(function (o) { return o.value === 'et' || o.value === 'wt'; })) return;
        classOpts.forEach(function (o) {
          if (o.value !== 'et' && o.value !== 'wt' && o !== sel.options[sel.selectedIndex]) o.remove();
        });
      });
    } catch (e) {}
  }
  function watchPage() {
    var doc = root.document;
    if (!doc || !doc.addEventListener || root.__b3ClassWatch) return;
    root.__b3ClassWatch = true;
    doc.addEventListener('change', function (e) {
      var t = e.target;
      if (!e.isTrusted || !t || t.tagName !== 'SELECT' || !SELECT_IDS[t.id]) return;
      var v = t.value;
      if (v === '' && t.id === 'fClass') v = ALL; // Activity History: "All classes"
      if (v === ALL || SAFE.test(v || '')) { if (v !== readSite()) setSite(v); api.effective = v; }
    }, true);
    var queued = false;
    function schedule() {
      if (queued) return; queued = true;
      (root.requestAnimationFrame || root.setTimeout)(function () { queued = false; relabelOptions(doc); limitOwnerDropdowns(doc); });
    }
    function start() {
      relabelOptions(doc); limitOwnerDropdowns(doc);
      // Owner sign-in settles after the page loads: look again for a few seconds.
      var n = 0, t = root.setInterval(function () { limitOwnerDropdowns(doc); if (++n > 12) root.clearInterval(t); }, 1000);
      if (root.MutationObserver) new root.MutationObserver(schedule).observe(doc.body, { childList: true, subtree: true });
    }
    if (doc.body) start(); else doc.addEventListener('DOMContentLoaded', start, { once: true });
  }
  if (typeof document !== 'undefined') watchPage();

  var api = {
    choose: choose, plan: plan, requireInUrl: requireInUrl, KEY: KEY,
    label: label, pickable: pickable, isOwner: isOwner, getSite: readSite, getLast: readLast, setSite: setSite,
    effective: '', allowAll: false
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.B3ClassGate = api;
})(typeof window === 'undefined' ? globalThis : window);
