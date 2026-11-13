'use strict';
/**
 * Chazara AI Practice — does a transcript contain real words?
 *
 * Deliberately lenient: it does not check meaning and does not compare with the
 * pasuk. It only catches recordings that are clearly empty or clearly gibberish
 * (filler sounds, one repeated syllable, or a phrase the recognizer is known to
 * invent on near-silent audio). Anything else passes.
 */

// Sounds, not words (any case). Hebrew-script fillers included.
const FILLERS = new Set([
  'uh', 'um', 'umm', 'uhm', 'hmm', 'hm', 'mm', 'mmm', 'ah', 'ahh', 'oh', 'ohh', 'eh', 'er', 'erm', 'huh',
  'la', 'na', 'da', 'ba', 'ta', 'pa', 'ma', 'blah', 'bla', 'boing', 'beep', 'boop', 'bam', 'boom', 'pew',
  'lalala', 'nanana', 'haha', 'hahaha', 'hehe', 'hehehe', 'ha', 'he', 'ho', 'shh', 'psst', 'brr',
  'אה', 'אהה', 'אמ', 'אממ', 'הממ', 'המ', 'לה', 'נה', 'בלה', 'בום', 'הה', 'ההה', 'חחח', 'חח'
]);

// Whole transcripts that speech recognizers commonly produce from silence or noise.
const INVENTED = [
  'thank you', 'thanks for watching', 'thank you for watching', 'you', 'bye', 'bye bye', 'okay', 'ok',
  'subtitles by the amara org community', 'please subscribe', 'music', 'silence', 'applause',
  'תודה', 'תודה רבה', 'תודה שצפיתם', 'כתוביות'
];

function words(text) {
  return String(text || '')
    .normalize('NFC')
    .replace(/\[[^\]]*\]|\([^)]*\)|[♪♫*]/g, ' ')        // [music], (silence), ♪
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^\p{L}\p{N}'֑-ׇ]/gu, '').replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

/** @returns {{passes:boolean, realWords:number, reason:null|'empty'|'gibberish'}} */
function checkTranscript(text) {
  const all = words(text);
  if (!all.length) return { passes: false, realWords: 0, reason: 'empty' };
  const plain = all.map(w => w.replace(/[֑-ׇ']/g, '')).join(' ');
  if (INVENTED.includes(plain)) return { passes: false, realWords: 0, reason: 'empty' };
  const real = all.filter(w => {
    const bare = w.replace(/[֑-ׇ']/g, '');
    return [...bare].length >= 2 && !FILLERS.has(bare) && !/^(.{1,3})\1{2,}$/u.test(bare); // "lalala", "bababa"
  });
  const distinct = new Set(real.map(w => w.replace(/[֑-ׇ']/g, '')));
  // Lean heavily toward passing: two different real words, or one word of 3+ letters, is enough.
  if (distinct.size >= 2 || [...distinct].some(w => [...w].length >= 3)) return { passes: true, realWords: real.length, reason: null };
  return { passes: false, realWords: real.length, reason: 'gibberish' };
}

module.exports = { checkTranscript, words, FILLERS, INVENTED };
