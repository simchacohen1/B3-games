/* Rashi Letters teacher page: the "Who recorded" strip and the "Earlier" list. READ ONLY.
   Pure helpers (no page, no database): they only sort, filter, count and group rows that the page already has.
   Every number comes from the Rashi rows given here, never from other tools. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RashiHistoryCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  function startOfDay(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

  /* [from, to) in ms. "This week" runs from Sunday. "This month" from the 1st. */
  function range(key, now) {
    var today = startOfDay(now);
    if (key === 'today') return [today, today + DAY];
    if (key === 'yesterday') return [today - DAY, today];
    if (key === 'week') { var d = new Date(today); return [today - d.getDay() * DAY, today + DAY]; }
    if (key === 'month') { var m = new Date(today); m.setDate(1); return [m.getTime(), today + DAY]; }
    return [0, Infinity];
  }

  /* Label taken from the reward request's reason "Rashi Letters reading — <label>". */
  function labelFromReason(reason) {
    var s = String(reason || ''), i = s.indexOf(' — ');
    return i >= 0 ? s.slice(i + 3) : (s || 'Reading');
  }

  /* Readings known to the server list (rich: marks, recording) win over the same reading from the rewards history. */
  function mergeReadings(serverRows, historyRows) {
    var byId = {};
    (historyRows || []).forEach(function (r) { byId[r.id] = r; });
    (serverRows || []).forEach(function (r) { byId[r.id] = Object.assign({}, byId[r.id] || {}, r); });
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  /* Who recorded in a period: {sid: number of Rashi readings}. Practice rows never count. */
  function counts(rows, r) {
    var out = {};
    rows.forEach(function (x) {
      if (x.kind !== 'reading' || !x.sid) return;
      if (x.when >= r[0] && x.when < r[1]) out[x.sid] = (out[x.sid] || 0) + 1;
    });
    return out;
  }

  /* o = {sid: '', range: [from,to), text: ''} */
  function filter(rows, o) {
    var q = String(o.text || '').trim().toLowerCase(), r = o.range || [0, Infinity];
    return rows.filter(function (x) {
      if (o.sid && x.sid !== o.sid) return false;
      if (r[0] > 0 || r[1] !== Infinity) { if (!x.when || x.when < r[0] || x.when >= r[1]) return false; }
      if (q && (String(x.label) + ' ' + String(x.name)).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function headingFor(ms, now) {
    var d0 = startOfDay(ms), t = startOfDay(now);
    if (d0 === t) return 'Today';
    if (d0 === t - DAY) return 'Yesterday';
    var d = new Date(ms), sameYear = d.getFullYear() === new Date(now).getFullYear();
    return d.toLocaleDateString('en-US', sameYear ? { weekday: 'long', month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  /* Newest first, grouped by day. Rows with no time go in one last group. */
  function groupByDay(rows, now) {
    var sorted = rows.slice().sort(function (a, b) { return (b.when || 0) - (a.when || 0) || String(a.name).localeCompare(String(b.name)); });
    var groups = [], cur = null;
    sorted.forEach(function (x) {
      var key = x.when ? String(startOfDay(x.when)) : 'none';
      if (!cur || cur.key !== key) { cur = { key: key, heading: x.when ? headingFor(x.when, now) : 'No date', rows: [] }; groups.push(cur); }
      cur.rows.push(x);
    });
    return groups;
  }

  /* Chips for the strip: every student in the class, by name, with this period's count. */
  function chips(students, countMap) {
    return Object.keys(students || {}).map(function (sid) {
      var n = countMap[sid] || 0;
      return { sid: sid, name: String(students[sid] || sid), count: n, recorded: n > 0 };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  return { range: range, labelFromReason: labelFromReason, mergeReadings: mergeReadings, counts: counts, filter: filter, groupByDay: groupByDay, chips: chips, headingFor: headingFor, startOfDay: startOfDay };
});
