/*
 * Chayus Meter: per-device sound-activity summaries for opt-in davening.
 * Does not record audio, recognize prayer, identify speakers or award points.
 * Raw RMS samples stay in memory. Only bounded aggregate numbers are exposed.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChayusMeter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DEFAULT_FEEDBACK_MS = 150000;
  const DEFAULT_CALIBRATION_MS = 3000;
  const MAX_SAMPLE_GAP_MS = 600;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const round = (n, places = 1) => Number(n.toFixed(places));

  function rmsFromFloatSamples(samples) {
    if (!samples || !samples.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      const value = Number.isFinite(samples[i]) ? clamp(samples[i], -1, 1) : 0;
      sum += value * value;
    }
    return Math.sqrt(sum / samples.length);
  }

  function feedbackFor(ratio) {
    if (ratio >= 0.55) return 'Wonderful steady energy! Keep davening!';
    if (ratio >= 0.25) return 'Keep it going! Every word counts!';
    return 'Keep davening comfortably. Your effort matters!';
  }

  function createMeter(options = {}) {
    const feedbackEveryMs = Number.isFinite(options.feedbackEveryMs) && options.feedbackEveryMs >= 1000
      ? options.feedbackEveryMs : DEFAULT_FEEDBACK_MS;
    const calibrationMs = Number.isFinite(options.calibrationMs) && options.calibrationMs >= 0
      ? options.calibrationMs : DEFAULT_CALIBRATION_MS;
    let running = false;
    let finished = false;
    let lastTime = null;
    let noiseFloor = 0.012;
    let calibrationElapsed = 0;
    let measuredMs = 0;
    let activeMs = 0;
    let intervalMeasuredMs = 0;
    let intervalActiveMs = 0;
    let nextFeedbackAt = feedbackEveryMs;
    let feedbackCount = 0;
    let activeIntervals = 0;
    let sampleCount = 0;
    let pauseCount = 0;
    let pausedMs = 0;
    let pauseStartedAt = null;

    function start(at) {
      if (finished) throw new Error('This session has ended. Create a new meter.');
      if (!Number.isFinite(at)) throw new TypeError('A monotonic timestamp is required');
      running = true;
      if (pauseStartedAt !== null) {
        pausedMs += Math.max(0, at - pauseStartedAt);
        pauseStartedAt = null;
      }
      lastTime = at;
    }
    function pause(at) {
      if (running) {
        pauseCount++;
        pauseStartedAt = Number.isFinite(at) ? at : null;
      }
      running = false;
      lastTime = null; // Never count inactive or background-tab gaps.
    }
    function sample(rms, at) {
      if (!running || finished) return null;
      if (!Number.isFinite(rms) || !Number.isFinite(at)) return null;
      if (at < lastTime) return null; // Do not rewind the clock on stale samples.
      const level = clamp(rms, 0, 1);
      const elapsed = clamp(at - lastTime, 0, MAX_SAMPLE_GAP_MS);
      lastTime = at;
      sampleCount++;
      // Early levels calibrate the ambient threshold; they do not count as speech.
      if (calibrationElapsed < calibrationMs) {
        calibrationElapsed += elapsed;
        // Adapt conservatively: initial speaking must not drive threshold very high.
        noiseFloor = Math.min(0.055, 0.9 * noiseFloor + 0.1 * level);
        return null;
      }
      // Count sound activity, never relative loudness. Shouting earns no bonus.
      const threshold = clamp(noiseFloor * 2.1 + 0.012, 0.028, 0.14);
      const isActive = level >= threshold;
      if (!isActive) noiseFloor = clamp(0.985 * noiseFloor + 0.015 * level, 0.005, 0.06);
      measuredMs += elapsed;
      intervalMeasuredMs += elapsed;
      if (isActive) {
        activeMs += elapsed;
        intervalActiveMs += elapsed;
      }
      if (measuredMs >= nextFeedbackAt) {
        const fraction = intervalMeasuredMs ? intervalActiveMs / intervalMeasuredMs : 0;
        const message = feedbackFor(fraction);
        feedbackCount++;
        if (intervalActiveMs >= 1000) activeIntervals++;
        intervalMeasuredMs = 0;
        intervalActiveMs = 0;
        nextFeedbackAt += feedbackEveryMs;
        return message;
      }
      return null;
    }
    function snapshot() {
      const fraction = measuredMs ? activeMs / measuredMs : 0;
      const visiblePausedMs = pausedMs + (pauseStartedAt !== null && !running
        ? Math.max(0, performance.now() - pauseStartedAt) : 0);
      return {
        status: finished ? 'ended' : running ? 'active' : 'paused',
        measuredSeconds: round(measuredMs / 1000),
        activeSeconds: round(activeMs / 1000),
        soundActivityPercent: Math.round(fraction * 100),
        calibrationSeconds: round(calibrationElapsed / 1000),
        feedbackCount,
        activeIntervals,
        pauseCount,
        pausedSeconds: round(visiblePausedMs / 1000),
        samples: sampleCount,
        // Signal amplitude is intentionally NOT part of a score.
        hasMeasuredActivity: measuredMs > 0
      };
    }
    function restore(data) {
      if (running || finished || measuredMs || !data || typeof data !== 'object') return false;
      const safe = (key, max) => Number.isFinite(data[key]) ? clamp(data[key], 0, max) : 0;
      measuredMs = safe('measuredSeconds', 7200) * 1000;
      activeMs = Math.min(measuredMs, safe('activeSeconds', 7200) * 1000);
      calibrationElapsed = Math.min(calibrationMs, safe('calibrationSeconds', 4) * 1000);
      feedbackCount = Number.isInteger(data.feedbackCount) ? clamp(data.feedbackCount, 0, 48) : 0;
      activeIntervals = Number.isInteger(data.activeIntervals) ? clamp(data.activeIntervals, 0, feedbackCount) : 0;
      pauseCount = Number.isInteger(data.pauseCount) ? clamp(data.pauseCount, 0, 100) : 0;
      pausedMs = safe('pausedSeconds', 7200) * 1000;
      nextFeedbackAt = (feedbackCount + 1) * feedbackEveryMs;
      return true;
    }
    function finish() {
      if (running) { running = false; lastTime = null; }
      finished = true;
      return snapshot();
    }
    return { start, pause, sample, snapshot, restore, finish };
  }

  /*
   * Teacher-view builder for future authenticated transport. The server must
   * resolve names, class membership and session, never trust client identity.
   * A missing/denied mic is 'No data', not 0% participation.
   */
  function teacherRows(reports) {
    if (!Array.isArray(reports)) throw new TypeError('Reports must be an array');
    return reports.map((report) => {
      const data = report && report.metrics;
      const measured = data && Number.isFinite(data.measuredSeconds)
        ? clamp(data.measuredSeconds, 0, 7200) : 0;
      const active = data && Number.isFinite(data.activeSeconds)
        ? clamp(data.activeSeconds, 0, measured) : 0;
      return {
        studentId: String(report && report.studentId || ''),
        studentName: String(report && report.studentName || 'Student'),
        hasData: measured > 0,
        measuredMinutes: round(measured / 60),
        microphoneMinutes: round((measured + (Number.isFinite(data?.calibrationSeconds)
          ? clamp(data.calibrationSeconds, 0, 10) : 0)) / 60),
        observedIntervals: Number.isInteger(data?.feedbackCount) ? data.feedbackCount : 0,
        activeIntervals: Number.isInteger(data?.activeIntervals) ? data.activeIntervals : 0,
        consistencyPercent: Number.isInteger(data?.feedbackCount) && data.feedbackCount > 0
          ? Math.round(clamp(Number(data.activeIntervals) / data.feedbackCount, 0, 1) * 100) : null,
        pauseCount: Number.isInteger(data?.pauseCount) ? data.pauseCount : 0,
        pausedMinutes: Number.isFinite(data?.pausedSeconds) ? round(data.pausedSeconds / 60) : 0,
        lastSavedAt: Number.isFinite(report?.lastSavedAt) ? report.lastSavedAt : null,
        missingAtEnd: report?.missingAtEnd === true,
        consistencyPercent: Number.isInteger(data?.feedbackCount) && data.feedbackCount > 0
          ? Math.round(clamp(Number(data.activeIntervals) / data.feedbackCount, 0, 1) * 100) : null,
        pauseCount: Number.isInteger(data?.pauseCount) ? data.pauseCount : 0,
        pausedMinutes: Number.isFinite(data?.pausedSeconds) ? round(data.pausedSeconds / 60) : 0,
        lastSavedAt: Number.isFinite(report?.lastSavedAt) ? report.lastSavedAt : null,
        missingAtEnd: report?.missingAtEnd === true,
        soundActivityPercent: measured > 0 ? Math.round(active / measured * 100) : null,
        // This is an observational summary, not a teacher points suggestion.
        status: measured > 0 ? 'Microphone activity measured' : 'No microphone data'
      };
    }).sort((a, b) => a.studentName.localeCompare(b.studentName));
  }
  return { createMeter, feedbackFor, rmsFromFloatSamples, teacherRows };
});
