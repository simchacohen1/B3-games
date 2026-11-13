/*
 * Weekly Shorashim — teacher page (STAGING ONLY).
 * Shows students x games for a chosen week, the most-missed words, and lets the
 * class teacher (or the owner) set the class's grade and current week.
 * A teacher only ever reads the classes on his own account; the database rules
 * refuse anything else.
 */
(function () {
  'use strict';

  var Data = window.WeeklyShorashimData, L = window.WeeklyShorashimLogic;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); };
  var localHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var onStaging = !!(window.B3_STAGING_FIREBASE_CONFIG && window.B3_STAGING_FIREBASE_CONFIG.projectId === 'fun-torah-tools-staging');
  if (!onStaging && !localHost) { $('status').textContent = 'Weekly Shorashim is being tested and is only available on the staging site.'; return; }

  if (!firebase.apps.length) firebase.initializeApp(window.B3_FIREBASE_CONFIG);
  var db = firebase.database(), api = window.B3SiteSettings, ws = (api && api.workspaceId) || 'b3-2026';
  var words = L.wordIndex(Data.WEEKS);
  var classes = [], current = '', view = null, reportWeek = 1, started = false;

  function classPath(id) { return window.B3_DATA_MODEL.class(ws, id); }
  function read(path) { return db.ref(path).once('value').then(function (s) { return s.val(); }); }
  function ago(t) {
    if (!t) return '';
    var d = (Date.now() - t) / 1000;
    if (d < 90) return 'just now';
    if (d < 3600) return Math.round(d / 60) + ' min ago';
    if (d < 86400) return Math.round(d / 3600) + ' hr ago';
    return new Date(t).toLocaleDateString();
  }

  // The owner may list every class; a teacher asks only for the classes on his account.
  async function classList(access) {
    var ids;
    if (access && access.role === 'admin') {
      var all = await read('b3Games/workspaces/' + ws + '/classes') || {};
      return Object.keys(all).filter(function (id) { return all[id] && all[id].active !== false; })
        .map(function (id) { return { id: id, name: String(all[id].name || id.toUpperCase()) }; });
    }
    ids = ((access && access.classIds) || []).filter(function (id) { return /^[A-Za-z0-9_-]{1,100}$/.test(id); });
    var rows = await Promise.all(ids.map(async function (id) {
      try {
        var parts = await Promise.all([read(classPath(id) + '/name'), read(classPath(id) + '/active')]);
        return parts[1] === false ? null : { id: id, name: String(parts[0] || id.toUpperCase()) };
      } catch (e) { return null; }
    }));
    return rows.filter(Boolean);
  }

  function drawTabs() {
    $('classTabs').innerHTML = classes.map(function (c) {
      return '<button type="button" data-c="' + esc(c.id) + '" class="' + (c.id === current ? 'on' : '') + '">' + esc(c.name) + '</button>';
    }).join('');
    Array.prototype.forEach.call($('classTabs').querySelectorAll('button'), function (b) {
      b.onclick = function () { current = b.dataset.c; drawTabs(); loadClass(true); };
    });
  }

  async function loadClass(resetWeek) {
    var c = classes.filter(function (x) { return x.id === current; })[0];
    if (!c) return;
    $('status').textContent = 'Loading ' + c.name + '…';
    try {
      var base = classPath(c.id);
      var parts = await Promise.all([
        read(base + '/members'), read(base + '/weeklyShorashimGrade'),
        read(base + '/weeklyShorashim/currentWeek'), read(base + '/weeklyShorashim/progress')
      ]);
      view = { cls: c, base: base, members: parts[0] || {}, grade: L.resolveGrade(parts[1]), gradeSaved: L.validGrade(parts[1]),
        setting: parts[2], week: L.currentWeek(parts[2], Date.now()), progress: parts[3] || {} };
      if (resetWeek || reportWeek > L.MAX_WEEK) reportWeek = view.week;
      $('body').classList.remove('hidden');
      drawSettings(); drawReport();
      $('status').textContent = c.name + ' — ' + view.grade + ', week ' + view.week + (view.setting && view.setting.held ? ' (held)' : '');
      $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (e) {
      console.error(e);
      $('body').classList.add('hidden');
      $('status').textContent = 'Could not load Weekly Shorashim for this class: ' + (e.message || e);
    }
  }

  function drawSettings() {
    $('grade').innerHTML = L.GRADES.map(function (g) { return '<option value="' + g + '"' + (g === view.grade ? ' selected' : '') + '>' + g + '</option>'; }).join('');
    $('week').value = view.week;
    $('held').checked = !!(view.setting && view.setting.held);
    var s = view.setting;
    $('weekInfo').textContent = !s ? 'Nothing saved yet, so this class is on week 1. Set a week to start; it then moves up by one every Sunday (US Eastern) until week 30.'
      : s.held ? 'Held on week ' + view.week + '. It will not move until you untick Hold.'
      : 'Week ' + view.week + ' now. It was set to week ' + s.week + ' on ' + new Date(s.setAt).toLocaleDateString() + ' and moves up by one every Sunday (US Eastern), up to week 30.';
    $('gradeSaved').textContent = view.gradeSaved ? '' : 'No grade saved yet — using B3.';
    $('gradeSaved').className = 'saved';
    $('weekSaved').textContent = ''; $('weekSaved').className = 'saved';
  }

  function note(id, text, bad) { $(id).textContent = text; $(id).className = 'saved' + (bad ? ' err' : ''); }

  async function saveGrade() {
    var grade = $('grade').value;
    if (!view || !L.validGrade(grade)) return;
    try {
      await db.ref(view.base + '/weeklyShorashimGrade').set(grade);
      await loadClass(false);
      note('gradeSaved', '✓ Saved. This class now sees the ' + grade + ' word list.');
    } catch (e) { note('gradeSaved', 'Not saved: ' + (e.message || e), true); }
  }

  // Saving always records "now", so the Sunday count starts again from today.
  async function saveWeek() {
    if (!view) return;
    var week = Number($('week').value);
    if (!(week >= 1 && week <= L.MAX_WEEK) || week % 1) { note('weekSaved', 'Choose a week from 1 to 30.', true); return; }
    try {
      await db.ref(view.base + '/weeklyShorashim/currentWeek').set(L.weekSetting(week, $('held').checked, Date.now()));
      await loadClass(true);
      note('weekSaved', '✓ Saved. The class is on week ' + view.week + ($('held').checked ? ' and held there.' : '.'));
    } catch (e) { note('weekSaved', 'Not saved: ' + (e.message || e), true); }
  }

  function studentRows() {
    var ids = {};
    Object.keys(view.members).forEach(function (id) { var m = view.members[id]; if (!m || m.active !== false) ids[id] = true; });
    Object.keys(view.progress).forEach(function (id) { ids[id] = true; });
    return Object.keys(ids).map(function (id) {
      var m = view.members[id] || {};
      return { id: id, name: String(m.name || id), games: (view.progress[id] || {})[reportWeek] || null };
    }).sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
  }

  function missedChips(list, limit) {
    return list.slice(0, limit).map(function (m) {
      var w = words[m.id];
      return w ? '<span class="w"><span class="he">' + esc(w.hebrew) + '</span> — ' + esc(w.english) + ' <b>×' + m.count + '</b></span>' : '';
    }).join('');
  }

  function drawReport() {
    $('reportWeekLabel').textContent = reportWeek;
    $('weeks').innerHTML = Data.WEEKS.map(function (w) {
      return '<button type="button" data-w="' + w.week + '" class="' + (w.week === reportWeek ? 'on' : w.week === view.week ? 'cur' : '') + '" title="' +
        (w.week === view.week ? 'Current week' : 'Week ' + w.week) + '">' + w.week + '</button>';
    }).join('');
    Array.prototype.forEach.call($('weeks').querySelectorAll('button'), function (b) {
      b.onclick = function () { reportWeek = Number(b.dataset.w); drawReport(); };
    });

    var rows = studentRows();
    $('headRow').innerHTML = '<th>Student</th>' + L.GAMES.map(function (g) { return '<th>' + g.emoji + ' ' + esc(g.label) + '</th>'; }).join('') + '<th>Missed most</th><th>Last played</th>';
    $('rows').innerHTML = rows.map(function (r) {
      if (!r.games) return '<tr class="none"><td>' + esc(r.name) + '</td><td colspan="' + (L.GAMES.length + 2) + '">Has not played week ' + reportWeek + ' yet</td></tr>';
      var last = 0;
      var cells = L.GAMES.map(function (g) {
        var rec = r.games[g.id];
        if (!rec) return '<td class="none">—</td>';
        last = Math.max(last, Number(rec.lastPlayed) || 0);
        return '<td class="score"><b>' + esc(rec.bestScore) + '</b> <span class="muted">(' + esc(rec.timesPlayed) + '×)</span></td>';
      }).join('');
      var missed = L.missedTotals([r.games]).slice(0, 3).map(function (m) { return words[m.id] ? '<span class="he">' + esc(words[m.id].hebrew) + '</span>' : ''; }).join(' &nbsp; ');
      return '<tr><td><b>' + esc(r.name) + '</b></td>' + cells + '<td>' + (missed || '—') + '</td><td>' + esc(ago(last)) + '</td></tr>';
    }).join('') || '<tr><td colspan="' + (L.GAMES.length + 3) + '" class="muted">No students in this class yet.</td></tr>';

    var classMissed = L.missedTotals(rows.map(function (r) { return r.games; }).filter(Boolean));
    $('missed').innerHTML = missedChips(classMissed, 12) || '<span class="muted">No missed words recorded for week ' + reportWeek + ' yet.</span>';
  }

  async function start(user, authorized, access) {
    if (!user) { $('status').textContent = 'Please sign in from the Fun Torah Tools Teacher area first.'; return; }
    if (!authorized) { $('status').textContent = 'This account is not authorized for Teacher Tools.'; return; }
    if (started) return;
    started = true;
    try {
      classes = await classList(access || {});
      if (!classes.length) { $('status').textContent = 'No classes are assigned to this teacher.'; return; }
      var names = {};
      classes.forEach(function (c) { names[c.id] = c.name || c.id; });
      current = await window.B3ClassGate.choose({ ids: classes.map(function (c) { return c.id; }), names: names,
        requested: new URLSearchParams(location.search).get('class') || '' });
      drawTabs();
      loadClass(true);
    } catch (e) { started = false; console.error(e); $('status').textContent = 'Could not load classes: ' + (e.message || e); }
  }

  $('saveGrade').onclick = saveGrade;
  $('saveWeek').onclick = saveWeek;
  $('refresh').onclick = function () { loadClass(false); };
  if (api && typeof api.onAuthStateChanged === 'function') api.onAuthStateChanged(start);
  else $('status').textContent = 'Teacher access could not start. Please refresh the page.';
  setTimeout(function () { if ($('status').textContent === 'Checking teacher access…') $('status').textContent = 'Teacher sign-in is taking too long. Refresh this page from Fun Torah Tools.'; }, 8000);
})();
