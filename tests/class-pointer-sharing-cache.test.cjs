'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pages = [
  "index.html",
  "chavrusa/index.html",
  "chazara/index.html",
  "class-gallery/index.html",
  "davening_student_app_et/index.html",
  "davening_student_app_wt/index.html",
  "game-show/player.html",
  "gematria/index.html",
  "rashi-letters/student.html",
  "record_pesukim/student.html",
  "sefer-hamitzvos/index.html",
  "shorashim/index.html",
  "student-rewards/student.html",
  "weekly-quiz/index.html",
  "yiddish/index.html"
];
const root = path.join(__dirname, '..');

test('all student tools load the corrected activity screen-sharing script without stale caches', () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const refs = html.match(/activity-share[.]js[?]v=[^"']+/g) || [];
    assert.equal(refs.length, 1, page + ' must include exactly one activity-share script');
    assert.equal(refs[0], 'activity-share.js?v=20261018-embedded1', page + ' must use the release version');
  }
});

test('the classroom loads the updated PeerJS reconnection handling', () => {
  const html = fs.readFileSync(path.join(root, 'class-pointer-prototype/classroom.html'), 'utf8');
  assert.match(html, /classroom[.]js[?]v=20261018-myscreen175/);
  assert.match(html, /activity-screen-teacher[.]js[?]v=20261018-embedded1/);
});
