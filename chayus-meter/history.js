/* Chayus Meter history for teachers: the teacher dashboard and the full student report both use this.
   Read only. It asks the server (studentRewardsAutoAward, action "chayus-class-history") for each student's
   recorded days (level reached, counted voice minutes, Chayus points) and never changes how the meter counts
   or awards points. It sends no sound and no student name: just the class and how many days back. */
(function (root) {
  'use strict';

  function schoolDayOf(ms) {
    // The same New York school day the server records under.
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
    const p = {};
    parts.forEach(x => { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }

  function endpointFor(projectId) {
    return 'https://us-central1-' + projectId + '.cloudfunctions.net/studentRewardsAutoAward';
  }

  // Returns the server's answer, or throws an Error with a message a teacher can read.
  async function fetchHistory(opts) {
    const o = opts || {};
    if (!o.idToken) throw new Error('Teacher sign-in required.');
    if (!o.classId) throw new Error('Choose a class.');
    if (!o.projectId) throw new Error('Missing project.');
    const doFetch = o.fetchImpl || root.fetch.bind(root);
    const response = await doFetch(endpointFor(o.projectId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + o.idToken },
      body: JSON.stringify({ action: 'chayus-class-history', classId: o.classId, days: o.days || 30 })
    });
    let data = {};
    try { data = await response.json(); } catch (e) { data = {}; }
    if (response.status === 401 || response.status === 403) throw new Error('Could not load this class. The Chayus Meter may not be turned on for it, or your sign-in may have expired. Try Refresh or choose another class.');
    if (!response.ok || !data.ok) throw new Error(data.error || ('Could not load Chayus Meter history (' + response.status + ').'));
    return data;
  }

  const minutesText = entry => {
    if (!entry) return '—';
    const m = Number(entry.minutes) || 0;
    return (m % 1 === 0 ? String(m) : m.toFixed(1)) + ' min';
  };
  const levelText = entry => (entry && entry.level ? 'Level ' + entry.level + ' · ' + entry.levelName : '—');

  // The last `count` school days ending on `endDay`, newest first, each with the student's record or null.
  function recentDays(history, studentId, endDay, count) {
    const days = (history && history.days) || [];
    const student = history && history.students && history.students[studentId];
    const start = Math.max(0, days.indexOf(endDay));
    return days.slice(start, start + (count || 7)).map(day => ({ day, entry: (student && student.days && student.days[day]) || null }));
  }

  // One student's recorded days inside a period (sinceDay = 'YYYY-MM-DD' or '' for everything), newest first.
  function studentDays(history, studentId, sinceDay) {
    const student = history && history.students && history.students[studentId];
    if (!student) return [];
    return Object.keys(student.days || {})
      .filter(day => !sinceDay || day >= sinceDay)
      .sort().reverse()
      .map(day => Object.assign({ day }, student.days[day]));
  }

  function summarizeStudent(history, studentId, sinceDay) {
    const rows = studentDays(history, studentId, sinceDay);
    if (!rows.length) return null;
    return {
      days: rows,
      activeDays: rows.length,
      totalMinutes: Math.round(rows.reduce((a, r) => a + (Number(r.minutes) || 0), 0) * 10) / 10,
      totalPoints: rows.reduce((a, r) => a + (Number(r.points) || 0), 0),
      bestLevel: rows.reduce((a, r) => Math.max(a, Number(r.level) || 0), 0)
    };
  }

  // Class numbers for one day: how many used it, average counted minutes among them, points paid, top level.
  function classDay(history, day) {
    const students = (history && history.students) || {};
    const ids = Object.keys(students);
    const used = ids.filter(id => students[id].days && students[id].days[day] && students[id].days[day].countedSeconds > 0);
    const minutes = used.reduce((a, id) => a + (Number(students[id].days[day].minutes) || 0), 0);
    return {
      students: ids.length,
      used: used.length,
      avgMinutes: used.length ? Math.round(minutes / used.length * 10) / 10 : 0,
      points: used.reduce((a, id) => a + (Number(students[id].days[day].points) || 0), 0),
      topLevel: used.reduce((a, id) => Math.max(a, Number(students[id].days[day].level) || 0), 0)
    };
  }

  const api = { schoolDayOf, endpointFor, fetchHistory, recentDays, studentDays, summarizeStudent, classDay, minutesText, levelText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChayusHistory = api;
})(typeof window === 'undefined' ? globalThis : window);
