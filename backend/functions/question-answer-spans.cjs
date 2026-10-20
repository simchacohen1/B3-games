'use strict';
// Match evidence text to the same whitespace tokens used by the student's UI.
// Maqaf may join two words into one button; resolve against buttons, not an
// AI model's interpretation of where word boundaries or index zero belong.
function normalizePhrase(text) {
  return String(text || '').normalize('NFD')
    .replace(/[\u0591-\u05BD\u05BF-\u05C7]/g, '')
    .replace(/\u05BE/g, ' ').replace(/[^\u05D0-\u05EA\s]/g, '')
    .replace(/\s+/g, ' ').trim();
}
function resolveAnswerWordSets(posukText, phrases) {
  const words = String(posukText || '').trim().split(/\s+/).filter(Boolean);
  if (!Array.isArray(phrases) || !phrases.length || phrases.length > 3) return [];
  const sets = new Map();
  for (const phrase of phrases) {
    if (typeof phrase !== 'string') return [];
    const target = normalizePhrase(phrase);
    if (!target) return [];
    let found = false;
    for (let start = 0; start < words.length; start++) {
      for (let end = start + 1; end <= words.length; end++) {
        if (normalizePhrase(words.slice(start, end).join(' ')) !== target) continue;
        const indices = Array.from({ length: end - start }, (_, i) => start + i);
        sets.set(indices.join(','), indices); found = true;
      }
    }
    // A hallucinated or partial-token phrase cannot become an answer key.
    if (!found) return [];
  }
  return Array.from(sets.values());
}
module.exports = { resolveAnswerWordSets };
