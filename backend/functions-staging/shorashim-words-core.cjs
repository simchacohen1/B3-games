'use strict';
// Shorashim review points: 1 point for every 100 words reviewed, counted together across review and every game,
// at most 10 points a day. The student's page counts a word only when at least the minimum review time was spent
// on it, and reports small batches ("12 more words"). The server does not trust a batch blindly:
//   * a batch can add at most as many words as the real time since the last batch allows (one word per half
//     second, plus a little slack), so fast flipping or a hand-made request cannot jump ahead;
//   * the day's total never goes past 1000 words (10 points);
//   * each point pays once under a fixed request id (shorashimwords_<student>_<day>_P<n>), and each batch carries
//     an id, so a retry or two open tabs can never pay twice.
// Points go through Student Rewards the same way Chayus Meter points do (a pointRequests entry plus rewardBalance).
const { nyDay } = require('./chayus-points-core.cjs');
const SR = 'studentRewards';
const WORDS_PER_POINT = 100;
const MAX_POINTS_PER_DAY = 10;
const MAX_DAY_WORDS = WORDS_PER_POINT * MAX_POINTS_PER_DAY;
const MAX_BATCH_WORDS = 100;
const MAX_ELAPSED_SECONDS = 300;
const WORDS_PER_SECOND = 2;
const SLACK_WORDS = 5;
const FIRST_REPORT_WORDS = 30;
const SOURCE = 'shorashim-words';

const safeId = value => String(value || '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 100);
const requestIdFor = (studentId, day, point) => `shorashimwords_${safeId(studentId)}_${day}_P${point}`;

function allowedGain(record, nowMs) {
  if (!record || !Number.isFinite(record.lastAt)) return FIRST_REPORT_WORDS;
  const elapsed = Math.min(MAX_ELAPSED_SECONDS, Math.max(0, (nowMs - record.lastAt) / 1000));
  return Math.floor(WORDS_PER_SECOND * elapsed) + SLACK_WORDS;
}
const view = (day, words, awarded) => {
  const w = Math.min(MAX_DAY_WORDS, Math.max(0, Math.floor(Number(words) || 0)));
  return { day, words: w, points: Math.min(MAX_POINTS_PER_DAY, Math.floor(w / WORDS_PER_POINT)), awardedPoints: awarded, intoNextPoint: w >= MAX_DAY_WORDS ? 0 : w % WORDS_PER_POINT, wordsPerPoint: WORDS_PER_POINT, maxPoints: MAX_POINTS_PER_DAY };
};

// words === null only reads today's state. store.tx(path, fn) is RTDB-style, store.get(path) returns a value,
// award({requestId, point, day}) pays 1 point and is idempotent by requestId.
async function report({ store, award, studentId, words = null, batchId = '', nowMs = Date.now(), enabled = true }) {
  if (!studentId) return { ok: false, status: 400, error: 'Missing student.' };
  const day = nyDay(nowMs);
  if (enabled === false) return { ok: true, paused: true, ...view(day, 0, 0), newlyAwarded: [], accepted: 0 };
  const path = `${SR}/shorashimWordsDaily/${safeId(studentId)}/${day}`;
  const reporting = words !== null && words !== undefined;
  const claimed = reporting ? Math.floor(Number(words)) : 0;
  if (reporting && (!Number.isFinite(claimed) || claimed < 0 || claimed > MAX_BATCH_WORDS)) return { ok: false, status: 400, error: 'Invalid word count.' };
  const batch = String(batchId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  let accepted = 0;
  if (reporting && claimed > 0) {
    await store.tx(path, cur => {
      const record = cur && typeof cur === 'object' ? cur : null;
      const seen = Array.isArray(record && record.batches) ? record.batches : [];
      if (batch && seen.includes(batch)) { accepted = 0; return record; }
      const total = Math.min(MAX_DAY_WORDS, Math.max(0, Number(record && record.words) || 0));
      accepted = Math.max(0, Math.min(claimed, allowedGain(record, nowMs), MAX_DAY_WORDS - total));
      return {
        ...(record || {}),
        words: total + accepted,
        lastAt: nowMs,
        firstAt: Number.isFinite(record && record.firstAt) ? record.firstAt : nowMs,
        awardedPoints: Math.min(MAX_POINTS_PER_DAY, Math.max(0, Math.floor(Number(record && record.awardedPoints) || 0))),
        batches: batch ? seen.concat(batch).slice(-30) : seen
      };
    });
  }
  const record = (await store.get(path)) || { words: 0, awardedPoints: 0 };
  const total = Math.min(MAX_DAY_WORDS, Math.max(0, Number(record.words) || 0));
  const earned = Math.min(MAX_POINTS_PER_DAY, Math.floor(total / WORDS_PER_POINT));
  let awarded = Math.min(MAX_POINTS_PER_DAY, Math.max(0, Math.floor(Number(record.awardedPoints) || 0)));
  const newlyAwarded = [];
  let awardError = null;
  if (reporting) {
    for (let n = awarded + 1; n <= earned; n++) {
      const result = await award({ requestId: requestIdFor(studentId, day, n), point: n, day });
      if (!result || !result.ok) { awardError = (result && result.error) || 'Could not add the Shorashim point.'; break; }
      if (result.newlyAwarded) newlyAwarded.push(n);
      await store.tx(path, cur => cur && typeof cur === 'object' ? { ...cur, awardedPoints: Math.max(Number(cur.awardedPoints) || 0, n) } : cur);
      awarded = n;
    }
  }
  return { ok: true, ...view(day, total, awarded), newlyAwarded, accepted, ...(awardError ? { awardError } : {}) };
}

module.exports = { report, requestIdFor, allowedGain, WORDS_PER_POINT, MAX_POINTS_PER_DAY, MAX_DAY_WORDS, MAX_BATCH_WORDS, SOURCE };
