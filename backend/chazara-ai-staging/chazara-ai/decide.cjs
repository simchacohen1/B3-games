'use strict';
/**
 * Chazara AI Practice — step 5: turn the evidence into one of four outcomes.
 *
 * Pure function, no AI. Rules (see docs/chazara-ai-practice.md):
 *  - "excellent" only when EVERY pasuk has clear audio, strong Hebrew reading
 *    (confirmed by a second, unboosted recognition pass) AND a strong meaning.
 *    Good reading never makes up for no translation, or vice versa.
 *  - Uncertainty (noise, garbled recognition, unconfirmed reading) never counts
 *    as the child's mistake: it leads to "unclear", not "try again".
 *  - Messages are fixed, kind sentences. No claims about specific words.
 */

const THRESHOLDS = {
  readingStrong: 0.7,     // share of pasuk words heard in order
  readingPartial: 0.35,
  readingWeak: 0.15,
  corroborate: 0.4        // unboosted pass must independently find this much
};

const MESSAGES = {
  excellent: { title: 'Excellent!', message: 'Excellent job! You read and explained the pasuk beautifully!' },
  almost: { title: 'Almost There!', message: "Great effort! You're getting closer. Practice a little more and try again!" },
  try_again: { title: "Let's Try Again!", message: "Let's try again! Remember to read the pasuk and explain what it means." },
  unclear: { title: "Couldn't Hear Clearly", message: "I couldn't hear you clearly. Please try recording again!" }
};

const TIPS = {
  explain: 'Next time, explain what the pasuk means too.',
  read: 'Remember to read the pasuk in Hebrew too.',
  practice: 'Read it slowly, then say what it means in your own words.',
  both: 'Read the Hebrew words first, then say what they mean.',
  short: 'Take your time: read the whole pasuk, then explain it.',
  quiet: 'Try a quieter spot, away from other voices.',
  close: 'Hold the device close and speak in a clear, strong voice.',
  mic: 'Check that the microphone is on and not covered.'
};

function readingLevel(reading, t = THRESHOLDS) {
  if (!reading || !reading.hinted) return 'none';
  const c = reading.hinted.coverage;
  if (c >= t.readingStrong) {
    if (!reading.unhinted) return 'uncertain';
    return reading.unhinted.coverage >= t.corroborate ? 'strong' : 'uncertain';
  }
  if (c >= t.readingPartial) return 'partial';
  if (c >= t.readingWeak) return 'weak';
  return 'none';
}

const low = level => level === 'none' || level === 'weak';

function gradePasuk(p, anyAudioOk) {
  if (p.audioStatus === 'noisy') return 'unheard';
  if (p.audioStatus === 'silent') return anyAudioOk ? 'missing' : 'unheard';
  if (p.audioStatus === 'too_short') return 'missing';
  const r = p.readingLevel, m = p.meaningLevel;
  if (r === 'strong' && m === 'strong') return 'good';
  if (r === 'uncertain' || m === 'uncertain') {
    // Uncertainty only matters if it could change the result.
    if (r === 'uncertain' && m !== 'uncertain' && low(m)) return 'partial_uncertain';
    return 'uncertain';
  }
  if (low(r) && low(m)) return 'none';
  return 'partial';
}

function decide(pesukim) {
  const anyAudioOk = pesukim.some(p => p.audioStatus === 'ok');
  const rows = pesukim.map(p => ({ ...p, grade: gradePasuk(p, anyAudioOk) }));
  const grades = rows.map(r => r.grade);
  const has = g => grades.includes(g);
  const all = (...gs) => grades.every(g => gs.includes(g));
  let outcome, reason, tips = [];

  if (all('unheard') || has('unheard')) {
    outcome = 'unclear';
    reason = rows.some(r => r.audioStatus === 'noisy') ? 'noisy' : 'silent';
    tips = reason === 'noisy' ? [TIPS.quiet, TIPS.close] : [TIPS.mic, TIPS.close];
  } else if (all('good')) {
    outcome = 'excellent';
    reason = 'complete';
  } else if (all('missing')) {
    outcome = 'try_again';
    reason = 'too_short';
    tips = [TIPS.short];
  } else if (has('uncertain') && grades.every(g => ['good', 'uncertain'].includes(g))) {
    outcome = 'unclear';
    reason = 'unsure';
    tips = [TIPS.close];
  } else if (grades.every(g => ['none', 'missing', 'uncertain'].includes(g))) {
    // Nothing usable was evidently correct. If part of it was too unclear to
    // judge, ask for a clearer recording rather than blaming the child.
    outcome = has('uncertain') ? 'unclear' : 'try_again';
    reason = has('uncertain') ? 'unsure' : (rows.some(r => r.nonsense) ? 'nonsense' : rows.some(r => r.offTopic) ? 'off_topic' : 'not_matching');
    tips = has('uncertain') ? [TIPS.close] : [TIPS.both];
  } else {
    outcome = 'almost';
    reason = 'partial';
    const graded = rows.filter(r => !['missing', 'unheard'].includes(r.grade));
    const readAll = graded.length && graded.every(r => r.readingLevel === 'strong');
    const meanAll = graded.length && graded.every(r => r.meaningLevel === 'strong');
    if (rows.length > 1 && rows.some(r => r.grade === 'missing' || r.grade === 'none')) reason = 'missing_pasuk';
    else if (readAll && !meanAll) reason = 'needs_meaning';
    else if (meanAll && !readAll) reason = 'needs_reading';
    tips = reason === 'needs_meaning' ? [TIPS.explain] : reason === 'needs_reading' ? [TIPS.read] : [TIPS.practice];
  }

  // Per-pasuk stars are only shown when the evidence for them is solid.
  const showPesukim = outcome === 'excellent' || outcome === 'almost';
  return {
    outcome,
    reason,
    ...MESSAGES[outcome],
    tips,
    pesukim: rows.map(r => ({
      id: r.id,
      label: r.label,
      status: !showPesukim ? null : r.grade === 'good' ? 'great' : 'practice'
    }))
  };
}

module.exports = { decide, readingLevel, gradePasuk, THRESHOLDS, MESSAGES, TIPS };
