/* Talks to the NigriSync "my Nigri login" routes (issue 550, step 2). Staging only for now.
   The password is only ever sent in one PUT and is never stored, logged or shown again: the server replies with
   {saved, hint, updatedAt} and nothing else. This file never contacts Nigri itself. */
(function (root) {
  'use strict';
  var STAGING_HOSTS = ['fun-torah-tools-staging.web.app', 'localhost', '127.0.0.1'];

  function isStagingHost(hostname) { return STAGING_HOSTS.indexOf(hostname) !== -1; }

  // The staging server address comes from window.NIGRI_LOGIN_SERVER (set on the staging site), or ?server= on localhost
  // only. It is never the live NigriSync address, so nothing here can reach the real service by accident.
  function serverBase(loc, globalValue) {
    var base = globalValue || '';
    if (!base && (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1')) {
      try { base = new URLSearchParams(loc.search).get('server') || ''; } catch (e) { base = ''; }
    }
    base = String(base).replace(/\/+$/, '');
    if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) return '';
    if (/nigrisync\.onrender\.com$/i.test(base)) return '';
    return base;
  }

  function describe(status, body) {
    if (status === 401) return 'Please sign in as a teacher first.';
    if (status === 404) return 'This feature is not turned on yet.';
    if (status === 429) return 'Too many tries. Wait a minute.';
    if (body && typeof body.error === 'string' && status < 500) return body.error;
    return 'Could not do that right now.';
  }

  function show(body) {
    if (!body || !body.saved) return { saved: false, text: 'No Nigri login saved.' };
    return { saved: true, text: 'Saved ✓ (username ending …' + String(body.hint || '') + ')' };
  }

  // One plain line per course: the label, and either "ready" or why it is off. Never shows IDs of other rooms.
  function courseLine(course) {
    return course.label + ' — ' + (course.available ? 'ready' : 'not available: ' + (course.reason || 'unknown'));
  }

  async function call(env, method, payload, path) {
    var token = await env.getToken();
    if (!token) return { ok: false, message: 'Please sign in as a teacher first.' };
    var res;
    try {
      res = await env.fetch(env.base + (path || '/nigri-login'), {
        method: method,
        headers: Object.assign({ Authorization: 'Bearer ' + token }, payload ? { 'Content-Type': 'application/json' } : {}),
        body: payload ? JSON.stringify(payload) : undefined,
        cache: 'no-store', credentials: 'omit'
      });
    } catch (e) { return { ok: false, message: 'Could not reach the server.' }; }
    var body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) return { ok: false, message: describe(res.status, body) };
    if (path) return { ok: true, grade: body && body.grade, courses: (body && body.courses) || [] };
    return Object.assign({ ok: true }, show(body));
  }

  var api = {
    isStagingHost: isStagingHost, serverBase: serverBase,
    status: function (env) { return call(env, 'GET'); },
    save: function (env, username, password) { return call(env, 'PUT', { username: username, password: password }); },
    remove: function (env) { return call(env, 'DELETE'); },
    courses: function (env, classId) { return call(env, 'GET', null, '/nigri-courses?class=' + encodeURIComponent(classId)); },
    courseLine: courseLine
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NigriLoginClient = api;
})(typeof window !== 'undefined' ? window : globalThis);
