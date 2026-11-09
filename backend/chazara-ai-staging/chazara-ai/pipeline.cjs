'use strict';
/**
 * Chazara AI Practice — the evaluation pipeline.
 *
 *   1. audio validity        (audio-signal.cjs, server-measured)
 *   2. speech recognition    (providers.recognize, Hebrew + English passes)
 *   3. Hebrew comparison     (hebrew-match.cjs, deterministic)
 *   4. meaning comparison    (meaning-judge.cjs, teacher-approved key)
 *   5. overall decision      (decide.cjs, deterministic)
 *
 * Reusable: nothing here knows about Chazara, Firebase or HTTP. A future practice
 * activity can pass any list of {id, label, hebrew, meaning} items with one audio
 * segment each. Providers are injected so tests can run without paid services.
 */
const { analyzePcm, classifyAudio } = require('./audio-signal.cjs');
const { hebrewCoverage, normalizeHebrew } = require('./hebrew-match.cjs');
const { judgeMeaning, meaningLevel, wordCount } = require('./meaning-judge.cjs');
const { decide, readingLevel, THRESHOLDS } = require('./decide.cjs');

const SAMPLE_RATE = 16000;

function windows(words, size, maxLen = 100) {
  const out = [];
  for (let i = 0; i + size <= words.length; i++) {
    const phrase = words.slice(i, i + size).join(' ');
    if (phrase.length <= maxLen) out.push(phrase);
  }
  return out;
}

function hebrewHints(hebrew) {
  const words = normalizeHebrew(hebrew).split(/[^א-ת]+/).filter(Boolean);
  return [...new Set([...windows(words, 3), ...words])].slice(0, 60);
}
function englishHints(meaning) {
  const words = String(meaning || '').replace(/[^\p{L}\p{N}'\s-]/gu, ' ').split(/\s+/).filter(Boolean);
  return [...new Set(windows(words, 3))].slice(0, 40);
}

async function recognizeSegment(pasuk, pcm, providers, usage) {
  const seconds = pcm.length / SAMPLE_RATE;
  const [heHinted, en] = await Promise.all([
    providers.recognize({ pcm, sampleRate: SAMPLE_RATE, language: 'he-IL', hints: hebrewHints(pasuk.hebrew) }),
    providers.recognize({ pcm, sampleRate: SAMPLE_RATE, language: 'en-US', hints: englishHints(pasuk.meaning) })
  ]);
  usage.speechSeconds += seconds * 2;
  const hinted = hebrewCoverage(pasuk.hebrew, heHinted.transcript);
  let unhinted = null, heUnhinted = null;
  // Second, independent opinion only when the boosted pass says "strong":
  // boosting toward the expected words must never be the only evidence.
  if (hinted.coverage >= THRESHOLDS.readingStrong) {
    heUnhinted = await providers.recognize({ pcm, sampleRate: SAMPLE_RATE, language: 'he-IL', hints: [] });
    usage.speechSeconds += seconds;
    unhinted = hebrewCoverage(pasuk.hebrew, heUnhinted.transcript);
  }
  return {
    hebrewTranscript: heHinted.transcript || '',
    englishTranscript: en.transcript || '',
    confidence: [heHinted.confidence, en.confidence].filter(v => typeof v === 'number'),
    reading: { hinted, unhinted }
  };
}

/**
 * @param {object} args
 * @param {Array<{id,label,hebrew,meaning}>} args.items  teacher-approved content, from the server
 * @param {Array<Buffer>} args.segments  one audio recording per item
 * @param {object} args.providers  { decode(buffer, mime) -> Int16Array, recognize(opts) -> {transcript, confidence}, judge(opts) -> json }
 */
async function evaluateAttempt({ items, segments, mimeType, providers }) {
  if (!Array.isArray(items) || !items.length || !Array.isArray(segments) || segments.length !== items.length)
    throw Object.assign(new Error('One recording is needed for each pasuk.'), { code: 400 });
  const started = Date.now();
  const usage = { speechSeconds: 0, judgeCalls: 0, inputTokens: 0, outputTokens: 0 };

  // 1 — audio validity (decode on the server; never trust browser measurements)
  const decoded = await Promise.all(segments.map(buf => providers.decode(buf, mimeType)));
  const audio = decoded.map(pcm => {
    const metrics = analyzePcm(pcm, SAMPLE_RATE);
    return { pcm, metrics, status: classifyAudio(metrics) };
  });
  // Google's quick recognizer takes at most one minute; refuse before any paid call.
  if (audio.some(a => a.metrics.durationMs > 61000))
    throw Object.assign(new Error('Keep each pasuk under one minute, then try again.'), { code: 413 });

  // 2–3 — recognition and Hebrew comparison, only for usable audio
  const heard = await Promise.all(items.map((item, i) =>
    audio[i].status === 'ok' ? recognizeSegment(item, audio[i].pcm, providers, usage) : null));

  // 4 — meaning, one call for every usable pasuk with any recognized words
  const forJudge = items.map((item, i) => heard[i] && {
    id: item.id, hebrew: item.hebrew, meaning: item.meaning,
    englishTranscript: heard[i].englishTranscript, hebrewTranscript: heard[i].hebrewTranscript,
    hebrewWordsMatched: heard[i].reading.hinted.matched
  }).filter(p => p && wordCount(p.englishTranscript) + wordCount(p.hebrewTranscript) >= 3);
  let judged = {};
  if (forJudge.length) {
    const result = await providers.judge(forJudge);
    judged = result.rows;
    usage.judgeCalls += 1;
    usage.inputTokens += result.usage?.inputTokens || 0;
    usage.outputTokens += result.usage?.outputTokens || 0;
  }

  // 5 — decision
  const rows = items.map((item, i) => {
    const a = audio[i], h = heard[i];
    const base = { id: item.id, label: item.label, audioStatus: a.status };
    if (!h) return { ...base, readingLevel: 'none', meaningLevel: 'none' };
    const words = wordCount(h.englishTranscript) + wordCount(h.hebrewTranscript);
    // Clear voice but the recognizers produced (almost) nothing: a recognition
    // problem, not proof that the child said nothing useful.
    if (words < 3 && a.metrics.voicedMs >= 3000) return { ...base, readingLevel: 'uncertain', meaningLevel: 'uncertain' };
    const judge = judged[item.id];
    const p = forJudge.find(x => x.id === item.id);
    return {
      ...base,
      readingLevel: readingLevel(h.reading),
      meaningLevel: p ? meaningLevel(judge, p) : 'none',
      nonsense: !!judge?.nonsense,
      offTopic: !!judge?.offTopic
    };
  });
  const decision = decide(rows);
  return {
    decision,
    usage,
    elapsedMs: Date.now() - started,
    // Diagnostics for automated tests and the offline audio-evaluation script only.
    // The HTTP service strips these and never stores them.
    diagnostics: rows.map((r, i) => ({
      ...r,
      metrics: audio[i].metrics,
      readingCoverage: heard[i]?.reading.hinted.coverage ?? null,
      unboostedCoverage: heard[i]?.reading.unhinted?.coverage ?? null,
      transcripts: heard[i] ? { he: heard[i].hebrewTranscript, en: heard[i].englishTranscript } : null
    }))
  };
}

/** Adapts meaning-judge to the providers.judge contract. */
function makeJudge(requestJudge) {
  return async items => {
    const usage = { inputTokens: 0, outputTokens: 0 };
    const rows = await judgeMeaning(items, async req => {
      const res = await requestJudge(req);
      usage.inputTokens += res.usage?.inputTokens || 0;
      usage.outputTokens += res.usage?.outputTokens || 0;
      return res.json;
    });
    return { rows, usage };
  };
}

module.exports = { evaluateAttempt, makeJudge, hebrewHints, englishHints, SAMPLE_RATE };
