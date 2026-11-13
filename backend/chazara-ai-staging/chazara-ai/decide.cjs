'use strict';
/**
 * Chazara AI Practice — the server's part of the result (casual, lenient practice).
 *
 * The browser already stopped silent or too-short recordings ("Couldn't Hear
 * Clearly", nothing uploaded). Here each pasuk only needs real words in its
 * transcript. Meaning is not checked and nothing is compared with the pasuk.
 *
 *   every pasuk has real words         -> Excellent!
 *   some pesukim do, some don't        -> Almost There!   (multi-pasuk only)
 *   no pasuk has real words            -> Let's Try Again! "I couldn't make that out — try again."
 *
 * Every result can be retried right away, with no penalty.
 */

const MESSAGES = {
  excellent: { title: 'Excellent!', message: 'Excellent job! You read and explained the pasuk beautifully!' },
  almost: { title: 'Almost There!', message: "Great effort! You're getting closer. Practice a little more and try again!" },
  try_again: { title: "Let's Try Again!", message: "I couldn't make that out — try again." },
  unclear: { title: "Couldn't Hear Clearly", message: "I couldn't hear you — try again!" }
};

const TIPS = {
  retry: 'Read the pasuk in a nice, clear voice, then say what it means.',
  missing: 'Some pesukim were hard to make out. Try them again!'
};

/** @param {Array<{id,label,passes:boolean}>} rows */
function decide(rows) {
  const passed = rows.filter(r => r.passes).length;
  let outcome, reason, tips = [];
  if (passed === rows.length) { outcome = 'excellent'; reason = 'words_heard'; }
  else if (passed > 0) { outcome = 'almost'; reason = 'some_pesukim_unclear'; tips = [TIPS.missing]; }
  else { outcome = 'try_again'; reason = 'no_words'; tips = [TIPS.retry]; }
  return {
    outcome, reason, ...MESSAGES[outcome], tips,
    pesukim: rows.map(r => ({ id: r.id, label: r.label, status: outcome === 'try_again' ? null : r.passes ? 'great' : 'practice' }))
  };
}

module.exports = { decide, MESSAGES, TIPS };
