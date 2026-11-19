/* Runs ON the Mashpia tab (inlined into the "B3 Mashpia Sync" bookmark, after mashpia-core.js).
   It waits for the Daily Checklist page (the tab that opened this one) to send the day's Yes answers, then checks the
   matching boxes in Mashpia with the teacher's own Mashpia session. No password is ever seen or stored.
   Only B3 pages may talk to it. It only ever sends checked marks (mark "1"), never unchecks. Block comments only. */
(function () {
  'use strict';
  var ALLOWED = ['https://fun-torah-tools-staging.web.app', 'https://funtorahtools.com', 'https://www.funtorahtools.com',
    'https://funtorahtools.org', 'https://www.funtorahtools.org', 'https://sols.tools', 'https://www.sols.tools',
    'https://simchacohen1.github.io'];
  var Core = window.B3MashpiaCore;
  if (!Core || location.hostname !== 'mashpia.com') { alert('Open this on your Mashpia page, then click the bookmark.'); return; }

  function toast(text, bad) {
    var el = document.getElementById('b3-mashpia-toast');
    if (!el) {
      el = document.createElement('div'); el.id = 'b3-mashpia-toast';
      el.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;padding:12px 16px;border-radius:10px;' +
        'font:600 14px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.3)';
      document.body.appendChild(el);
    }
    el.style.background = bad ? '#b91c1c' : '#1e7a46'; el.textContent = text; el.hidden = false;
    clearTimeout(el._t); el._t = setTimeout(function () { el.hidden = true; }, 9000);
  }

  function announce() {
    try { if (window.opener) ALLOWED.forEach(function (o) { try { window.opener.postMessage({ b3: 'mashpia-ready' }, o); } catch (e) {} }); } catch (e) {}
  }
  if (window.__b3MashpiaAgent) { announce(); toast('B3 Mashpia Sync is ready. Go back to the Daily Checklist and press Sync.'); return; }
  window.__b3MashpiaAgent = true;

  function post(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, body: j }; }); });
  }

  function run(msg) {
    var jdn = Core.julianDay(msg.date);
    if (!jdn) return Promise.reject({ code: 'bad', message: 'Invalid date.' });
    var students = Array.isArray(msg.students) ? msg.students.slice(0, 300).map(function (s) {
      return { name: String((s && s.name) || '').slice(0, 120),
        items: (Array.isArray(s && s.items) ? s.items : []).filter(function (i) { return typeof i === 'string'; }).slice(0, 60) };
    }) : [];
    return post('/api/missions/grid?action=get', { type: 'daily', date: jdn }).then(function (g) {
      var data = g.body && g.body.success === true ? g.body.data : null;
      if (!data || !Array.isArray(data.missions) || !Array.isArray(data.soldiers)) {
        throw { code: 'login', message: 'Log in to Mashpia on this tab, then click the bookmark again.' };
      }
      var items = Core.itemsFromMashpia(data.missions);   /* Mashpia is the source of the checklist items */
      var p = Core.plan(data, students), failed = {}, gids = Object.keys(p.sends);
      return gids.reduce(function (chain, gid) {
        return chain.then(function () {
          return post('/api/missions/mark', { user_ids: p.sends[gid], grid_id: +gid, dates: [jdn], mark: '1' }).then(function (r) {
            var ok = r.body && r.body.success === true && r.body.data && typeof r.body.data === 'object' ? r.body.data : {};
            p.sends[gid].forEach(function (id) { if (!(String(id) in ok)) failed[id] = 1; });
          });
        });
      }, Promise.resolve()).then(function () {
        var good = [], bad = p.notFound.slice();
        p.synced.forEach(function (s) { (failed[s.userId] ? bad : good).push(s.name); });
        return { synced: good.length, notFound: bad, greyed: p.greyed, missingItems: p.missingItems, items: items };
      });
    });
  }

  window.addEventListener('message', function (ev) {
    if (ALLOWED.indexOf(ev.origin) < 0 || !ev.data || typeof ev.data !== 'object' || !ev.source) return;
    var reply = function (m) { try { ev.source.postMessage(m, ev.origin); } catch (e) {} };
    if (ev.data.b3 === 'mashpia-ping') { reply({ b3: 'mashpia-pong' }); return; }
    if (ev.data.b3 !== 'mashpia-sync') return;
    var id = ev.data.id;
    toast('Syncing the Daily Checklist to Mashpia…');
    run(ev.data).then(function (res) {
      toast((ev.data.students && ev.data.students.length ? Core.summary(res) : 'Checklist items read from Mashpia') + ' (refresh the grid to see it)');
      reply({ b3: 'mashpia-result', id: id, ok: true, result: res });
    }, function (err) {
      var message = (err && err.message) || 'Could not reach Mashpia right now.';
      toast(message, true);
      reply({ b3: 'mashpia-result', id: id, ok: false, code: (err && err.code) || 'error', message: message });
    });
  });

  announce();
  toast('B3 Mashpia Sync is ready. Go back to the Daily Checklist and press Sync.');
})();
