'use strict';
// Posuk Practice word marks (teacher grading screen).
//
// The teacher can tap words of the posuk: tap a word = read wrong, small T under a word = translated wrong.
// Everything not marked counts as correct. From the marks this file works out a SUGGESTED score:
//   Reading     = words read correctly out of all words
//   Translation = words translated correctly out of all words
//   Combined    = both together, as a percentage
// The suggestion is for the teacher to look at. It NEVER sets the 0-10 grade, the points or the lock.
//
// The record saved on the submission (submissions/<studentId>/<submissionId>/wordReview) has one entry per word so a
// report of every graded word can be added later without changing the data:
//   { version, total, words:[{i, w, readOk, translationOk}], suggested:{...}, markedAt, markedBy }
//
// This one file is used by the server (backend/functions and backend/functions-staging) and by the teacher page
// (record_pesukim/posuk-word-marks-core.js). The copies must stay identical (tests/posuk-word-marks.test.cjs).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.B3PosukWordMarks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_WORDS = 300;
  const VERSION = 1;

  // Words are what is between spaces. A word joined by a maqaf (a hyphen-like mark) is one word, as it is read.
  function splitWords(text) {
    return String(text == null ? '' : text).split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  }

  function cleanIndexes(list, total, what) {
    if (list == null) return new Set();
    if (!Array.isArray(list)) throw Object.assign(new Error(what + ' must be a list of word numbers.'), { code: 400 });
    const out = new Set();
    for (const n of list) {
      if (!Number.isInteger(n) || n < 0 || n >= total) throw Object.assign(new Error(what + ' has a word number that is not in this posuk.'), { code: 400 });
      out.add(n);
    }
    return out;
  }

  function scores(total, readWrongCount, translationWrongCount) {
    const readingCorrect = total - readWrongCount, translationCorrect = total - translationWrongCount;
    const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
    return {
      total, readingCorrect, translationCorrect,
      readingPct: pct(readingCorrect, total), translationPct: pct(translationCorrect, total),
      combinedPct: pct(readingCorrect + translationCorrect, total * 2)
    };
  }

  // text: the posuk as shown to the teacher. readWrong / translationWrong: lists of word numbers (0 is the first word).
  function build(text, readWrong, translationWrong) {
    const words = splitWords(text);
    if (!words.length) throw Object.assign(new Error('This recording has no posuk text to mark.'), { code: 400 });
    const r = cleanIndexes(readWrong, words.length, 'Read wrong'), t = cleanIndexes(translationWrong, words.length, 'Translated wrong');
    return {
      version: VERSION, total: words.length,
      words: words.map((w, i) => ({ i, w, readOk: !r.has(i), translationOk: !t.has(i) })),
      suggested: scores(words.length, r.size, t.size)
    };
  }

  // The words that are marked wrong, in the shape the teacher page works with.
  function wrongSets(record) {
    const read = new Set(), translation = new Set();
    for (const w of (record && Array.isArray(record.words) ? record.words : [])) {
      if (w && w.readOk === false) read.add(w.i);
      if (w && w.translationOk === false) translation.add(w.i);
    }
    return { read, translation };
  }

  function label(s) {
    if (!s || !s.total) return '';
    return 'Reading ' + s.readingCorrect + '/' + s.total + ' · Translation ' + s.translationCorrect + '/' + s.total + ' · Combined ' + s.combinedPct + '%';
  }

  return { MAX_WORDS, VERSION, splitWords, scores, build, wrongSets, label };
});
