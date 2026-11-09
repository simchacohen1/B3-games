'use strict';
/**
 * Chazara AI Practice — step 1: is there a usable recording at all?
 *
 * Works on decoded 16-bit mono PCM on the server, so the browser cannot claim
 * a recording is fine. It only measures sound; it never decides whether the
 * child said the right words. Speaking for a long time is NOT treated as
 * completing the assignment — that is decided later from the content.
 */

const DEFAULT_LIMITS = {
  frameMs: 30,
  silentLevel: 0.006,      // ~-44 dBFS: below this the microphone heard essentially nothing
  voicedFloor: 0.012,      // a frame must be at least this loud to count as voiced
  minVoicedMs: 1500,       // less voiced sound than this = no real attempt in this part
  minSnrDb: 9,             // speech must stand clearly above the background
  maxClippedRatio: 0.05    // heavy clipping = distorted microphone
};

function toFloat(pcm) {
  if (pcm instanceof Float32Array) return pcm;
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}

function pcmFromBuffer(buffer) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2));
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function analyzePcm(pcm, sampleRate = 16000, limits = DEFAULT_LIMITS) {
  const x = toFloat(pcm);
  const frame = Math.max(1, Math.round(sampleRate * limits.frameMs / 1000));
  const rms = [];
  let clipped = 0, peak = 0;
  for (let start = 0; start + frame <= x.length; start += frame) {
    let sum = 0;
    for (let i = start; i < start + frame; i++) {
      const v = x[i];
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= 0.99) clipped++;
    }
    rms.push(Math.sqrt(sum / frame));
  }
  const durationMs = Math.round(x.length / sampleRate * 1000);
  const sorted = [...rms].sort((a, b) => a - b);
  const noiseFloor = percentile(sorted, 0.1);
  const speechLevel = percentile(sorted, 0.9);
  const voicedThreshold = Math.max(limits.voicedFloor, noiseFloor * 2.5);
  const voicedFrames = rms.filter(v => v >= voicedThreshold).length;
  const snrDb = 20 * Math.log10(Math.max(speechLevel, 1e-6) / Math.max(noiseFloor, 1e-4));
  return {
    durationMs,
    voicedMs: voicedFrames * limits.frameMs,
    noiseFloor: round(noiseFloor),
    speechLevel: round(speechLevel),
    peak: round(peak),
    snrDb: Math.round(snrDb * 10) / 10,
    clippedRatio: x.length ? round(clipped / x.length) : 0
  };
}
const round = v => Math.round(v * 10000) / 10000;

/**
 * 'ok'        — usable speech
 * 'silent'    — the microphone heard (almost) nothing
 * 'too_short' — some sound, but far too little to be a reading + translation
 * 'noisy'     — background noise or distortion drowns the voice
 */
function classifyAudio(m, limits = DEFAULT_LIMITS) {
  if (!m || m.durationMs <= 0) return 'silent';
  if (m.voicedMs < 300 && m.speechLevel < limits.silentLevel) return 'silent';
  if (m.clippedRatio > limits.maxClippedRatio) return 'noisy';
  // Loud steady background (fan, traffic, other voices) with the voice not standing out.
  if (m.noiseFloor >= limits.silentLevel && m.snrDb < limits.minSnrDb) return 'noisy';
  if (m.voicedMs < limits.minVoicedMs) return 'too_short';
  if (m.snrDb < limits.minSnrDb) return 'noisy';
  return 'ok';
}

module.exports = { analyzePcm, classifyAudio, pcmFromBuffer, DEFAULT_LIMITS };
