/* Activity History: one list of what students did in every tool. READ ONLY.
   This file only turns data that other pages already save into rows for a table.
   It never writes anything, and it does not change how any tool saves, marks or awards points.
   Used by activity-history/index.html (all tools) and by the "History" tab on each tool's teacher page. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ActivityHistoryCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* id is also the value of ?tool= in the page address. */
  var TOOLS = [
    { id: 'posuk', label: 'Posuk Practice', icon: '📜', page: 'record_pesukim/teacher.html' },
    { id: 'chazara', label: 'Chazara', icon: '🔁', page: 'chazara/teacher.html' },
    { id: 'shorashim', label: 'Shorashim', icon: '🌳', page: 'shorashim/teacher.html' },
    { id: 'rashi', label: 'Rashi Letters', icon: 'אב', page: 'rashi-letters/teacher.html' },
    { id: 'chayus', label: 'Chayus Meter', icon: '🔥', page: 'chayus-meter/teacher.html' },
    { id: 'daily', label: 'Daily Points', icon: '✅', page: 'student-rewards/teacher.html?tab=Daily%20Points' },
    { id: 'prize', label: 'Prize Store', icon: '🎁', page: 'student-rewards/teacher.html?tab=Rewards' },
    { id: 'points', label: 'Teacher Points', icon: '🌟', page: 'student-rewards/teacher.html?tab=Points%20Dashboard' },
    { id: 'quiz', label: 'Weekly Quiz', icon: '📝', page: 'weekly-quiz/teacher.html' }
  ];
  var TOOL_BY_ID = {};
  TOOLS.forEach(function (t) { TOOL_BY_ID[t.id] = t; });

  var obj = function (v) { return v && typeof v === 'object' ? v : {}; };
  var num = function (v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    var n = parseFloat(String(v == null ? '' : v).replace('%', ''));
    return isFinite(n) ? n : null;
  };
  var pct = function (v) { return v === null || v === undefined ? null : Math.round(v); };
  function entries(v) {
    if (Array.isArray(v)) return v.map(function (x, i) { return [i, x]; }).filter(function (p) { return p[1] && typeof p[1] === 'object'; });
    return Object.keys(obj(v)).map(function (k) { return [k, v[k]]; }).filter(function (p) { return p[1] && typeof p[1] === 'object'; });
  }
  function timeOf(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    var n = Number(v);
    if (isFinite(n) && n > 0) return n;
    var p = Date.parse(String(v == null ? '' : v));
    return isFinite(p) ? p : 0;
  }
  function posukLabel(key) {
    var m = String(key).match(/(\d+)\D+(\d+)/);
    return m ? 'Perek ' + m[1] + ':' + m[2] : String(key);
  }

  /* Same scoring rules as the Student Report (student-report/index.html), so numbers match. */
  var readScore = function (a) { return a ? num(a.hebrewFinalScore != null ? a.hebrewFinalScore : a.hebrewScore) : null; };
  function verdictPct(list, idxKey, totalHint) {
    if (!list.length) return null;
    var correct = list.filter(function (p) { var c = p[1]; return String(c.finalVerdict || c.verdict || '').toLowerCase() === 'correct'; }).length;
    var hi = Math.max.apply(null, list.map(function (p) { var c = p[1]; return Number.isInteger(c[idxKey]) ? c[idxKey] : Number(p[0]) || 0; })) + 1;
    var total = Math.max(Number(totalHint) || 0, hi, list.length);
    return total ? Math.round(correct / total * 100) : null;
  }
  var transScore = function (a) {
    if (!a) return null;
    var c = entries(a.translationChunkResults);
    return c.length ? verdictPct(c, 'chunkIndex', a.translationTotal) : num(a.translationScore);
  };
  var compScore = function (a) {
    if (!a) return null;
    var q = entries(a.questionResults);
    return q.length ? verdictPct(q, 'questionIndex', a.questionTotal) : num(a.comprehensionScore != null ? a.comprehensionScore : a.questionScore);
  };

  /* Every row has the same shape. who = {sid, name, classId, className}. */
  function mk(who, tool, when, what, result, status, extra) {
    var r = {
      id: tool + ':' + who.classId + ':' + who.sid + ':' + (extra && extra.key != null ? extra.key : when + ':' + what),
      sid: who.sid, student: who.name, classId: who.classId, className: who.className || who.classId,
      tool: tool, when: when || 0, what: what || '', result: result || '', status: status || ''
    };
    if (extra) Object.keys(extra).forEach(function (k) { if (k !== 'key') r[k] = extra[k]; });
    return r;
  }

  /* ---- Posuk Practice: one row per try (posukPractice/attempts/<student>/<posuk>/<try>) ---- */
  function posukRows(who, attempts) {
    var out = [];
    Object.keys(obj(attempts)).forEach(function (key) {
      Object.keys(obj(attempts[key])).forEach(function (tid) {
        var a = attempts[key][tid];
        if (!a || typeof a !== 'object') return;
        var t = num(a.timestamp) || 0;
        var read = readScore(a), tr = transScore(a), cp = compScore(a);
        var parts = [];
        if (read !== null) parts.push('Reading ' + pct(read) + '%');
        if (tr !== null) parts.push('Translation ' + pct(tr) + '%');
        if (cp !== null) parts.push('Questions ' + pct(cp) + '%');
        var disputed = a.hebrewDisputeStatus && a.hebrewDisputeStatus !== 'resolved';
        var status = disputed ? 'Disputed' : parts.length ? 'Scored' : 'Not scored yet';
        out.push(mk(who, 'posuk', t, posukLabel(key), parts.join(' · ') || '—', status, { key: key + '/' + tid, posukKey: key }));
      });
    });
    return out;
  }

  /* ---- Chazara: one row per saved chazara (posukPractice/chazara/events/<student>) ---- */
  function chazaraRows(who, events) {
    var out = [];
    entries(events).forEach(function (p) {
      var e = p[1];
      if (e.reviewApplied !== true) return;
      var what = e.perek && e.posuk ? 'Perek ' + e.perek + ':' + e.posuk : posukLabel(e.posukKey || '');
      var status = e.removed === true ? 'Removed' : (e.teacherRejected === true || e.pointRequestStatus === 'rejected') ? 'Rejected'
        : e.pointRequestStatus === 'pending' ? 'Waiting for approval' : 'Counted';
      var result = (e.reviewNumber ? 'Chazara #' + e.reviewNumber : 'Chazara') + (e.recorded === true ? ' · recorded' : '');
      var hasAudio = e.recorded === true && !!(e.storagePath || e.audioURL) && e.removed !== true;
      out.push(mk(who, 'chazara', num(e.createdAt) || 0, what, result, status, {
        key: p[0], audioPath: hasAudio ? (e.storagePath || '') : '', audioUrl: hasAudio ? (e.audioURL || '') : ''
      }));
    });
    return out;
  }

  /* ---- Shorashim: one row per card learned ---- */
  function shorashimRows(who, sh) {
    var out = [];
    entries(obj(sh).cards).forEach(function (p) {
      var c = p[1];
      if (!c.learnedAt) return;
      var word = String(c.word || c.hebrew || c.root || c.itemId || c.wordId || p[0]);
      out.push(mk(who, 'shorashim', num(c.learnedAt) || 0, word, 'Card learned' + (c.itemType ? ' · ' + c.itemType : ''), 'Learned', { key: p[0] }));
    });
    return out;
  }

  /* ---- Chayus Meter: one row per recorded day (server history, see chayus-meter/history.js) ---- */
  function chayusRows(who, history) {
    var out = [];
    var st = history && history.students && history.students[who.sid];
    Object.keys(obj(st && st.days)).forEach(function (day) {
      var x = st.days[day];
      if (!x) return;
      var when = Date.parse(day + 'T12:00:00');
      var points = Number(x.points) || 0;
      var mins = Number(x.minutes) || 0;
      out.push(mk(who, 'chayus', isFinite(when) ? when : 0, (mins % 1 === 0 ? mins : mins.toFixed(1)) + ' counted voice minutes',
        (x.level ? 'Level ' + x.level + (x.levelName ? ' · ' + x.levelName : '') : 'No level reached') + ' · ' + points + (points === 1 ? ' point' : ' points'),
        x.level ? 'Level reached' : 'Recorded', { key: day }));
    });
    return out;
  }

  /* ---- Weekly Quiz: one row per quiz attempt that was started (B3QuizHistory.buildHistory) ---- */
  function quizRows(who, hist) {
    var out = [];
    ((hist && hist.quizzes) || []).forEach(function (z) {
      (z.attempts || []).forEach(function (a, i) {
        if (a.status === 'not_started') return;
        var done = a.status === 'completed';
        out.push(mk(who, 'quiz', num(a.date) || num(z.lastDate) || num(z.date) || 0, z.title || 'Weekly Quiz',
          done ? a.correct + ' / ' + a.total + ' (' + a.pct + '%)' : (a.answered || 0) + ' of ' + a.total + ' answered',
          done ? 'Completed' : 'In progress', { key: z.key + '/' + i }));
      });
    });
    return out;
  }

  /* ---- Student Rewards ledger: Daily Points, Prize Store, teacher points, Rashi recordings ----
     root = the same object the Student Rewards teacher page loads (dailyAwards, pointRequests,
     pointAdjustments, redemptionsByStudent, rewards). people = {sid: {name, classId, className}}. */
  function dailyParts(award) {
    var total = Number(obj(award).points || 0), by = obj(award).byCategory;
    if (by && typeof by === 'object') {
      var parts = Object.keys(by).map(function (k) { var x = by[k] || {}; return { category: String(x.category || ''), rating: String(x.rating || ''), points: Number(x.points || 0) }; })
        .filter(function (x) { return x.category && x.points; });
      var sum = parts.reduce(function (a, x) { return a + x.points; }, 0);
      if (parts.length && sum === total) return parts;
    }
    return total ? [{ category: '', rating: '', points: total }] : [];
  }
  function whoFor(people, sid, classId) {
    var p = people[sid];
    if (!p) return null;
    return { sid: sid, name: p.name, classId: classId || p.classId, className: (classId && p.classNames && p.classNames[classId]) || p.className };
  }
  var starText = function (n) { return (n > 0 ? '+' : '') + n + ' ★'; };
  function rewardRows(rootData, people) {
    var r = obj(rootData), out = [];
    Object.keys(obj(r.dailyAwards)).forEach(function (sid) {
      Object.keys(obj(r.dailyAwards[sid])).forEach(function (cid) {
        Object.keys(obj(r.dailyAwards[sid][cid])).forEach(function (date) {
          var award = r.dailyAwards[sid][cid][date];
          var who = whoFor(people, sid, cid); if (!who) return;
          var when = timeOf(obj(award).savedAt) || Date.parse(date + 'T12:00:00') || 0;
          dailyParts(award).forEach(function (p) {
            out.push(mk(who, 'daily', when, p.category ? p.category + (p.rating ? ' — ' + p.rating : '') : 'Daily Points', starText(p.points), 'Posted', { key: date + ':' + p.category }));
          });
        });
      });
    });
    Object.keys(obj(r.pointRequests)).forEach(function (id) {
      var item = obj(r.pointRequests[id]);
      var source = String(item.source || '');
      if (source !== 'rashi-recording') return; /* the other tools show their own events */
      var who = whoFor(people, String(item.rewardStudentId || ''), item.classId); if (!who) return;
      var st = String(item.status || 'pending');
      var amount = Number(st === 'approved' ? (item.actualAmount != null ? item.actualAmount : item.amount) : item.amount) || 0;
      out.push(mk(who, 'rashi', timeOf(st === 'approved' ? (item.reviewedAt || item.createdAt) : item.createdAt),
        String(item.reason || 'Recorded reading'), 'Recorded reading · ' + starText(amount),
        st === 'approved' ? 'Approved' : st === 'rejected' ? 'Rejected' : 'Waiting for approval', { key: id }));
    });
    Object.keys(obj(r.pointAdjustments)).forEach(function (id) {
      var item = obj(r.pointAdjustments[id]);
      var who = whoFor(people, String(item.studentId || ''), item.classId); if (!who) return;
      var amount = Number(item.amount || 0); if (!amount) return;
      out.push(mk(who, 'points', timeOf(item.createdAt), String(item.reason || 'Teacher adjustment'), starText(amount), item.undoneBy ? 'Undone' : 'Posted', { key: id }));
    });
    Object.keys(obj(r.redemptionsByStudent)).forEach(function (sid) {
      Object.keys(obj(r.redemptionsByStudent[sid])).forEach(function (key) {
        var item = obj(r.redemptionsByStudent[sid][key]);
        var who = whoFor(people, sid, item.classId); if (!who) return;
        var cost = Number(item.cost || 0);
        var name = (obj(obj(r.rewards)[item.rewardId]).name) || item.rewardName || 'Reward';
        var st = String(item.status || 'pending');
        out.push(mk(who, 'prize', timeOf(item.requestedAt), name, cost ? '−' + cost + ' ★' : '—',
          st.charAt(0).toUpperCase() + st.slice(1), { key: sid + '/' + key }));
      });
    });
    return out;
  }

  /* ---- Filters ---- */
  function dayStart(s) { if (!s) return 0; var t = new Date(s + 'T00:00:00').getTime(); return isFinite(t) ? t : 0; }
  function dayEnd(s) { if (!s) return Infinity; var t = new Date(s + 'T23:59:59.999').getTime(); return isFinite(t) ? t : Infinity; }
  /* f = {student: id|'', classId: id|'', tool: id|'', from: 'YYYY-MM-DD'|'', to: 'YYYY-MM-DD'|'', text: ''} */
  function applyFilters(rows, f) {
    f = f || {};
    var from = dayStart(f.from), to = dayEnd(f.to), q = String(f.text || '').trim().toLowerCase();
    var tools = f.tool ? String(f.tool).split(',') : null; /* one tool id, or several separated by commas */
    return rows.filter(function (r) {
      if (f.student && r.sid !== f.student) return false;
      if (f.classId && r.classId !== f.classId) return false;
      if (tools && tools.indexOf(r.tool) < 0) return false;
      if ((from || to !== Infinity) && (!r.when || r.when < from || r.when > to)) return false;
      if (q && (r.student + ' ' + r.what + ' ' + r.result + ' ' + r.status).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  /* Newest first. Rows with no time go last. */
  function sortNewest(rows) {
    return rows.slice().sort(function (a, b) { return (b.when || 0) - (a.when || 0) || String(a.student).localeCompare(String(b.student)) || (a.id < b.id ? -1 : 1); });
  }
  function dedupe(rows) {
    var seen = {}, out = [];
    rows.forEach(function (r) { if (!seen[r.id]) { seen[r.id] = 1; out.push(r); } });
    return out;
  }

  /* Where tapping a row goes: the tool's own teacher page, on the same class and student when the page understands them. */
  function rowHref(row) {
    var t = TOOL_BY_ID[row.tool];
    if (!t) return '';
    var page = t.page, sep = page.indexOf('?') >= 0 ? '&' : '?';
    return page + sep + 'class=' + encodeURIComponent(row.classId) + '&student=' + encodeURIComponent(row.sid);
  }

  return { TOOLS: TOOLS, TOOL_BY_ID: TOOL_BY_ID, posukRows: posukRows, chazaraRows: chazaraRows, shorashimRows: shorashimRows,
    chayusRows: chayusRows, quizRows: quizRows, rewardRows: rewardRows, applyFilters: applyFilters, sortNewest: sortNewest,
    dedupe: dedupe, rowHref: rowHref, posukLabel: posukLabel };
});
