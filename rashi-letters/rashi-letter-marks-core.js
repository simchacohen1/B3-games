'use strict';
// Rashi Letters reading: letter marks (teacher grading screen).
//
// The teacher sees the Rashi text large with every LETTER tappable. All letters count as correct until tapped.
// A tapped letter is "not recognized". From the marks this file works out:
//   - the points: the letters are split into 5 equal parts; each part with no missed letter earns 1 point (perfect = 5)
//   - the per-letter counts (seen / missed) for the 27 letters (22 letters + 5 final forms), which add up into each
//     boy's running letter scores and the weekly Nigri Rashi mark.
// A letter keeps its dots and vowels (niqqud) with it: the letter is the base Hebrew letter (ב and בּ are both bet,
// שׁ and שׂ are both shin). Final forms (ך ם ן ף ץ) are letters of their own.
//
// This one file is used by the server (backend/functions and backend/functions-staging, as .cjs) and by the teacher page
// (rashi-letters/rashi-letter-marks-core.js). The copies must stay identical (tests/rashi-letter-marks.test.cjs).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.B3RashiLetterMarks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PARTS = 5;
  const MAX_LETTERS = 2000;
  const VERSION = 1;
  const LETTER_KEYS = Object.freeze('אבגדהוזחטיכךלמםנןסעפףצץקרשת'.split(''));   // 22 letters + 5 finals = 27
  const isLetter = ch => ch >= 'א' && ch <= 'ת';
  const isMark = ch => (ch >= '֑' && ch <= 'ֽ') || ch === 'ֿ' || ch === 'ׁ' || ch === 'ׂ' || ch === 'ׄ' || ch === 'ׅ' || ch === 'ׇ';

  // text -> { total, words } where words is a list of words and each word a list of pieces:
  //   { letter: true, i, key, text }   a tappable letter (i counts letters from 0, in reading order; text includes its vowels)
  //   { letter: false, text }          anything else (punctuation, quotes), shown but not tappable
  function tokenize(text) {
    const words = [];
    let total = 0;
    for (const rawWord of String(text == null ? '' : text).normalize('NFC').split(/\s+/).filter(Boolean)) {
      const pieces = [];
      let cur = null;
      for (const ch of rawWord) {
        if (isLetter(ch)) {
          if (total >= MAX_LETTERS) break;
          cur = { letter: true, i: total++, key: ch, text: ch };
          pieces.push(cur);
        } else if (isMark(ch) && cur) {
          cur.text += ch;
        } else {
          cur = null;
          const last = pieces[pieces.length - 1];
          if (last && !last.letter) last.text += ch; else pieces.push({ letter: false, text: ch });
        }
      }
      if (pieces.length) words.push(pieces);
    }
    return { total, words };
  }

  // The 5 equal parts as [start, end) letter numbers. With fewer than 5 letters some parts are empty.
  function partBounds(total) {
    const out = [];
    for (let k = 0; k < PARTS; k++) out.push([Math.floor(k * total / PARTS), Math.floor((k + 1) * total / PARTS)]);
    return out;
  }

  function cleanMissed(list, total) {
    if (list == null) return new Set();
    if (!Array.isArray(list)) throw Object.assign(new Error('Missed letters must be a list of letter numbers.'), { code: 400 });
    const out = new Set();
    for (const n of list) {
      if (!Number.isInteger(n) || n < 0 || n >= total) throw Object.assign(new Error('A marked letter is not in this reading.'), { code: 400 });
      out.add(n);
    }
    return out;
  }

  // text: the reading as stored. missedList: letter numbers marked "not recognized".
  // An empty part (fewer than 5 letters) earns its point only when nothing at all was missed.
  function score(text, missedList) {
    const tk = tokenize(text);
    if (!tk.total) throw Object.assign(new Error('This recording has no Hebrew letters to mark.'), { code: 400 });
    const missed = cleanMissed(missedList, tk.total);
    const bounds = partBounds(tk.total);
    const partsClean = bounds.map(([a, b]) => {
      if (b <= a) return missed.size === 0;
      for (let i = a; i < b; i++) if (missed.has(i)) return false;
      return true;
    });
    const letters = {};
    for (const word of tk.words) for (const p of word) {
      if (!p.letter) continue;
      const row = letters[p.key] || (letters[p.key] = { seen: 0, missed: 0 });
      row.seen++;
      if (missed.has(p.i)) row.missed++;
    }
    return {
      version: VERSION, total: tk.total, missed: [...missed].sort((a, b) => a - b), missedCount: missed.size,
      partsClean, points: partsClean.filter(Boolean).length, letters,
      pct: Math.round(((tk.total - missed.size) / tk.total) * 100)
    };
  }

  // Add one graded reading's letter counts to a running total { key: {seen, missed} }.
  function addLetters(into, letters) {
    for (const [key, row] of Object.entries(letters || {})) {
      if (!row || !LETTER_KEYS.includes(key)) continue;
      const t = into[key] || (into[key] = { seen: 0, missed: 0 });
      t.seen += Number(row.seen) || 0;
      t.missed += Number(row.missed) || 0;
    }
    return into;
  }

  const letterPct = row => (row && row.seen > 0 ? Math.round(((row.seen - row.missed) / row.seen) * 100) : null);

  return { PARTS, MAX_LETTERS, VERSION, LETTER_KEYS, tokenize, partBounds, score, addLetters, letterPct };
});
