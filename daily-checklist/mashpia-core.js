/* Daily Checklist -> Mashpia: the pure matching step. No network, no page access.
   Used by the Mashpia-tab script (mashpia-agent.js) and by the tests. Block comments only: this text is also inlined
   into a bookmarklet, so no line comments.

   Mashpia grid (captured from the real site): POST /api/missions/grid?action=get {type:"daily", date:<Julian day>}
   -> {data:{missions:[{grid_id,cat,disabled}], soldiers:[{user_id,name,registered,absent,marks:{grid_id:{done_qty}}}]}}.
   Safety rules: only checked marks are ever sent (never unchecks); cells already checked are skipped; greyed-out soldiers
   (not registered, or absent that day) are skipped; only missions Mashpia shows as available (disabled == 0) match;
   ambiguous names are never guessed. */
(function (root) {
  'use strict';

  function julianDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
    return Math.round(d.getTime() / 86400000) + 2440588;
  }

  /* Case, spacing, punctuation and apostrophe-insensitive form (Hebrew letters are kept). */
  function norm(text) {
    var t = String(text == null ? '' : text).normalize('NFKC').toLowerCase();
    t = t.replace(/[’‘'`"]/g, '');
    return t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  /* Student names: word order does not matter ("Ari Greenberg" == "Greenberg, Ari"). */
  function nameKey(text) {
    return norm(text).split(' ').filter(Boolean).sort().join(' ');
  }

  /* students: [{name, items:[names answered Yes]}] ->
     {sends:{grid_id:[user_id]}, synced:[{name,userId}], notFound:[name], greyed:[name], missingItems:[name]} */
  function plan(grid, students) {
    var missions = {}, byName = {}, out = { sends: {}, synced: [], notFound: [], greyed: [], missingItems: [] }, missing = {};
    (grid.missions || []).forEach(function (m) {
      if (m && !m.disabled && typeof m.grid_id === 'number' && !(norm(m.cat) in missions)) missions[norm(m.cat)] = m.grid_id;
    });
    (grid.soldiers || []).forEach(function (s) {
      if (s && typeof s.user_id === 'number') (byName[nameKey(s.name)] = byName[nameKey(s.name)] || []).push(s);
    });
    (students || []).forEach(function (st) {
      var label = String((st && st.name) || '').trim(), hit = byName[nameKey(label)] || [];
      if (hit.length !== 1) { out.notFound.push(label); return; }
      var sol = hit[0];
      if (sol.registered === false || sol.absent) { out.greyed.push(label); return; }
      var marks = sol.marks && typeof sol.marks === 'object' ? sol.marks : {};
      (st.items || []).forEach(function (item) {
        var gid = missions[norm(item)];
        if (gid === undefined) { missing[String(item)] = 1; return; }
        var done = marks[String(gid)];
        if (done && (done.done_qty || 0) >= 1) return;
        (out.sends[gid] = out.sends[gid] || []).push(sol.user_id);
      });
      out.synced.push({ name: label, userId: sol.user_id });
    });
    out.missingItems = Object.keys(missing).sort();
    return out;
  }

  /* Yes answers of the students who answered that day -> [{name, items:[item names]}] */
  function buildStudents(dayAnswers, roster) {
    var out = [];
    (roster || []).forEach(function (st) {
      var a = dayAnswers && dayAnswers[st.id];
      if (!a || !a.items || !Object.keys(a.items).length) return;
      var yes = Object.keys(a.items).filter(function (id) { return a.items[id] && a.items[id].v === 1; })
        .sort(function (x, y) { return (a.items[x].o || 0) - (a.items[y].o || 0); })
        .map(function (id) { return String(a.items[id].n || id); });
      out.push({ name: st.name, items: yes });
    });
    return out;
  }

  /* The one short line shown to the teacher. */
  function summary(r) {
    var nf = r.notFound || [], line = 'Synced ' + r.synced + (nf.length ? '' : r.synced === 1 ? ' student' : ' students');
    if (nf.length) line += ", couldn't find: " + nf.join(', ');
    if (r.greyed && r.greyed.length) line += ' (skipped greyed out: ' + r.greyed.join(', ') + ')';
    if (r.missingItems && r.missingItems.length) line += ' (not in Mashpia: ' + r.missingItems.join(', ') + ')';
    return line;
  }

  var api = { julianDay: julianDay, norm: norm, nameKey: nameKey, plan: plan, buildStudents: buildStudents, summary: summary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.B3MashpiaCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
