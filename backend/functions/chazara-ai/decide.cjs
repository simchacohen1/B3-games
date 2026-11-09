'use strict';
/**
 * Chazara AI Practice — turn the evidence into one of four outcomes.
 *
 * Casual practice, deliberately lenient. Only two checks per pasuk:
 *   1. reading:     the Hebrew heard roughly matches the assigned pasuk
 *                   (existing in-order word matching, low bar);
 *   2. translation: the child said some extra words AFTER the reading.
 *                   What those words mean is NOT judged.
 *
 *   both parts on every pasuk            -> Excellent!
 *   at least one part somewhere          -> Almost There!
 *   silence, gibberish, unrelated talk   -> Let's Try Again!  (no pasuk reading heard)
 *   noisy/distorted audio, or a clear
 *   voice the recognizer could not read  -> Couldn't Hear Clearly
 *
 * Pure function, no AI. Messages are fixed, kind sentences; no claims about specific words.
 */

const THRESHOLDS = {
  reading: 0.3,       // share of pasuk words heard in order ("roughly matches")
  extraWords: 3       // words heard after the reading that count as a translation attempt
};

const MESSAGES = {
  excellent: { title: 'Excellent!', message: 'Excellent job! You read and explained the pasuk beautifully!' },
  almost: { title: 'Almost There!', message: "Great effort! You're getting closer. Practice a little more and try again!" },
  try_again: { title: "Let's Try Again!", message: "Let's try again! Remember to read the pasuk and explain what it means." },
  unclear: { title: "Couldn't Hear Clearly", message: "I couldn't hear you clearly. Please try recording again!" }
};

const TIPS = {
  explain: 'After you read the pasuk, say what it means.',
  read: 'Start by reading the pasuk in Hebrew, then say what it means.',
  missing: "Don't forget to do every pasuk.",
  both: 'Read the Hebrew words first, then say what they mean.',
  short: 'Take your time: read the whole pasuk, then explain it.',
  quiet: 'Try a quieter spot, away from other voices.',
  close: 'Hold the device close and speak in a clear, strong voice.',
  mic: 'Check that the microphone is on and not covered.'
};

/** Per-pasuk evidence -> 'both' | 'reading' | 'none' | 'unheard' | 'unsure'. */
function gradePasuk(p, anyAudioOk, t = THRESHOLDS) {
  if (p.audioStatus === 'noisy') return 'unheard';
  if (p.audioStatus === 'silent') return anyAudioOk ? 'none' : 'silent';
  if (p.audioStatus === 'too_short') return 'none';
  if (p.recognitionFailed) return 'unsure';
  const read = (p.readingCoverage || 0) >= t.reading;
  if (!read) return 'none';                       // no pasuk heard: gibberish/unrelated/translation alone
  return (p.wordsAfterReading || 0) >= t.extraWords ? 'both' : 'reading';
}

function decide(pesukim, t = THRESHOLDS) {
  const anyAudioOk = pesukim.some(p => p.audioStatus === 'ok');
  const rows = pesukim.map(p => ({ ...p, grade: gradePasuk(p, anyAudioOk, t) }));
  const grades = rows.map(r => r.grade);
  const has = g => grades.includes(g);
  const all = g => grades.every(x => x === g);
  let outcome, reason, tips = [];

  if (has('unheard')) {
    outcome = 'unclear'; reason = 'noisy'; tips = [TIPS.quiet, TIPS.close];
  } else if (all('silent')) {
    outcome = 'try_again'; reason = 'silent'; tips = [TIPS.mic, TIPS.close];
  } else if (has('unsure') && grades.every(g => g === 'unsure' || g === 'both')) {
    outcome = 'unclear'; reason = 'unsure'; tips = [TIPS.close];
  } else if (all('both')) {
    outcome = 'excellent'; reason = 'complete';
  } else if (grades.every(g => g === 'none' || g === 'unsure' || g === 'silent')) {
    outcome = 'try_again';
    reason = rows.every(r => r.audioStatus === 'too_short') ? 'too_short' : 'no_pasuk';
    tips = [reason === 'too_short' ? TIPS.short : TIPS.both];
  } else {
    outcome = 'almost';
    if (rows.length > 1 && grades.some(g => g === 'none' || g === 'unsure')) { reason = 'missing_pasuk'; tips = [TIPS.missing]; }
    else { reason = 'needs_explanation'; tips = [TIPS.explain]; }
  }

  const showPesukim = outcome === 'excellent' || outcome === 'almost';
  return {
    outcome, reason, ...MESSAGES[outcome], tips,
    pesukim: rows.map(r => ({ id: r.id, label: r.label, status: !showPesukim ? null : r.grade === 'both' ? 'great' : 'practice' }))
  };
}

module.exports = { decide, gradePasuk, THRESHOLDS, MESSAGES, TIPS };
