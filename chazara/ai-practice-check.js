/* Chazara AI Practice — instant silence check (#688).
 * Runs in the browser right after each pasuk is recorded, BEFORE anything is
 * uploaded. Deliberately lenient: it only stops recordings that are clearly
 * too short or clearly silent. Anything with real sound goes on to be checked.
 * Also loadable in Node (tests and scripts/chazara-ai-audio-eval.cjs).
 */
(function (root) {
  'use strict';
  var LIMITS = {
    minDurationMs: 2000,  // shorter than this is not a real try
    voicedRms: 0.01,      // a moment counts as "sound" at or above this level (~-40 dBFS)
    minVoicedMs: 400,     // at least this much sound in the whole recording
    minPeakRms: 0.015     // the loudest moment must reach at least this level
  };

  /** Summarise level readings taken while recording: [{rms, ms}] (ms = time the reading covers). */
  function measure(frames, limits) {
    limits = limits || LIMITS;
    var peak = 0, voiced = 0;
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      if (f.rms > peak) peak = f.rms;
      if (f.rms >= limits.voicedRms) voiced += f.ms;
    }
    return { peakRms: peak, voicedMs: Math.round(voiced) };
  }

  /**
   * @param {{durationMs:number, peakRms?:number, voicedMs?:number, measured?:boolean}} m
   * @returns {{ok:boolean, reason:null|'too_short'|'too_quiet'}}
   * When the browser could not measure the level (measured === false), only the
   * duration is checked: we never block a child because of a missing measurement.
   */
  function assess(m, limits) {
    limits = limits || LIMITS;
    if (!m || !(m.durationMs >= limits.minDurationMs)) return { ok: false, reason: 'too_short' };
    if (m.measured === false) return { ok: true, reason: null };
    if (!(m.peakRms >= limits.minPeakRms) || !(m.voicedMs >= limits.minVoicedMs)) return { ok: false, reason: 'too_quiet' };
    return { ok: true, reason: null };
  }

  var MESSAGE = { outcome: 'unclear', title: "Couldn't Hear Clearly", message: "I couldn't hear you — try again!",
    tips: ['Hold the device close and read in a nice, strong voice.'] };

  var api = { LIMITS: LIMITS, measure: measure, assess: assess, MESSAGE: MESSAGE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChazaraSilenceCheck = api;
})(typeof window === 'object' ? window : globalThis);
