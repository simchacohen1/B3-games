'use strict';
/**
 * Chazara AI Practice — Hebrew reading comparison (no AI, fully deterministic).
 *
 * Compares what the speech recognizer heard (Hebrew-script transcript) with the
 * teacher-approved pasuk text. The goal is "did the child read most of THIS
 * pasuk", not nekudah-level grading, so the comparison is deliberately tolerant:
 *   - nekudos/trop are removed; final letters are normalised;
 *   - modern full spelling (extra ו/י) and silent letters (א/ע/ה) cost little;
 *   - letters that sound alike in Ashkenazi or Israeli reading (ת/ס/ט, כ/ח/ק,
 *     ב/ו, ש/ס …) are near-matches;
 *   - one pasuk word may be heard as two words, or two as one.
 * Order matters: words are aligned in sequence, so reading a different pasuk
 * that happens to share a few common words still scores low.
 */

const POINTS = /[֑-ֽֿׁׂׄ-ׇ]/g; // nekudos + trop (keeps maqaf/sof pasuk for splitting)
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
// Hashem's name is shown abbreviated (ה׳) and read aloud as "Hashem"/"Adoshem"/"Ado-noi".
const SHEM_READINGS = new Set(['השמ', 'אדני', 'אדוני', 'אדושמ', 'אדנ', 'יהוה', 'ה', 'אדונאי', 'אדנאי']);
const SHEM_MARK = '\u0001';

function normalizeHebrew(text) {
  let s = String(text || '').normalize('NFC');
  // Hashem's four-letter name (with any points) and the ה׳ / ה' abbreviation.
  s = s.replace(/י[֑-ׇ]*ה[֑-ׇ]*ו[֑-ׇ]*ה[֑-ׇ]*/g, ' ' + SHEM_MARK + ' ');
  s = s.replace(/(^|[^א-ת])ה[֑-ׇ]*['׳’]/g, '$1 ' + SHEM_MARK + ' ');
  s = s.replace(POINTS, '');
  s = s.replace(/[־׀׃\-–—]/g, ' '); // maqaf, paseq, sof pasuk, dashes
  s = s.replace(/[ךםןףץ]/g, c => FINALS[c]);
  return s;
}

function tokenize(text) {
  return normalizeHebrew(text)
    .split(/[^א-ת\u0001]+/)
    .filter(Boolean)
    .map(t => (t.includes(SHEM_MARK) ? SHEM_MARK : t));
}

// Groups of letters a child or a recognizer may swap without reading a different word.
const NEAR = [
  ['ת', 'ס', 'ט', 'ש', 'צ'], // Ashkenazi sav = s; sin/samech; tes/tav
  ['כ', 'ח', 'ק'],
  ['ב', 'ו', 'פ'],
  ['א', 'ע', 'ה'],
  ['ז', 'צ'],
  ['ג', 'ק'],
  ['ד', 'ט', 'ת']
];
const nearPair = new Set();
for (const group of NEAR) for (const a of group) for (const b of group) if (a !== b) nearPair.add(a + b);
const CHEAP_INDEL = new Set(['א', 'ע', 'ה', 'ו', 'י']);

function letterCost(a, b) {
  if (a === b) return 0;
  return nearPair.has(a + b) ? 0.35 : 1;
}
const indelCost = c => (CHEAP_INDEL.has(c) ? 0.3 : 1);

function weightedDistance(a, b) {
  const A = [...a], B = [...b];
  const prev = new Array(B.length + 1), cur = new Array(B.length + 1);
  prev[0] = 0;
  for (let j = 1; j <= B.length; j++) prev[j] = prev[j - 1] + indelCost(B[j - 1]);
  for (let i = 1; i <= A.length; i++) {
    cur[0] = prev[0] + indelCost(A[i - 1]);
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(
        prev[j] + indelCost(A[i - 1]),
        cur[j - 1] + indelCost(B[j - 1]),
        prev[j - 1] + letterCost(A[i - 1], B[j - 1])
      );
    }
    for (let j = 0; j <= B.length; j++) prev[j] = cur[j];
  }
  return prev[B.length];
}

// Strength of letters a word carries (vowel letters count less), used to scale distance.
const weight = w => [...w].reduce((n, c) => n + (CHEAP_INDEL.has(c) ? 0.5 : 1), 0);

function wordSimilarity(ref, heard) {
  if (!ref || !heard) return 0;
  if (ref === SHEM_MARK) return heard === SHEM_MARK || SHEM_READINGS.has(heard) ? 1 : 0;
  if (heard === SHEM_MARK) return 0;
  if (ref === heard) return 1;
  const scale = Math.max(weight(ref), weight(heard), 1);
  return Math.max(0, 1 - weightedDistance(ref, heard) / scale);
}

// Short words (ו, על, את …) are easy to match by accident, so they need to be closer.
function wordsMatch(ref, heard) {
  const sim = wordSimilarity(ref, heard);
  const len = weight(ref);
  if (len <= 1.5) return sim >= 0.85;
  if (len <= 2.5) return sim >= 0.7;
  return sim >= 0.6;
}

// A split/merged word must be genuinely similar AND of comparable length, so a
// short word cannot silently "absorb" a neighbouring pasuk word.
function mergedMatch(refJoined, heardJoined) {
  const a = [...refJoined].length, b = [...heardJoined].length;
  if (Math.min(a, b) / Math.max(a, b) < 0.75) return false;
  return wordSimilarity(refJoined, heardJoined) >= 0.75;
}

/**
 * Aligns heard tokens to the pasuk in order. Allowed steps: match one-to-one,
 * one pasuk word heard as two tokens, two pasuk words heard as one token, skip a
 * pasuk word (missed) or skip a heard token (extra speech, e.g. the translation).
 * Returns how many pasuk words were matched.
 */
function alignCoverage(refTokens, heardTokens) {
  const R = refTokens, H = heardTokens, n = R.length, m = H.length;
  if (!n) return { matched: 0, total: 0, coverage: 0, looseCoverage: 0, lastHeard: -1 };
  // best[i][j] = most pasuk words matched using R[0..i) and H[0..j)
  const best = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let v = Math.max(best[i - 1][j], best[i][j - 1]);
      if (wordsMatch(R[i - 1], H[j - 1])) v = Math.max(v, best[i - 1][j - 1] + 1);
      if (j >= 2 && R[i - 1] !== SHEM_MARK && mergedMatch(R[i - 1], H[j - 2] + H[j - 1])) v = Math.max(v, best[i - 1][j - 2] + 1);
      if (i >= 2 && R[i - 1] !== SHEM_MARK && R[i - 2] !== SHEM_MARK && mergedMatch(R[i - 2] + R[i - 1], H[j - 1])) v = Math.max(v, best[i - 2][j - 1] + 2);
      best[i][j] = v;
    }
  }
  const matched = best[n][m];
  // Trace back which pasuk words were matched, and where they were heard.
  const pairs = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const v = best[i][j];
    if (v === best[i - 1][j]) { i--; continue; }
    if (v === best[i][j - 1]) { j--; continue; }
    if (wordsMatch(R[i - 1], H[j - 1]) && v === best[i - 1][j - 1] + 1) { pairs.push([i - 1, j - 1]); i--; j--; continue; }
    if (j >= 2 && v === best[i - 1][j - 2] + 1 && mergedMatch(R[i - 1], H[j - 2] + H[j - 1])) { pairs.push([i - 1, j - 1]); i--; j -= 2; continue; }
    if (i >= 2 && v === best[i - 2][j - 1] + 2 && mergedMatch(R[i - 2] + R[i - 1], H[j - 1])) { pairs.push([i - 1, j - 1], [i - 2, j - 1]); i -= 2; j--; continue; }
    break; // not reached: every value comes from one of the steps above
  }
  pairs.reverse();
  // Real reading produces runs of neighbouring pasuk words heard close together.
  // A different pasuk that shares a few common words only gives scattered hits,
  // so only words that are part of such a run count toward "in-order" coverage.
  const inRun = new Set();
  for (let k = 1; k < pairs.length; k++) {
    const [r0, h0] = pairs[k - 1], [r1, h1] = pairs[k];
    if (r1 - r0 <= 2 && h1 - h0 <= 3 && h1 >= h0) { inRun.add(r0); inRun.add(r1); }
  }
  // A one-word pasuk cannot form a run; let a single match count there.
  const runMatched = n === 1 ? matched : inRun.size;
  // Index of the last heard token that matched a pasuk word (-1 if none). Anything
  // heard after it is speech that came after the reading (e.g. the translation).
  const lastHeard = pairs.reduce((mx, [, h]) => Math.max(mx, h), -1);
  return { matched, total: n, coverage: runMatched / n, looseCoverage: matched / n, lastHeard };
}

function hebrewCoverage(pasukText, heardText) {
  const ref = tokenize(pasukText);
  // Every spoken word, in order, in any script (Whisper may write an English or
  // Yiddish translation in Latin or Hebrew letters). Only Hebrew words are matched
  // against the pasuk; all words after the last matched one count as "after".
  const all = String(heardText || '').normalize('NFC').split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}'\u0591-\u05C7\u05F3]/gu, '')).filter(Boolean);
  const heard = [], position = [];
  all.forEach((w, i) => { for (const t of tokenize(w)) { heard.push(t); position.push(i); } });
  const result = alignCoverage(ref, heard);
  const lastWord = result.lastHeard >= 0 ? position[result.lastHeard] : -1;
  return { ...result, heardWords: all.length, wordsAfterReading: lastWord >= 0 ? all.length - 1 - lastWord : 0 };
}

module.exports = { normalizeHebrew, tokenize, wordSimilarity, wordsMatch, alignCoverage, hebrewCoverage, SHEM_MARK };
