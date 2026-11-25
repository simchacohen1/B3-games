/*
 * Class locks: one set of rules, used by the browser (student pages and the teacher's Locks panel) and by the server
 * (backend/functions has an identical copy, checked by a test). It decides what is locked for a class right now.
 *
 * What a class record holds (b3Games/workspaces/<ws>/classes/<classId>/locks):
 *   features/<featureId>   {locked:true, by, at}      the teacher's on/off switch (stays until switched back)
 *   schedules/<teacherUid> {name, rules:{<id>:{days:['mon',..], start:'09:00', end:'15:00', targets:['@games']}}}
 *   overrides/<key>        {state:'open'|'locked', until, by, byName, label}  a temporary manual unlock/lock
 *   opened/<teacherUid>    ms of the last time that teacher opened the class
 * A key (a target of a schedule rule, or an override) is a feature id, "@group" (all features of a group) or "*".
 *
 * Order, for one class and one feature:
 *   1. a temporary override that has not run out (the most specific key wins): open = unlocked, locked = locked.
 *   2. the teacher's switch (manual lock).
 *   3. a weekly schedule rule of ANY of the class's teachers that covers right now.
 *   4. otherwise open.
 * A student in several classes is locked if ANY of his classes locks the feature.
 */
(function (root) {
  'use strict';
  var TZ = 'America/New_York';
  var DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var GROUPS = Object.freeze([
    { id: 'learning', label: 'Learning', icon: '📚' },
    { id: 'games', label: 'Games', icon: '🎲' },
    { id: 'class', label: 'Class tools', icon: '🏫' },
    { id: 'rewards', label: 'Rewards', icon: '⭐' }
  ]);
  // Every student feature. A page declares which one it is with data-feature (see tests/student-lock-pages.test.cjs).
  var FEATURES = Object.freeze([
    { id: 'posuk-practice-scroll', label: 'Posuk & Mishnayos Practice', icon: '📜', group: 'learning' },
    { id: 'chumash-quiz', label: 'Chumash חידון', icon: '🧠', group: 'learning' },
    { id: 'record-mishnayos', label: 'Mishnayos Practice', icon: '📖', group: 'learning' },
    { id: 'record-mishnayos-quiz', label: 'Mishnayos חידון', icon: '🧠', group: 'learning' },
    { id: 'mishnayos-practice', label: 'Mishnayos Practice (classic)', icon: '📖', group: 'learning' },
    { id: 'chazara', label: 'Chazara', icon: '🔁', group: 'learning' },
    { id: 'shorashim', label: 'Shorashim', icon: '🌱', group: 'learning' },
    { id: 'rashi-letters', label: 'Rashi Letters', icon: '✍️', group: 'learning' },
    { id: 'yiddish', label: 'Yiddish', icon: '🗣️', group: 'learning' },
    { id: 'gematria', label: 'Gematria', icon: '🔢', group: 'learning' },
    { id: 'halacha', label: 'Halacha', icon: '📚', group: 'learning' },
    { id: 'sefer-hamitzvos', label: 'Sefer HaMitzvos', icon: '📕', group: 'learning' },
    { id: 'weekly-quiz', label: 'Weekly Quiz', icon: '📝', group: 'learning' },
    { id: 'word-bank', label: 'Word Bank', icon: '🔤', group: 'learning' },
    { id: 'homework', label: 'Homework', icon: '🎒', group: 'learning' },
    { id: 'davening', label: 'Davening players', icon: '🙏', group: 'learning' },
    { id: 'chayus-meter', label: 'Chayus Meter', icon: '🔥', group: 'learning' },
    { id: 'game-show', label: 'Game Show', icon: '🎤', group: 'games' },
    { id: 'multiplayer-center', label: 'Arcade (all multiplayer games)', icon: '🎲', group: 'games' },
    { id: 'class-pointer', label: 'Class Pointer (lessons, whiteboards, screen sharing)', icon: '👆', group: 'class' },
    { id: 'class-gallery', label: 'Class Gallery', icon: '🖼️', group: 'class' },
    { id: 'daily-checklist', label: 'Daily Checklist', icon: '✅', group: 'class' },
    { id: 'chavrusa', label: 'Chavrusa Calendar', icon: '📅', group: 'class' },
    { id: 'work-timer', label: 'Work Timer', icon: '⏱️', group: 'class' },
    { id: 'student-rewards', label: 'BrightPath rewards', icon: '⭐', group: 'rewards' }
  ]);
  var BY_ID = {}; FEATURES.forEach(function (f) { BY_ID[f.id] = f; });
  var GROUP_IDS = {}; GROUPS.forEach(function (g) { GROUP_IDS[g.id] = true; });
  var MAX_RULES = 20, DEFAULT_CLASS_MINUTES = 45;

  function isTarget(t) { return typeof t === 'string' && (t === '*' || (t.charAt(0) === '@' && GROUP_IDS[t.slice(1)] === true) || BY_ID[t] !== undefined); }
  function covers(target, feature) { return target === '*' || target === feature.id || target === '@' + feature.group; }
  function specificity(key) { return key === '*' ? 0 : key.charAt(0) === '@' ? 1 : 2; }

  // ---- time (always the school's New York clock) ----
  var partsFormat = null;   // made once: pages re-check every second
  function nyParts(ms) {
    var f = partsFormat || (partsFormat = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
    var p = {}; f.formatToParts(new Date(ms)).forEach(function (x) { if (x.type !== 'literal') p[x.type] = x.value; });
    var day = String(p.weekday || '').slice(0, 3).toLowerCase();
    return { day: day, minutes: (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10) };
  }
  function minutesOf(value) {
    var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  }
  function dayBefore(day) { return DAYS[(DAYS.indexOf(day) + 6) % 7]; }
  // Does the rule cover this moment? A window that ends earlier than it starts runs past midnight into the next day.
  function ruleCovers(rule, parts) {
    var s = minutesOf(rule && rule.start), e = minutesOf(rule && rule.end);
    if (s === null || e === null || s === e || !Array.isArray(rule.days)) return false;
    if (s < e) return rule.days.indexOf(parts.day) >= 0 && parts.minutes >= s && parts.minutes < e;
    return (rule.days.indexOf(parts.day) >= 0 && parts.minutes >= s) || (rule.days.indexOf(dayBefore(parts.day)) >= 0 && parts.minutes < e);
  }
  // When the window that covers `ms` ends (ms), or null.
  function ruleEnds(rule, parts, ms) {
    var e = minutesOf(rule.end), s = minutesOf(rule.start);
    var left = e > parts.minutes && (s < e || parts.minutes < e) ? e - parts.minutes : e + 1440 - parts.minutes;
    return ms - (ms % 60000) + left * 60000;
  }
  function rulesOf(schedule) {
    var r = schedule && schedule.rules; if (!r || typeof r !== 'object') return [];
    return Object.keys(r).map(function (id) { var x = r[id]; return x && typeof x === 'object' ? Object.assign({ id: id }, x) : null; }).filter(Boolean);
  }

  // ---- rules a teacher saves ----
  function normalizeRules(input) {
    var list = Array.isArray(input) ? input : Object.keys(input || {}).map(function (id) { return Object.assign({ id: id }, input[id]); });
    if (list.length > MAX_RULES) throw new Error('At most ' + MAX_RULES + ' schedule lines.');
    var out = {};
    list.forEach(function (r, i) {
      if (!r || typeof r !== 'object') throw new Error('Invalid schedule line.');
      var days = Array.isArray(r.days) ? r.days.filter(function (d, k, a) { return DAYS.indexOf(d) >= 0 && a.indexOf(d) === k; }) : [];
      if (!days.length) throw new Error('Pick at least one day.');
      var s = minutesOf(r.start), e = minutesOf(r.end);
      if (s === null || e === null) throw new Error('Times must look like 09:00.');
      if (s === e) throw new Error('Start and end must differ (for all day use 00:00 to 23:59).');
      var targets = Array.isArray(r.targets) ? r.targets.filter(function (t, k, a) { return isTarget(t) && a.indexOf(t) === k; }) : [];
      if (!targets.length) throw new Error('Pick what to lock.');
      var id = /^[A-Za-z0-9_-]{1,40}$/.test(String(r.id || '')) ? String(r.id) : 'r' + (i + 1);
      out[id] = { days: days, start: r.start, end: r.end, targets: targets, label: String(r.label || '').slice(0, 60) };
    });
    return out;
  }

  // ---- what is locked ----
  function overrideFor(locks, feature, now) {
    var keys = [feature.id, '@' + feature.group, '*'];
    for (var i = 0; i < keys.length; i++) {
      var o = locks && locks.overrides && locks.overrides[keys[i]];
      if (o && (o.state === 'open' || o.state === 'locked') && Number(o.until) > now) return Object.assign({ key: keys[i] }, o);
    }
    return null;
  }
  // One feature, one class.
  function featureState(locks, feature, now) {
    var ov = overrideFor(locks, feature, now);
    if (ov) return { locked: ov.state === 'locked', kind: ov.state === 'locked' ? 'override-locked' : 'override-open', until: Number(ov.until), byName: ov.byName || '', label: ov.label || '' };
    if (locks && locks.features && locks.features[feature.id] && locks.features[feature.id].locked === true) return { locked: true, kind: 'manual' };
    var parts = nyParts(now), schedules = (locks && locks.schedules) || {}, hits = [];
    Object.keys(schedules).forEach(function (uid) {
      rulesOf(schedules[uid]).forEach(function (rule) {
        if ((rule.targets || []).some(function (t) { return covers(t, feature); }) && ruleCovers(rule, parts)) {
          hits.push({ uid: uid, teacherName: String(schedules[uid].name || ''), label: rule.label || '', until: ruleEnds(rule, parts, now) });
        }
      });
    });
    if (hits.length) return { locked: true, kind: 'schedule', schedules: hits, until: hits.reduce(function (m, h) { return Math.max(m, h.until); }, 0), teacherName: hits[0].teacherName };
    return { locked: false, kind: 'open' };
  }
  // Every feature, one class: { featureId: state }.
  function evaluate(locks, now) {
    var out = {}; FEATURES.forEach(function (f) { out[f.id] = featureState(locks, f, now); }); return out;
  }
  // A student in several classes: locked if any class locks it.
  function evaluateStudent(lockList, now) {
    var out = {};
    FEATURES.forEach(function (f) {
      var states = lockList.map(function (l) { return featureState(l, f, now); });
      out[f.id] = states.find(function (s) { return s.locked; }) || states[0] || { locked: false, kind: 'open' };
    });
    return out;
  }

  // ---- who has the class ----
  // The teacher whose own schedule covers right now; if several, the one who opened the class most recently. With no
  // schedule covering now, the teacher who most recently opened the class. null when nobody ever has.
  function holderOf(locks, teacherUids, now) {
    var schedules = (locks && locks.schedules) || {}, opened = (locks && locks.opened) || {}, parts = nyParts(now);
    var latest = function (a, b) { return (Number(opened[b]) || 0) - (Number(opened[a]) || 0) || String(a).localeCompare(String(b)); };
    var covering = teacherUids.filter(function (uid) { return rulesOf(schedules[uid]).some(function (r) { return ruleCovers(r, parts); }); });
    if (covering.length) return { uid: covering.sort(latest)[0], why: 'scheduled' };
    var opening = teacherUids.filter(function (uid) { return Number(opened[uid]) > 0; });
    if (opening.length) return { uid: opening.sort(latest)[0], why: 'opened' };
    return null;
  }
  // "Until end of class": the end of the holder's own schedule line covering now; otherwise a default length.
  function endOfClass(locks, uid, now) {
    var parts = nyParts(now), hit = rulesOf(locks && locks.schedules && locks.schedules[uid]).filter(function (r) { return ruleCovers(r, parts); })[0];
    return hit ? { until: ruleEnds(hit, parts, now), fromSchedule: true } : { until: now + DEFAULT_CLASS_MINUTES * 60000, fromSchedule: false };
  }

  // ---- words for the screen ----
  function clock(ms) { return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(ms)); }
  function describe(state) {
    if (!state) return '';
    if (state.kind === 'override-open') return 'Unlocked by ' + (state.byName || 'your teacher') + ' until ' + clock(state.until);
    if (state.kind === 'override-locked') return 'Locked by ' + (state.byName || 'your teacher') + ' until ' + clock(state.until);
    if (state.kind === 'manual') return 'Locked by your teacher';
    if (state.kind === 'schedule') return 'Locked by ' + (state.teacherName ? state.teacherName + '\'s' : 'a') + ' schedule until ' + clock(state.until);
    return 'Open';
  }

  var api = { TZ: TZ, DAYS: DAYS, GROUPS: GROUPS, FEATURES: FEATURES, MAX_RULES: MAX_RULES, DEFAULT_CLASS_MINUTES: DEFAULT_CLASS_MINUTES,
    isTarget: isTarget, specificity: specificity, nyParts: nyParts, minutesOf: minutesOf, ruleCovers: ruleCovers, rulesOf: rulesOf,
    normalizeRules: normalizeRules, featureState: featureState, evaluate: evaluate, evaluateStudent: evaluateStudent,
    holderOf: holderOf, endOfClass: endOfClass, describe: describe, clock: clock };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.B3StudentLockCore = api;
})(typeof window === 'object' ? window : globalThis);
