/* Daily Checklist -> Mashpia: the pure matching step. No network, no page access.
   Used by the Mashpia-tab script (mashpia-agent.js) and by the tests. Block comments only: this text is also inlined
   into a bookmarklet, so no line comments.

   Mashpia grid (captured from the real site): POST /api/missions/grid?action=get {type:"daily", date:<Julian day>}
   -> {data:{missions:[{grid_id,cat,disabled}], soldiers:[{user_id,name,registered,absent,marks:{grid_id:{done_qty}}}]}}.
   Three states per cell: check (Yes), X (No) and blank. Check is sent as a check. X replaces a check (sent as an uncheck, only for
   cells Mashpia shows checked). Blank means no change: it never overrides anything, and a check already in Mashpia is pulled
   into a blank cell on this side. Safety rules: cells already in the wanted state are skipped; greyed-out soldiers
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

  /* Common spellings of the same first name count as equal when matching loosely. */
  var SPELLINGS = { shalom: 'sholom', sholem: 'sholom', sholom: 'sholom', shulem: 'sholom', ber: 'berel', berel: 'berel', beryl: 'berel',
    moshe: 'moshe', moishe: 'moshe', moische: 'moshe', mosheh: 'moshe', moisha: 'moshe' };
  function looseKey(text) {
    return norm(text).split(' ').filter(Boolean).map(function (w) { return SPELLINGS[w] || w; }).sort().join(' ');
  }

  /* students: [{name, items:[names answered Yes], no:[names answered No]}] ->
     {sends:{grid_id:[user_id]}, clears:{grid_id:[user_id]}, pulls:[{name,items:[names]}], synced:[{name,userId}],
      notFound:[name], unmatched:[{id,name}], candidates:[Mashpia names nobody was matched to], greyed:[name], missingItems:[name]}
     A student is found by (1) the Mashpia name the teacher saved for them (st.mashpiaName), (2) the exact name, (3) a loose name
     (same words in any order, common spellings equal). A name that fits more than one soldier is never guessed.
     sends = checks to add in Mashpia; clears = checks to remove (the student's X); pulls = checks Mashpia has where this side is blank. */
  function plan(grid, students) {
    var missions = {}, byName = {}, byLoose = {}, used = {}, out = { sends: {}, clears: {}, pulls: [], synced: [], notFound: [], unmatched: [], candidates: [], greyed: [], missingItems: [] }, missing = {}, gidName = {};
    (grid.missions || []).forEach(function (m) {
      if (m && !m.disabled && typeof m.grid_id === 'number' && !(norm(m.cat) in missions)) { missions[norm(m.cat)] = m.grid_id; gidName[m.grid_id] = String(m.cat); }
    });
    (grid.soldiers || []).forEach(function (s) {
      if (s && typeof s.user_id === 'number') {
        (byName[nameKey(s.name)] = byName[nameKey(s.name)] || []).push(s);
        (byLoose[looseKey(s.name)] = byLoose[looseKey(s.name)] || []).push(s);
      }
    });
    (students || []).forEach(function (st) {
      var label = String((st && st.name) || '').trim(), saved = String((st && st.mashpiaName) || '').trim(), hit = [];
      if (saved) hit = byName[nameKey(saved)] || [];
      if (hit.length !== 1) hit = byName[nameKey(label)] || [];
      if (hit.length !== 1) hit = byLoose[looseKey(label)] || [];
      if (hit.length !== 1) { out.notFound.push(label); out.unmatched.push({ id: String((st && st.id) || ''), name: label }); return; }
      var sol = hit[0];
      used[sol.user_id] = 1;
      if (sol.registered === false || sol.absent) { out.greyed.push(label); return; }
      var marks = sol.marks && typeof sol.marks === 'object' ? sol.marks : {}, known = {}, pull = [];
      function isDone(gid) { var d = marks[String(gid)]; return !!(d && (d.done_qty || 0) >= 1); }
      (st.no || []).forEach(function (item) {
        var gid = missions[norm(item)];
        if (gid === undefined) { missing[String(item)] = 1; return; }
        known[gid] = 1;
        if (isDone(gid)) (out.clears[gid] = out.clears[gid] || []).push(sol.user_id);
      });
      (st.items || []).forEach(function (item) {
        var gid = missions[norm(item)];
        if (gid === undefined) { missing[String(item)] = 1; return; }
        known[gid] = 1;
        if (isDone(gid)) return;
        (out.sends[gid] = out.sends[gid] || []).push(sol.user_id);
      });
      Object.keys(marks).forEach(function (gid) { if (!known[gid] && gidName[gid] !== undefined && isDone(gid)) pull.push(gidName[gid]); });
      if (pull.length) out.pulls.push({ name: label, items: pull });
      if ((st.items || []).length || (st.no || []).length) out.synced.push({ name: label, userId: sol.user_id });
    });
    out.missingItems = Object.keys(missing).sort();
    (grid.soldiers || []).forEach(function (s) {
      if (s && typeof s.user_id === 'number' && !used[s.user_id] && String(s.name || '').trim()) out.candidates.push(String(s.name).trim());
    });
    out.candidates.sort(function (a, b) { return a.localeCompare(b); });
    return out;
  }

  /* Every roster student -> [{id, name, mashpiaName, items:[Yes item names], no:[No item names]}]. Students with no answers are
     included (both lists empty) so a check made in Mashpia can still be pulled into their blank cells. Demo/test students
     (st.demo) are left out entirely. mapping = {studentId: Mashpia name} saved by the teacher. */
  function buildStudents(dayAnswers, roster, mapping) {
    var out = [];
    (roster || []).forEach(function (st) {
      if (st.demo || /^demo_/.test(String(st.id || ''))) return;
      var a = dayAnswers && dayAnswers[st.id], its = (a && a.items) || {};
      function pick(v) {
        return Object.keys(its).filter(function (id) { return its[id] && its[id].v === v; })
          .sort(function (x, y) { return (its[x].o || 0) - (its[y].o || 0); })
          .map(function (id) { return String(its[id].n || id); });
      }
      out.push({ id: String(st.id || ''), name: st.name, mashpiaName: String((mapping && mapping[st.id]) || ''), items: pick(1), no: pick(0) });
    });
    return out;
  }

  /* Mashpia is the source of the checklist items: the grid's available missions (disabled == 0), in the grid's own
     order. The red star is Mashpia's mandatory mission (mandatory_qty >= 1). -> [{name, star, gridId}] */
  function itemsFromMashpia(missions) {
    var out = [], seen = {};
    (missions || []).forEach(function (m) {
      if (!m || m.disabled || typeof m.grid_id !== 'number') return;
      var name = String(m.cat == null ? '' : m.cat).trim().slice(0, 80), key = norm(name);
      if (!name || seen[key] || out.length >= 40) return;
      seen[key] = 1;
      out.push({ name: name, star: (Number(m.mandatory_qty) || 0) >= 1, gridId: m.grid_id });
    });
    return out;
  }

  /* New config/items for a class from Mashpia's items, or null when nothing changes.
     Config shape: {id:{name,star,order,removed}}. An item that already exists (same name) keeps its id, so old answers
     stay joined to it; new ones get "m<gridId>". Items Mashpia no longer lists are kept as removed, so past answers
     (which carry their own name snapshot) never change. configRaw null = the standard list (defaults). */
  function mergeItems(configRaw, mItems, defaults) {
    if (!mItems || !mItems.length) return null;
    var base = configRaw && typeof configRaw === 'object' ? configRaw : null;
    if (!base) { base = {}; (defaults || []).forEach(function (d, i) { base[d.id] = { name: d.name, star: !!d.star, order: i, removed: false }; }); }
    var byName = {}, out = {}, used = {};
    Object.keys(base).forEach(function (id) {
      var k = norm(base[id] && base[id].name);
      if (!(k in byName) || (base[byName[k]].removed && !base[id].removed)) byName[k] = id;
    });
    mItems.forEach(function (m, i) {
      var id = byName[norm(m.name)] || ('m' + m.gridId);
      if (used[id]) id = id + '-' + i;
      used[id] = 1;
      out[id] = { name: m.name, star: !!m.star, order: i, removed: false };
    });
    Object.keys(base).forEach(function (id) {
      if (out[id]) return;
      var b = base[id] || {};
      out[id] = { name: String(b.name || id), star: !!b.star, order: Number(b.order) || 0, removed: true };
    });
    var same = Object.keys(out).length === Object.keys(base).length && Object.keys(out).every(function (id) {
      var b = base[id]; if (!b) return false;
      return String(b.name || id) === out[id].name && !!b.star === out[id].star && (Number(b.order) || 0) === out[id].order && !!b.removed === out[id].removed;
    });
    return same ? null : out;
  }

  /* The one short line shown to the teacher. */
  function summary(r) {
    var nf = r.notFound || [], line = 'Synced ' + r.synced + (nf.length ? '' : r.synced === 1 ? ' student' : ' students');
    if (nf.length) line += ", couldn't find: " + nf.join(', ');
    if (r.greyed && r.greyed.length) line += ' (skipped greyed out: ' + r.greyed.join(', ') + ')';
    if (r.cleared) line += ' (removed ' + r.cleared + ' check' + (r.cleared === 1 ? '' : 's') + ' for X)';
    if (r.missingItems && r.missingItems.length) line += ' (not in Mashpia: ' + r.missingItems.join(', ') + ')';
    return line;
  }

  var api = { julianDay: julianDay, norm: norm, nameKey: nameKey, looseKey: looseKey, plan: plan, buildStudents: buildStudents, summary: summary,
    itemsFromMashpia: itemsFromMashpia, mergeItems: mergeItems };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.B3MashpiaCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
