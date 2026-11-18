/* "Sync to Mashpia" for the Daily Checklist teacher page.
   One press sends the selected day's Yes answers to Mashpia as checked marks (never unchecks anything).
   The Mashpia login is asked once, the first time, and is kept locked on the sync service (never in this browser).
   Needs sync-to-nigri/nigri-auth.js (window.NigriAuth) loaded first. The server does all matching by name. */
(function (root) {
  'use strict';
  function serverBase(globalValue, fallback) {
    var custom = String(globalValue || '').replace(/\/+$/, '');
    if (/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(custom) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(custom)) return custom;
    return fallback || 'https://nigrisync.onrender.com';
  }

  // Yes answers of the students who answered that day -> [{name, items:[item names]}]
  function buildStudents(dayAnswers, roster) {
    var out = [];
    (roster || []).forEach(function (st) {
      var a = dayAnswers && dayAnswers[st.id];
      if (!a || !a.items || !Object.keys(a.items).length) return;            // did not answer: nothing to send
      var yes = Object.keys(a.items).filter(function (id) { return a.items[id] && a.items[id].v === 1; })
        .sort(function (x, y) { return (a.items[x].o || 0) - (a.items[y].o || 0); })
        .map(function (id) { return String(a.items[id].n || id); });
      out.push({ name: st.name, items: yes });
    });
    return out;
  }

  function list(names) { return names.join(', '); }
  // The one short line shown to the teacher.
  function summary(r) {
    var line = 'Synced ' + r.synced + (r.not_found && r.not_found.length ? '' : r.synced === 1 ? ' student' : ' students');
    if (r.not_found && r.not_found.length) line += ", couldn't find: " + list(r.not_found);
    if (r.greyed && r.greyed.length) line += ' (skipped greyed out: ' + list(r.greyed) + ')';
    if (r.missing_items && r.missing_items.length) line += ' (not in Mashpia: ' + list(r.missing_items) + ')';
    return line;
  }

  function describe(status, body) {
    if (status === 401) return 'Please sign in with your teacher Google account first.';
    if (status === 404) return 'Mashpia sync is not turned on yet. Ask the owner.';
    if (status === 429) return 'Too many tries. Wait a minute.';
    if (body && typeof body.error === 'string' && status < 500) return body.error;
    if (body && typeof body.error === 'string' && status === 502) return body.error;
    return 'Could not sync right now. Try again in a minute.';
  }

  async function call(env, method, path, payload) {
    var token = await env.getToken();
    if (!token) return { ok: false, status: 401, message: describe(401) };
    var res;
    try {
      res = await env.fetch(env.base + path, {
        method: method, cache: 'no-store', credentials: 'omit',
        headers: Object.assign({ Authorization: 'Bearer ' + token }, payload ? { 'Content-Type': 'application/json' } : {}),
        body: payload ? JSON.stringify(payload) : undefined
      });
    } catch (e) { return { ok: false, message: 'Could not reach the sync service.' }; }
    var body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) return { ok: false, status: res.status, code: body && body.code, message: describe(res.status, body) };
    return { ok: true, body: body };
  }

  // env: {base, getToken, fetch, askLogin}  askLogin() -> Promise<{username,password}|null>   (null = teacher cancelled)
  async function run(env, date, students) {
    if (!students.length) return { ok: false, message: 'No student has answered on this day yet.' };
    var payload = { date: date, students: students };
    var r = await call(env, 'POST', '/mashpia-sync', payload);
    if (!r.ok && r.code === 'need_login') {
      var login = await env.askLogin(r.message === 'Mashpia login needed' ? '' : r.message);
      if (!login) return { ok: false, message: 'Not synced. Mashpia login is needed once.' };
      var saved = await call(env, 'PUT', '/mashpia-login', { username: login.username, password: login.password });
      login = null;
      if (!saved.ok) return { ok: false, message: saved.message };
      r = await call(env, 'POST', '/mashpia-sync', payload);
    }
    if (!r.ok) return { ok: false, message: r.message };
    return { ok: true, message: summary(r.body) };
  }

  var api = { serverBase: serverBase, buildStudents: buildStudents, summary: summary, run: run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.B3MashpiaSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
