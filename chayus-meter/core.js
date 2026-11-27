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
  // Lowest room-sound estimate and lowest "voice heard" bar (as a 0..1 signal level). Small on purpose: a quiet
  // davening voice on a laptop microphone is only about 1 to 3 percent of full scale.
  const MIN_FLOOR = 0.002;
  // The "voice heard" bar sits a little above this microphone's room sound. These numbers were lowered from
  // 2.2x + 0.004 (minimum 0.011) because students found the bar too strict in the morning, when voices are
  // quieter. Once a voice is heard it stays heard until it drops below 75% of the bar, so the small dips
  // between words do not cut counted time.
  const MIN_THRESHOLD = 0.007;
  const THRESHOLD_FLOOR_FACTOR = 1.8;
  const THRESHOLD_EXTRA = 0.0025;
  const MAX_THRESHOLD = 0.1;
  const RELEASE_RATIO = 0.75;
  const MAX_SAMPLE_GAP_MS = 600;
  // Counted time. Only seconds in which a voice is heard count, and a stronger voice counts more: up to
  // NORMAL_VOICE_RATIO times the bar is a normal voice (1x), and it rises smoothly to 2x at STRONG_VOICE_RATIO
  // times the bar. Nothing louder earns more than 2x.
  const NORMAL_VOICE_RATIO = 3;
  const STRONG_VOICE_RATIO = 6;
  const MAX_WEIGHT = 2;
  // Class audio coming out of the student's own speakers. The mic hears it again, so it is modelled as
  // (echo gain x the level of the class audio) and the voice must be clearly above that.
  const ECHO_MIN_PLAYBACK = 0.004;
  const ECHO_MAX_GAIN = 1.2;
  const ECHO_CLEAR_FACTOR = 1.8;
  const ECHO_EXTRA = 0.003;
  const FAST_FLOOR_RISE = 0.02;
  // Levels. Each level is one point, so the top level is 10 points a day. Minutes are COUNTED minutes.
  const LEVELS = Object.freeze([
    { level: 1, minutes: 1, name: 'Spark', cheer: 'A spark has been lit!' },
    { level: 2, minutes: 3, name: 'Kindling', cheer: 'Your davening is catching!' },
    { level: 3, minutes: 5, name: 'Warm Glow', cheer: 'Such a warm glow!' },
    { level: 4, minutes: 7, name: 'Steady Flame', cheer: 'A steady flame. Beautiful!' },
    { level: 5, minutes: 10, name: 'Bright Light', cheer: 'Halfway to the top. A bright light!' },
    { level: 6, minutes: 14, name: 'Shining Star', cheer: 'You are shining like a star!' },
    { level: 7, minutes: 18, name: 'Radiant', cheer: 'Radiant! Keep going!' },
    { level: 8, minutes: 22, name: 'Blazing Fire', cheer: 'A blazing fire of davening!' },
    { level: 9, minutes: 26, name: 'Burning Bright', cheer: 'Almost at the top!' },
    { level: 10, minutes: 30, name: 'Chayus Champion', cheer: 'Chayus Champion! What a davening!' }
  ]);
  const MAX_LEVEL = LEVELS.length;
  // The on-screen meter follows how steadily a voice is heard over roughly the
  // last quarter minute. It is fed a yes/no "voice heard" signal, never volume.
  const STEADINESS_WINDOW_MS = 12000;
  // Sustained very high input only triggers a "no need to be loud" reminder.
  const LOUD_LEVEL = 0.35;
  const LOUD_HINT_AFTER_MS = 2000;
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

  // 1x for a normal voice, rising smoothly to at most 2x for a stronger one.
  function voiceWeight(level, threshold) {
    if (!(threshold > 0) || !(level >= threshold)) return 0;
    const ratio = level / threshold;
    return 1 + (MAX_WEIGHT - 1) * clamp((ratio - NORMAL_VOICE_RATIO) / (STRONG_VOICE_RATIO - NORMAL_VOICE_RATIO), 0, 1);
  }

  // Where a day's counted seconds put the student: current level, and how close the next one is.
  function levelInfo(countedSeconds) {
    const seconds = Number.isFinite(countedSeconds) ? Math.max(0, countedSeconds) : 0;
    let level = 0;
    for (const row of LEVELS) if (seconds >= row.minutes * 60) level = row.level;
    const current = level ? LEVELS[level - 1] : null;
    const next = level < MAX_LEVEL ? LEVELS[level] : null;
    const from = current ? current.minutes * 60 : 0;
    const to = next ? next.minutes * 60 : from;
    return {
      level,
      name: current ? current.name : 'Getting started',
      cheer: current ? current.cheer : 'Keep davening and your first spark will light!',
      points: level,
      maxLevel: MAX_LEVEL,
      nextLevel: next ? next.level : null,
      nextName: next ? next.name : null,
      secondsToNext: next ? Math.max(0, Math.ceil(to - seconds)) : 0,
      progressToNext: next ? clamp((seconds - from) / (to - from), 0, 1) : 1
    };
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
    let calibrationFloor = Infinity;
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
    let lastActive = false;
    let steadiness = 0;
    let loudMs = 0;
    let countedMs = 0;
    let celebratedLevel = 0;
    let pendingLevelUp = 0;
    let echoGain = 0;
    let echoKnown = false;
    let calibrationEchoGain = Infinity;
    let fastFloor = Infinity;

    function addCounted(ms) {
      // A day never counts past the top level, so a long session cannot grow without limit.
      countedMs = Math.min(LEVELS[MAX_LEVEL - 1].minutes * 60000 + 60000, countedMs + ms);
      const reached = levelInfo(countedMs / 1000).level;
      if (reached > celebratedLevel) { celebratedLevel = reached; pendingLevelUp = reached; }
    }
    // Models how much of the microphone signal is the class audio coming back through the speakers.
    function echoLevel(level, aux, calibrating) {
      if (!aux || !aux.playing) return 0;
      const playback = aux.playbackLevel;
      if (!(playback >= ECHO_MIN_PLAYBACK)) return 0;
      const ratio = clamp(level / playback, 0, ECHO_MAX_GAIN);
      if (calibrating) {
        calibrationEchoGain = Math.min(calibrationEchoGain, ratio);
        echoGain = calibrationEchoGain; echoKnown = true;
      } else if (!echoKnown) {
        echoGain = ratio; echoKnown = true;
      } else {
        // Falls quickly in the gaps between words, rises only slowly, so a voice is not learned as echo.
        echoGain = ratio < echoGain ? 0.7 * echoGain + 0.3 * ratio : echoGain + (ratio - echoGain) * 0.003;
      }
      echoGain = clamp(echoGain, 0, ECHO_MAX_GAIN);
      return echoGain * playback;
    }

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
      lastActive = false;
      loudMs = 0;
      lastTime = null; // Never count inactive or background-tab gaps.
    }
    function sample(rms, at, aux) {
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
        // Keep the quietest moment heard. A boy who is already davening when he
        // turns the meter on must not teach it that his voice is room noise.
        calibrationFloor = Math.min(calibrationFloor, level);
        noiseFloor = clamp(calibrationFloor, MIN_FLOOR, 0.055);
        echoLevel(level, aux, true);
        return null;
      }
      // Count sound activity, never relative loudness. Shouting earns no bonus.
      // The bar sits just above THIS microphone's own room sound (measured in the first seconds), so a quiet voice on a
      // quiet mic counts and a noisy room needs a clearer voice. It never depends on how loud the boy is.
      let threshold = clamp(noiseFloor * THRESHOLD_FLOOR_FACTOR + THRESHOLD_EXTRA, MIN_THRESHOLD, MAX_THRESHOLD);
      // Class audio from the speakers: the voice must be clearly above it, so the class audio alone earns nothing.
      const playing = Boolean(aux && aux.playing);
      if (playing) {
        const echo = echoLevel(level, aux, false);
        if (echo > 0) {
          threshold = Math.max(threshold, echo * ECHO_CLEAR_FACTOR + ECHO_EXTRA);
        } else if (!(aux.playbackLevel >= 0)) {
          // The page could not tell us the class audio level: treat steady sound as background instead.
          fastFloor = !Number.isFinite(fastFloor) ? level
            : level < fastFloor ? 0.7 * fastFloor + 0.3 * level : fastFloor + (level - fastFloor) * FAST_FLOOR_RISE;
          threshold = Math.max(threshold, fastFloor * ECHO_CLEAR_FACTOR + ECHO_EXTRA);
        }
      } else {
        fastFloor = Infinity;
      }
      threshold = Math.min(threshold, 0.6);
      // Once heard, a voice stays heard until it falls clearly below the bar (the dips between words).
      const isActive = level >= (lastActive ? threshold * RELEASE_RATIO : threshold);
      // Room noise estimate: drops quickly in the short gaps between words and
      // rises only very slowly, so steady davening is not mistaken for noise
      // while a constant hum (a fan, a heater) is gradually tuned out.
      noiseFloor = clamp(level < noiseFloor
        ? 0.7 * noiseFloor + 0.3 * level
        : playing ? noiseFloor : noiseFloor + (level - noiseFloor) * 0.0015, MIN_FLOOR, 0.06);
      // Display-only state. A quiet voice and a loud voice move it identically.
      lastActive = isActive;
      steadiness += ((isActive ? 1 : 0) - steadiness) * (1 - Math.exp(-elapsed / STEADINESS_WINDOW_MS));
      loudMs = level >= LOUD_LEVEL ? Math.min(2 * LOUD_HINT_AFTER_MS, loudMs + elapsed) : Math.max(0, loudMs - elapsed / 2);
      measuredMs += elapsed;
      intervalMeasuredMs += elapsed;
      if (isActive) {
        activeMs += elapsed;
        intervalActiveMs += elapsed;
        // A voice held through a small dip between words still counts as a normal voice (1x).
        addCounted(elapsed * Math.max(1, voiceWeight(level, threshold)));
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
        countedSeconds: round(countedMs / 1000),
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
    // What the student's own screen may show right now. Nothing here is sent
    // anywhere, and none of it depends on how loud the voice is.
    function live() {
      return {
        calibrating: running && calibrationElapsed < calibrationMs,
        voiceHeard: running && lastActive,
        steadiness: round(clamp(steadiness, 0, 1), 3),
        gentleVolumeHint: running && loudMs >= LOUD_HINT_AFTER_MS,
        countedSeconds: round(countedMs / 1000),
        ...levelInfo(countedMs / 1000)
      };
    }
    // The level reached since the last call (0 when none), so the screen can celebrate it once.
    function consumeLevelUp() {
      const reached = pendingLevelUp;
      pendingLevelUp = 0;
      return reached;
    }
    // The day's counted seconds already earned (from the server), adopted without a celebration.
    function adoptCountedSeconds(seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      countedMs = Math.max(countedMs, Math.min(seconds, LEVELS[MAX_LEVEL - 1].minutes * 60 + 60) * 1000);
      celebratedLevel = Math.max(celebratedLevel, levelInfo(countedMs / 1000).level);
      pendingLevelUp = 0;
    }
    // A new school day starts from zero.
    function resetDay() {
      countedMs = 0; celebratedLevel = 0; pendingLevelUp = 0;
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
      lastActive = false;
      loudMs = 0;
      finished = true;
      return snapshot();
    }
    return { start, pause, sample, snapshot, live, restore, finish, consumeLevelUp, adoptCountedSeconds, resetDay };
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
        soundActivityPercent: measured > 0 ? Math.round(active / measured * 100) : null,
        // This is an observational summary, not a teacher points suggestion.
        status: measured > 0 ? 'Microphone activity measured' : 'No microphone data'
      };
    }).sort((a, b) => a.studentName.localeCompare(b.studentName));
  }
  return { createMeter, feedbackFor, rmsFromFloatSamples, teacherRows, levelInfo, voiceWeight, LEVELS };
});
