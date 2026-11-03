'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'b3-race.js'), 'utf8');

test('race final results board is marked and never redrawn with finish flags', () => {
  assert.match(src, /if \(results\) b\.setAttribute\("data-b3r-final", "1"\)/, 'results board carries the final marker');
  assert.match(src, /if \(old && !old\.hasAttribute\("data-b3r-final"\)\) old\.replaceWith\(board\(data, false\)\)/,
    'live updates skip a board that is already the final medal board');
  const medals = src.match(/results \? \(\["🥇", "🥈", "🥉"\]/);
  assert.ok(medals, 'results board uses medals');
});
