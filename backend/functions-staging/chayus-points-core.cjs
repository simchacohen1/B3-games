'use strict';
// Chayus Meter points: one point per level, at most 10 points a school day.
//
// The student's own page measures how many seconds a voice was heard (weighted: a normal voice 1x, a stronger
// voice up to 2x) and reports that running total. It never sends sound. The server does not trust the number
// blindly, because anyone can call this function by hand:
//   * the day's total can only grow, and by at most 2 seconds per real second since the last report (the most
//     a perfect, strong voice could earn), so the top level needs at least 15 real minutes;
//   * each level pays out once, under a fixed request id (chayus_<student>_<day>_L<n>), so retries, two open
//     tabs or a replayed request can never pay a level twice;
//   * a day can never pay more than 10 points (one per level), whatever number is reported.
// The points go through Student Rewards the same way other automatic awards do (a pointRequests entry plus the
// student's rewardBalance), so teachers see and can undo them from the normal history.
const SR = 'studentRewards';
const LEVEL_MINUTES = Object.freeze([1, 3, 5, 7, 10, 14, 18, 22, 26, 30]);
const LEVEL_NAMES = Object.freeze(['Spark', 'Kindling', 'Warm Glow', 'Steady Flame', 'Bright Light', 'Shining Star', 'Radiant', 'Blazing Fire', 'Burning Bright', 'Chayus Champion']);
const MAX_LEVEL = LEVEL_MINUTES.length;
const MAX_POINTS_PER_DAY = MAX_LEVEL;
const MAX_DAY_SECONDS = LEVEL_MINUTES[MAX_LEVEL - 1] * 60 + 60;
const MAX_WEIGHT = 2;
// The longest stretch of real time one report may account for. Reports come about every 30 seconds.
const MAX_ELAPSED_SECONDS = 300;
const SLACK_SECONDS = 4;
const FIRST_REPORT_SECONDS = 90;
const SOURCE = 'chayus-level';

function nyDay(ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function levelFor(countedSeconds) {
  const seconds = Number.isFinite(countedSeconds) ? countedSeconds : 0;
  let level = 0;
  for (let i = 0; i < MAX_LEVEL; i++) if (seconds >= LEVEL_MINUTES[i] * 60) level = i + 1;
  return level;
}
const safeId = value => String(value || '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 100);
const requestIdFor = (studentId, day, level) => `chayus_${safeId(studentId)}_${day}_L${level}`;

// How many counted seconds this report may add, given the real time since the last one.
function allowedGain(record, nowMs) {
  if (!record || !Number.isFinite(record.lastAt)) return MAX_WEIGHT * FIRST_REPORT_SECONDS + SLACK_SECONDS;
  const elapsed = Math.min(MAX_ELAPSED_SECONDS, Math.max(0, (nowMs - record.lastAt) / 1000));
  return MAX_WEIGHT * elapsed + SLACK_SECONDS;
}

// Records a student's reported total for today and pays any levels reached.
//   store.tx(path, fn)  -> RTDB-style transaction ({committed, snapshot})
//   store.get(path)     -> value
//   award({requestId, level, name, day}) -> {ok, newlyAwarded?, amount?}   (pays 1 point, idempotent by requestId)
// reportedSeconds === null only reads today's state.
async function report({ store, award, studentId, reportedSeconds = null, nowMs = Date.now(), enabled = true }) {
  if (!studentId) return { ok: false, status: 400, error: 'Missing student.' };
  const day = nyDay(nowMs);
  // The owner's off-switch (studentRewards/settings/chayusPointsEnabled = false): nothing is recorded or paid.
  if (enabled === false) {
    return { ok: true, paused: true, day, countedSeconds: 0, level: 0, points: 0, maxPoints: MAX_POINTS_PER_DAY, newlyAwarded: [], acceptedGainSeconds: 0 };
  }
  const path = `${SR}/chayusDaily/${safeId(studentId)}/${day}`;
  const reporting = reportedSeconds !== null && reportedSeconds !== undefined;
  const claimed = reporting ? Number(reportedSeconds) : 0;
  if (reporting && (!Number.isFinite(claimed) || claimed < 0)) return { ok: false, status: 400, error: 'Invalid Chayus time.' };
  let accepted = 0;
  if (reporting) {
    await store.tx(path, cur => {
      const record = cur && typeof cur === 'object' ? cur : null;
      const total = Math.min(MAX_DAY_SECONDS, Math.max(0, Number(record?.countedSeconds) || 0));
      const gain = Math.min(Math.max(0, claimed - total), allowedGain(record, nowMs));
      accepted = gain;
      return {
        ...(record || {}),
        countedSeconds: Math.round((total + gain) * 10) / 10,
        lastAt: nowMs,
        firstAt: Number.isFinite(record?.firstAt) ? record.firstAt : nowMs,
        awardedLevel: Math.min(MAX_LEVEL, Math.max(0, Math.floor(Number(record?.awardedLevel) || 0)))
      };
    });
  }
  const record = (await store.get(path)) || { countedSeconds: 0, awardedLevel: 0 };
  const countedSeconds = Math.min(MAX_DAY_SECONDS, Math.max(0, Number(record.countedSeconds) || 0));
  const level = Math.min(MAX_LEVEL, levelFor(countedSeconds));
  let awardedLevel = Math.min(MAX_LEVEL, Math.max(0, Math.floor(Number(record.awardedLevel) || 0)));
  const newlyAwarded = [];
  let awardError = null;
  if (reporting) {
    for (let n = awardedLevel + 1; n <= level && n <= MAX_LEVEL; n++) {
      const result = await award({ requestId: requestIdFor(studentId, day, n), level: n, name: LEVEL_NAMES[n - 1], day });
      if (!result || !result.ok) { awardError = (result && result.error) || 'Could not add the Chayus point.'; break; }
      if (result.newlyAwarded) newlyAwarded.push(n);
      // Only ever move forward, so a slow retry cannot lower what has already been paid.
      await store.tx(path, cur => cur && typeof cur === 'object' ? { ...cur, awardedLevel: Math.max(Number(cur.awardedLevel) || 0, n) } : cur);
      awardedLevel = n;
    }
  }
  return {
    ok: true, day, countedSeconds, level, points: awardedLevel,
    maxPoints: MAX_POINTS_PER_DAY, newlyAwarded, acceptedGainSeconds: Math.round(accepted * 10) / 10,
    ...(awardError ? { awardError } : {})
  };
}

// Read-only history for the teacher dashboard and the full student report: for each student in the class, the
// counted seconds, level and points recorded for each of the last `days` school days. Nothing is written.
const MAX_HISTORY_DAYS = 90;
const DEFAULT_HISTORY_DAYS = 30;
function dayKeys(nowMs, count) {
  const [y, m, d] = nyDay(nowMs).split('-').map(Number);
  const out = [];
  for (let k = 0; k < count; k++) out.push(new Date(Date.UTC(y, m - 1, d - k)).toISOString().slice(0, 10));
  return out;
}
async function classHistory({ get, students, days = DEFAULT_HISTORY_DAYS, nowMs = Date.now() }) {
  const asked = Math.floor(Number(days));
  const count = Math.min(MAX_HISTORY_DAYS, Math.max(1, Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_HISTORY_DAYS));
  const keys = dayKeys(nowMs, count);
  const wanted = new Set(keys);
  const ids = Object.keys(students || {}).filter(id => /^[A-Za-z0-9_-]{1,100}$/.test(id)).slice(0, 300);
  const out = {};
  await Promise.all(ids.map(async id => {
    const rows = (await get(`${SR}/chayusDaily/${safeId(id)}`)) || {};
    const byDay = {};
    for (const [day, record] of Object.entries(rows)) {
      if (!wanted.has(day) || !record || typeof record !== 'object') continue;
      const seconds = Math.min(MAX_DAY_SECONDS, Math.max(0, Number(record.countedSeconds) || 0));
      const level = Math.min(MAX_LEVEL, levelFor(seconds));
      byDay[day] = {
        countedSeconds: Math.round(seconds * 10) / 10,
        minutes: Math.round(seconds / 6) / 10,
        level,
        levelName: level ? LEVEL_NAMES[level - 1] : '',
        points: Math.min(MAX_LEVEL, Math.max(0, Math.floor(Number(record.awardedLevel) || 0)))
      };
    }
    out[id] = { name: String((students[id] && students[id].name) || id), days: byDay };
  }));
  return { today: keys[0], days: keys, maxPoints: MAX_POINTS_PER_DAY, levelNames: LEVEL_NAMES.slice(), levelMinutes: LEVEL_MINUTES.slice(), students: out };
}

module.exports = { report, classHistory, dayKeys, levelFor, nyDay, requestIdFor, allowedGain, LEVEL_MINUTES, LEVEL_NAMES, MAX_LEVEL, MAX_POINTS_PER_DAY, MAX_DAY_SECONDS, SOURCE };
