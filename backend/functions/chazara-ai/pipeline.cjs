'use strict';
/**
 * Chazara AI Practice — server pipeline (casual, lenient practice).
 *
 *   0. (browser) instant silence check — silent/too-short clips are never uploaded
 *   1. transcription — each pasuk clip goes to OpenAI gpt-4o-mini-transcribe
 *   2. real-words check — empty or clearly gibberish transcripts fail; everything else passes
 *   3. result — decide.cjs
 *
 * No meaning check and no comparison with the pasuk text. Reusable: nothing here
 * knows about Chazara, Firebase or HTTP; providers are injected so tests need no paid calls.
 */
const { checkTranscript } = require('./transcript-check.cjs');
const { decide } = require('./decide.cjs');

/**
 * @param {object} args
 * @param {Array<{id,label}>} args.items
 * @param {Array<{buffer:Buffer, mimeType:string, durationMs?:number}>} args.clips one per item
 * @param {object} args.providers { transcribe({buffer, mimeType}) -> {text, seconds?} }
 */
async function evaluateAttempt({ items, clips, providers }) {
  if (!Array.isArray(items) || !items.length || !Array.isArray(clips) || clips.length !== items.length)
    throw Object.assign(new Error('One recording is needed for each pasuk.'), { code: 400 });
  const started = Date.now();
  const heard = await Promise.all(clips.map(c => providers.transcribe({ buffer: c.buffer, mimeType: c.mimeType })));
  const rows = items.map((item, i) => {
    const check = checkTranscript(heard[i].text);
    return { id: item.id, label: item.label, passes: check.passes, reason: check.reason, realWords: check.realWords, transcript: heard[i].text || '' };
  });
  // Audio length for the cost report: the provider's own figure when it gives one,
  // otherwise the browser's (clamped) recording length.
  const audioSeconds = heard.reduce((sum, h, i) => sum + (typeof h.seconds === 'number' ? h.seconds
    : Math.min(60, Math.max(0, Number(clips[i].durationMs) || 0) / 1000)), 0);
  return {
    decision: decide(rows),
    usage: { audioSeconds },
    elapsedMs: Date.now() - started,
    // For tests and the offline evaluation script only; the service never stores these.
    diagnostics: rows
  };
}

module.exports = { evaluateAttempt };
