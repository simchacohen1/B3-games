'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'multiplayer', 'game.js'), 'utf8');

test('classmate search waits 30 seconds, shows the countdown, and offers a Play the computer now button', () => {
  assert.match(source, /const COMPUTER_WAIT_MS = 30000;/);
  assert.match(source, /Looking for a classmate… '/);
  assert.match(source, /button\('Play the computer now'/);
  assert.doesNotMatch(source, /supportsComputer \? 8000/);
});
