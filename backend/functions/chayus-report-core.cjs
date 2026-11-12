'use strict';

const MAX_SESSION_SECONDS = 7200;
const INTERVAL_SECONDS = 150;

function invalid() {
  throw Object.assign(new Error('Invalid Chayus session summary.'), { status: 400 });
}

// Deliberately construct a new object. Client identity, audio, sample counts,
// and extra properties must never become part of the stored summary.
function validateMetrics(input, elapsedSeconds) {
  if (!input || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) invalid();
  const limit = Math.min(MAX_SESSION_SECONDS, elapsedSeconds + 1);
  const { measuredSeconds, activeSeconds, calibrationSeconds, feedbackCount, activeIntervals } = input;
  if (![measuredSeconds, activeSeconds, calibrationSeconds].every(
    value => Number.isFinite(value) && value >= 0
  )) invalid();
  if (calibrationSeconds > 4 || measuredSeconds + calibrationSeconds > limit
    || activeSeconds > measuredSeconds) invalid();
  if (!Number.isInteger(feedbackCount) || feedbackCount < 0
    || feedbackCount > Math.floor(measuredSeconds / INTERVAL_SECONDS)
    || !Number.isInteger(activeIntervals) || activeIntervals < 0
    || activeIntervals > feedbackCount) invalid();
  return { measuredSeconds, activeSeconds, calibrationSeconds, feedbackCount, activeIntervals };
}

module.exports = { validateMetrics };
