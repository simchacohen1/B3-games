'use strict';
// sols.tools tab titles and icons: page name first ("Arcade | SOLS Tools"), the home page keeps
// "SOLS Tools | Shluchim Online School" and the school emblem, inner pages keep their own section icon.
const test = require('node:test'), assert = require('node:assert/strict');
const { solsTitle, expectedLiveFiles } = require('../scripts/sols-expected.cjs');

test('the home page title stays exactly as the live smoke check needs it', () => {
  for (const raw of ['Home · SOLS', 'Fun Torah Tools', 'Shluchim Online School', '', 'SOLS Tools | Shluchim Online School'])
    assert.equal(solsTitle(raw), 'SOLS Tools | Shluchim Online School', JSON.stringify(raw));
});

test('inner pages put the page name first and SOLS Tools last, and the rule is idempotent', () => {
  const cases = { 'Arcade · SOLS': 'Arcade | SOLS Tools', 'Chess · Arcade · SOLS': 'Chess · Arcade | SOLS Tools', 'Teacher Home · SOLS': 'Teacher Home | SOLS Tools', 'Screen Share · SOLS': 'Screen Share | SOLS Tools' };
  for (const [raw, want] of Object.entries(cases)) {
    assert.equal(solsTitle(raw), want);
    assert.equal(solsTitle(want), want);
  }
});

test('the built sols.tools pages: emblem on home, own section icon on inner pages', () => {
  const files = ['index.html', 'multiplayer/index.html', 'class-pointer-prototype/dashboard.html'];
  const built = expectedLiveFiles(files);
  const icons = html => (html.match(/<link[^>]*rel="icon"[^>]*>/g) || []).map(l => (l.match(/href="([^"]+)"/) || [])[1]);
  assert.match(built.get('index.html'), /<title>SOLS Tools \| Shluchim Online School<\/title>/);
  assert.deepEqual(icons(built.get('index.html')), ['/sols-favicon-32x32.png', '/sols-favicon-16x16.png']);
  assert.match(built.get('multiplayer/index.html'), /<title>Arcade \| SOLS Tools<\/title>/);
  assert.deepEqual(icons(built.get('multiplayer/index.html')), ['/assets/favicons/arcade.svg']);
  assert.match(built.get('class-pointer-prototype/dashboard.html'), /<title>Class Pointer \| SOLS Tools<\/title>/);
  assert.deepEqual(icons(built.get('class-pointer-prototype/dashboard.html')), ['/assets/favicons/pointer-teacher.svg']);
  for (const f of files) assert.match(built.get(f), /rel="apple-touch-icon" href="\/sols-apple-touch-icon\.png"/, f + ' keeps the school home-screen icon');
});
