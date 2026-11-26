// Rashi Letters teacher page: two tabs (Waiting to mark / Marked today), clean cards, instructions collapsed.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const page = fs.readFileSync('rashi-letters/teacher.html', 'utf8').replace(/\r\n/g, '\n');

test('instructions are collapsed behind a small "How marking works" link', () => {
  assert.match(page, /<details class="how-marks"><summary>How marking works<\/summary>/);
});
test('two tabs with counts', () => {
  assert.match(page, /Waiting to mark \(<span id="cntWaiting">/);
  assert.match(page, /Marked today \(<span id="cntMarked">/);
});
test('each card has name, posuk, try number, time, a big Play button, letters, status and a Done button', () => {
  const card = page.slice(page.indexOf('function rashiCardHtml'), page.indexOf('function rashiPlayerHtml'));
  for (const bit of ['rc-name', 'sectionLabel', 'Try #', 'rashiWhen', 'rashiPlayerHtml', 'rashiTextHtml', 'data-field="status"', 'data-done="1"', 'rc-done'])
    assert.ok(card.includes(bit), bit);
  assert.match(page, /class="rc-play"/);
});
test('grading, points and refunds still go through the same server actions', () => {
  for (const a of ["rashi-list-pending", "rashi-letter-marks", "rashi-delete", "rashi-approve", "rashi-letter-stats"]) assert.ok(page.includes(a), a);
});
