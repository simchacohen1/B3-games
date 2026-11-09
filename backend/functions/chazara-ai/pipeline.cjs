'use strict';
/**
 * Chazara AI Practice — the evaluation pipeline (casual, lenient practice).
 *
 *   1. audio validity     (audio-signal.cjs, measured on the server)
 *   2. speech recognition (providers.recognize: one local Whisper pass in Hebrew)
 *   3. reading check      (hebrew-match.cjs: the Hebrew roughly matches the pasuk)
 *   4. translation check  (were extra words said after the reading? meaning is NOT judged)
 *   5. overall decision   (decide.cjs, fixed rules)
 *
 * No paid AI service is involved. Reusable: nothing here knows about Chazara,
 * Firebase or HTTP. A future practice activity can pass any list of
 * {id, label, hebrew} items with one audio segment each.
 */
const { analyzePcm, classifyAudio } = require('./audio-signal.cjs');
const { hebrewCoverage } = require('./hebrew-match.cjs');
const { decide } = require('./decide.cjs');

const SAMPLE_RATE = 16000;
const MAX_SEGMENT_MS = 61000;

/**
 * @param {object} args
 * @param {Array<{id,label,hebrew}>} args.items  teacher-approved pasuk text, from the server
 * @param {Array<Buffer>} args.segments  one audio recording per item
 * @param {object} args.providers  { decode(buffer, mime) -> Int16Array, recognize({pcm, sampleRate, language}) -> {transcript} }
 */
async function evaluateAttempt({ items, segments, mimeType, providers }) {
  if (!Array.isArray(items) || !items.length || !Array.isArray(segments) || segments.length !== items.length)
    throw Object.assign(new Error('One recording is needed for each pasuk.'), { code: 400 });
  const started = Date.now();
  const usage = { audioSeconds: 0 };

  // 1 — audio validity (decode on the server; never trust browser measurements)
  const decoded = await Promise.all(segments.map(buf => providers.decode(buf, mimeType)));
  const audio = decoded.map(pcm => {
    const metrics = analyzePcm(pcm, SAMPLE_RATE);
    return { pcm, metrics, status: classifyAudio(metrics) };
  });
  if (audio.some(a => a.metrics.durationMs > MAX_SEGMENT_MS))
    throw Object.assign(new Error('Keep each pasuk under one minute, then try again.'), { code: 413 });

  // 2–4 — one Whisper pass per usable clip. Run one at a time: it is CPU-bound,
  // so parallel runs on one instance would not finish sooner.
  const rows = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i], a = audio[i];
    const base = { id: item.id, label: item.label, audioStatus: a.status, metrics: a.metrics };
    if (a.status !== 'ok') { rows.push(base); continue; }
    const heard = await providers.recognize({ pcm: a.pcm, sampleRate: SAMPLE_RATE, language: 'he' });
    usage.audioSeconds += a.pcm.length / SAMPLE_RATE;
    const transcript = String(heard.transcript || '').trim();
    const match = hebrewCoverage(item.hebrew, transcript);
    rows.push({
      ...base,
      transcript,
      // A clear voice that produced (almost) no words is a recognition problem, not the child's mistake.
      recognitionFailed: match.heardWords < 2 && a.metrics.voicedMs >= 3000,
      readingCoverage: match.coverage,
      wordsAfterReading: match.wordsAfterReading
    });
  }

  // 5 — decision
  const decision = decide(rows);
  return {
    decision,
    usage,
    elapsedMs: Date.now() - started,
    // Diagnostics for automated tests and the offline audio-evaluation script only.
    // The HTTP service strips these and never stores them.
    diagnostics: rows
  };
}

module.exports = { evaluateAttempt, SAMPLE_RATE };
