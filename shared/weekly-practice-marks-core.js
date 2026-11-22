/* Weekly practice marks for Nigri: pure calculation helpers (no Firebase, no page).
   Used by record_pesukim/weekly-nigri.js and by tests/weekly-practice-marks.test.cjs.

   Three marks per student per week:
     posuk  - Posuk Practice Scroll: average of the teacher's grades (0-10, x10 = %) for psukim graded that week.
              Reading + translation is ONE combined grade. Topic "Chumash".
     chidon - Chumash chidon: average of that week's comprehension scores. Topic "Chumash Comprehension".
     rashi  - Rashi reading: average of that week's graded Rashi readings (0-100). Topic "Chumash-Rashi".
   A tool the student did not use that week gives no mark for that tool. Every mark is type "homework".

   A week is Sunday 00:00 to Saturday 23:59:59, New York time. The mark is dated the Friday of that week. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WeeklyPracticeMarks = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TZ = 'America/New_York';
  const KINDS = Object.freeze({
    posuk:  { key: 'posuk',  topic: 'Chumash',               label: 'Posuk Practice', mark: 'Posuk Practice' },
    chidon: { key: 'chidon', topic: 'Chumash Comprehension', label: 'Chidon',         mark: 'Chumash Chidon' },
    rashi:  { key: 'rashi',  topic: 'Chumash-Rashi',         label: 'Rashi reading',  mark: 'Rashi Reading' }
  });
  const KIND_ORDER = Object.freeze(['posuk', 'chidon', 'rashi']);
  const TYPE = 'homework';

  // ---------- dates (all in New York time) ----------
  const pad = n => String(n).padStart(2, '0');
  function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? { y, mo, d } : null;
  }
  const isoOf = (y, mo, d) => y + '-' + pad(mo) + '-' + pad(d);
  function addDays(iso, n) {
    const p = parseIso(iso); if (!p) return null;
    const t = new Date(Date.UTC(p.y, p.mo - 1, p.d + n));
    return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  function nyParts(ms) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const o = {}; f.formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  }
  function nyDateIso(ms) { const p = nyParts(ms); return isoOf(p.y, p.mo, p.d); }
  // The instant (ms) when the given New York calendar day starts.
  function nyMidnightMs(iso) {
    const p = parseIso(iso); if (!p) return NaN;
    let guess = Date.UTC(p.y, p.mo - 1, p.d);
    for (let i = 0; i < 3; i++) {
      const g = nyParts(guess);
      const asUtc = Date.UTC(g.y, g.mo - 1, g.d, g.h, g.mi, g.s);
      const wanted = Date.UTC(p.y, p.mo - 1, p.d);
      guess += wanted - asUtc;
    }
    return guess;
  }
  function dayOfWeek(iso) { const p = parseIso(iso); return new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay(); } // 0 = Sunday
  function sundayOf(iso) { return addDays(iso, -dayOfWeek(iso)); }
  // {start (Sunday), end (Saturday), friday, from (ms, inclusive), to (ms, exclusive)} for the week containing `iso`.
  function weekRange(iso) {
    if (!parseIso(iso)) return null;
    const start = sundayOf(iso);
    return { start, end: addDays(start, 6), friday: addDays(start, 5), from: nyMidnightMs(start), to: nyMidnightMs(addDays(start, 7)) };
  }
  const inWeek = (ms, range) => Number.isFinite(Number(ms)) && Number(ms) >= range.from && Number(ms) < range.to;
  function weekLabel(range) { return range.start + ' to ' + range.end; }

  // ---------- grades ----------
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  // One graded Posuk Practice submission -> teacher grade 0-10, or null when it has no grade yet (waiting, deleted, ...).
  // The new 0-10 row stores `score`. Older gold/retry grades map the same way: gold = 10 minus the mistakes, retry = 0.
  function posukGrade10(sub) {
    if (!sub || typeof sub !== 'object') return null;
    const status = String(sub.status || '');
    if (status === 'pending' || status === 'deleted' || !status) return null;
    if (typeof sub.score === 'number' && Number.isFinite(sub.score)) return clamp(sub.score, 0, 10);
    if (status === 'gold') return clamp(10 - (Number(sub.mistakes) || 0), 0, 10);
    if (status === 'retry') return 0;
    if (status === 'scored' && Number.isFinite(Number(sub.pointsAwarded))) return clamp(Number(sub.pointsAwarded) - (Number(sub.bonus) || 0), 0, 10);
    return null;
  }
  const posukPercent = sub => { const g = posukGrade10(sub); return g === null ? null : Math.round(g * 10); };
  const avg = list => { const v = list.filter(n => typeof n === 'number' && Number.isFinite(n)); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };

  // ---------- collect one student ----------
  // input: { submissions: {id: sub}, attempts: {posukKey: {attemptId: attempt}}, rashi: [{grade, gradedAt}], rashiPending: n }
  // options: range, chidonScore(attempt) -> 0..100 | null, chidonTime(attempt) -> ms
  function collectStudent(input, range, options) {
    const o = options || {};
    const chidonScore = o.chidonScore || (a => (a && typeof a.comprehensionScore === 'number' ? a.comprehensionScore : null));
    const chidonTime = o.chidonTime || (a => a && a.timestamp);
    const posuk = [], chidon = [];
    let ungraded = 0;
    Object.values((input && input.submissions) || {}).forEach(sub => {
      if (!sub) return;
      const st = String(sub.status || '');
      if (st === 'pending') { if (inWeek(sub.submittedAt, range)) ungraded++; return; }
      const pct = posukPercent(sub);
      if (pct !== null && inWeek(sub.gradedAt, range)) posuk.push(pct);
    });
    Object.values((input && input.attempts) || {}).forEach(byAttempt => {
      Object.values(byAttempt || {}).forEach(a => {
        const s = chidonScore(a);
        if (typeof s === 'number' && Number.isFinite(s) && inWeek(chidonTime(a), range)) chidon.push(clamp(Math.round(s), 0, 100));
      });
    });
    const rashi = [];
    ((input && input.rashi) || []).forEach(r => {
      if (r && typeof r.grade === 'number' && Number.isFinite(r.grade) && inWeek(r.gradedAt, range)) rashi.push(clamp(Math.round(r.grade), 0, 100));
    });
    ungraded += Number(input && input.rashiPending) || 0;
    return {
      posuk: { n: posuk.length, mark: avg(posuk) },
      chidon: { n: chidon.length, mark: avg(chidon) },
      rashi: { n: rashi.length, mark: avg(rashi) },
      ungraded
    };
  }

  // ---------- matching practice students to Nigri names ----------
  const words = s => String(s || '').toLowerCase().replace(/[^a-z֐-׿ ]+/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  // practice student id (+ name) -> roster slug of the chosen class, or null. Same slug wins; otherwise the same set of name words.
  function matchRosterId(id, name, roster, nigriNames) {
    if (roster.includes(id)) return id;
    const w = words(name);
    if (!w) return null;
    const hit = roster.filter(sid => words(nigriNames[sid]) === w || words(String(sid).replace(/_/g, ' ')) === w);
    return hit.length === 1 ? hit[0] : null;
  }

  // ---------- Nigri request bodies ----------
  const markName = (kind, range) => KINDS[kind].mark + ' - week of ' + range.start;
  function nigriBodies(rows, range, classSection, nigriNames) {
    const bodies = [];
    KIND_ORDER.forEach(kind => {
      const students = rows.filter(r => r.result[kind].mark !== null).map(r => ({
        name: nigriNames[r.sid], mark: r.result[kind].mark, attendance: 'present',
        comment: kind === 'posuk' ? r.result[kind].n + ' graded posuk' + (r.result[kind].n === 1 ? '' : 'im') + ' averaged'
          : r.result[kind].n + ' ' + KINDS[kind].label + ' result' + (r.result[kind].n === 1 ? '' : 's') + ' averaged'
      }));
      if (!students.length) return;
      bodies.push({ kind, body: {
        class_section: classSection, topic: KINDS[kind].topic, test_name: markName(kind, range), type: TYPE,
        date: range.friday, description: KINDS[kind].label + ' average for the week ' + weekLabel(range) + '.', students
      } });
    });
    return bodies;
  }

  return { TZ, KINDS, KIND_ORDER, TYPE, parseIso, addDays, nyDateIso, nyMidnightMs, sundayOf, weekRange, inWeek, weekLabel,
    posukGrade10, posukPercent, avg, collectStudent, matchRosterId, markName, nigriBodies };
});
