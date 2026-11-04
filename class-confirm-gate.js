/*
 * Shared "confirm your class" screen for teacher pages.
 * A page never starts on a class by itself. It calls
 *   B3ClassGate.choose({ids, names, requested, reload})
 * after sign-in and waits for the answer before loading anything.
 *  - A class named in the link (?class=, e.g. from a Teacher Center card) is an
 *    explicit choice, so it is accepted without asking.
 *  - Otherwise a full-screen box covers the page and everything behind it is
 *    inert (cannot be clicked or tabbed to) until the teacher confirms.
 *  - If a class was confirmed last time it is offered as "Continue with ET?"
 *    with a way to pick a different one. With no last class: "Choose a class...".
 */
(function (root) {
  'use strict';
  var KEY = 'b3LastConfirmedClass';
  var SAFE = /^[A-Za-z0-9_-]{1,100}$/;

  function readLast() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function writeLast(id) { try { localStorage.setItem(KEY, id); } catch (e) {} }
  function labelOf(id, names) { return (names && names[id]) || String(id).toUpperCase(); }

  // Pure decision, unit-tested: what should the screen show?
  function plan(ids, requested, last) {
    ids = (ids || []).filter(function (id) { return SAFE.test(id); });
    if (!ids.length) return { mode: 'none' };
    if (requested && ids.indexOf(requested) >= 0) return { mode: 'explicit', id: requested };
    if (last && ids.indexOf(last) >= 0) return { mode: 'continue', id: last };
    return { mode: 'choose' };
  }

  var memo = null;
  function choose(opts) {
    // Ask once per page load; later sign-in refreshes reuse the answer.
    if (memo) return memo.then(function (id) {
      if ((opts && opts.ids || []).indexOf(id) >= 0) return id;
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
    var p = plan(ids, requested, readLast());
    if (p.mode === 'explicit') { writeLast(p.id); return Promise.resolve(p.id); }
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
        writeLast(id);
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
        sub.textContent = 'Nothing opens until you choose.';
        sub.style.cssText = 'margin:0 0 14px;color:#475569';
        var sel = doc.createElement('select');
        sel.setAttribute('aria-label', 'Choose a class');
        sel.style.cssText = 'width:100%;padding:12px;font-size:17px;border-radius:10px;border:2px solid #94a3b8';
        var ph = doc.createElement('option'); ph.value = ''; ph.textContent = 'Choose a class\u2026'; sel.appendChild(ph);
        ids.forEach(function (id) {
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
      function showContinue() {
        card.textContent = '';
        var h = doc.createElement('h1');
        h.textContent = 'Continue with ' + labelOf(p.id, names) + '?';
        h.style.cssText = 'margin:0 0 6px;font-size:22px';
        var sub = doc.createElement('p');
        sub.textContent = 'This is the class you used last time.';
        sub.style.cssText = 'margin:0 0 6px;color:#475569';
        var yes = btn('Continue with ' + labelOf(p.id, names), true);
        var other = btn('Choose a different class', false);
        yes.onclick = function () { finish(p.id); };
        other.onclick = showPicker;
        card.append(h, sub, yes, other);
        yes.focus();
      }
      body.appendChild(wrap);
      if (p.mode === 'continue') showContinue(); else showPicker();
    });
  }

  // For pages that read the class from the link (?class=) before anything else:
  // with no class in the link, ask first, then reload the page with the choice.
  // get(path) must return the value at a database path. Never resolves when it
  // asks (the page reloads); resolves when the link already names a class.
  function requireInUrl(get, access, workspace) {
    var q = (new URLSearchParams(root.location.search).get('class') || '').trim();
    if (q) return Promise.resolve(q);
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
          return choose({ ids: ids, names: names, requested: '-', reload: true });
        });
    });
  }

  var api = { choose: choose, plan: plan, requireInUrl: requireInUrl, KEY: KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.B3ClassGate = api;
})(typeof window === 'undefined' ? globalThis : window);
