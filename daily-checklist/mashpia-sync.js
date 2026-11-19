/* "Sync to Mashpia" for the Daily Checklist teacher page: the page side.
   The sync itself runs in the teacher's own browser, on their Mashpia tab, using their own Mashpia login
   (no password is stored anywhere, no server). This file opens/reuses that tab, hands it the selected day's Yes
   answers with postMessage, and shows the one short result line. The Mashpia tab runs mashpia-agent.js, which the
   teacher installs once as a bookmark ("B3 Mashpia Sync"). */
(function (root) {
  'use strict';
  var Core = root.B3MashpiaCore || (typeof require === 'function' ? require('./mashpia-core.js') : null);
  var MASHPIA = 'https://mashpia.com', MARK_URL = MASHPIA + '/new/missions/mark', TAB = 'b3-mashpia';
  var current = null;   /* cancel function of the sync that is waiting right now */

  /* The text of the bookmark: core + agent, wrapped so it can run on any Mashpia page. */
  function bookmarkletHref(coreText, agentText) {
    return 'javascript:' + encodeURIComponent('(function(){' + coreText + '\n' + agentText + '\n})();void 0');
  }

  /* env: {open(url,name), listen(fn)->stop, timer(fn,ms)->cancel, repeat(fn,ms)->cancel, status(text), needSetup(), newId()} */
  function run(env, date, students) {
    if (current) current();
    var w = env.open('', TAB);       /* empty address: reuses a Mashpia tab we opened before without reloading it */
    if (!w) return Promise.resolve({ ok: false, message: 'Your browser blocked the Mashpia tab. Allow pop-ups for this site, then press again.' });
    return new Promise(function (resolve) {
      var id = env.newId(), sent = false, stops = [], pingStop = null;
      function cleanup() { stops.forEach(function (s) { s(); }); stops = []; if (pingStop) pingStop(); pingStop = null; current = null; }
      function done(r) { cleanup(); resolve(r); }
      current = function () { done({ ok: false, message: 'Cancelled.' }); };
      function ping() { try { w.postMessage({ b3: 'mashpia-ping' }, MASHPIA); } catch (e) {} }
      function send() {
        if (sent) return;
        sent = true;
        try { w.postMessage({ b3: 'mashpia-sync', id: id, date: date, students: students }, MASHPIA); } catch (e) {}
        env.status('Syncing…');
        stops.push(env.timer(function () { done({ ok: false, message: 'Mashpia did not answer. Check that tab, then press Sync again.' }); }, 90000));
      }
      stops.push(env.listen(function (ev) {
        if (ev.origin !== MASHPIA || !ev.data || typeof ev.data !== 'object') return;
        var d = ev.data;
        if (d.b3 === 'mashpia-pong' || d.b3 === 'mashpia-ready') { send(); return; }
        if (d.b3 !== 'mashpia-result' || d.id !== id) return;
        if (d.ok) return done({ ok: true, message: Core.summary(d.result || { synced: 0 }), items: (d.result && d.result.items) || null, pulls: (d.result && d.result.pulls) || [], unmatched: (d.result && d.result.unmatched) || [], candidates: (d.result && d.result.candidates) || null });
        if (d.code === 'login') { sent = false; env.status(d.message); env.needSetup(); return; }   /* wait for the bookmark to be clicked again */
        done({ ok: false, message: d.message || 'Could not sync right now.' });
      }));
      ping();
      /* No answer in 1.5 s: the Mashpia tab is new, was reloaded, or the bookmark was never clicked on it. */
      stops.push(env.timer(function () {
        if (sent) return;
        try { w.location.href = MARK_URL; } catch (e) {}
        env.status('Mashpia is open. Log in if it asks, then click the “B3 Mashpia Sync” bookmark on that tab.');
        env.needSetup();
        pingStop = env.repeat(ping, 1500);
      }, 1500));
      stops.push(env.timer(function () { if (!sent) done({ ok: false, message: 'Timed out waiting for the Mashpia tab. Press Sync to try again.' }); }, 300000));
    });
  }

  var api = { MASHPIA: MASHPIA, MARK_URL: MARK_URL, bookmarkletHref: bookmarkletHref, run: run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.B3MashpiaSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
