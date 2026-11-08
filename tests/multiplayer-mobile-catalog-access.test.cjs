'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('all Arcade games remain disabled until verified class access resolves', () => {
  const source = read('multiplayer/center.js');
  assert.match(source, /button\.disabled = !readyToPlay;/);
  const checked = source.indexOf('classInfo = await window.B3MultiplayerIdentity.resolve');
  const enabled = source.indexOf('readyToPlay = true;');
  assert.ok(checked >= 0 && enabled > checked, 'unlock must follow identity verification');
  assert.match(source, /function showAccessError\(message, label\) \{\s*\/\/[^\n]*\n\s*readyToPlay = false;/);
  assert.match(source, /if \(!user\) \{\s*showAccessError\(/);
  assert.match(source, /catch \(e\) \{\s*console\.warn\("Multiplayer Center: class access check failed", e\)/);
});

test('unauthorized cards remain bright but have an unmistakably unavailable Play label', () => {
  const styles = read('multiplayer/center.css');
  const script = read('multiplayer/center.js');
  assert.match(styles, /#gameCategories \.game-launch:disabled\{opacity:1;cursor:not-allowed\}/);
  assert.match(styles, /#gameCategories \.game-launch:disabled \.game-play-label\{background:#64748b/);
  assert.match(script, /make\("span", "game-play-label", accessLabel\)/);
  assert.match(script, /readyToPlay \? "All 17 games, ready to play" : "Explore all 17 games"/);
});

test('access warning offers sign-in return without bypassing class checks', () => {
  const script = read('multiplayer/center.js');
  assert.match(script, /signInLink\.href = "\.\.\/index\.html"/);
  assert.match(script, /sessionStorage\.setItem\("b3StudentReturnTo", "multiplayer\/index\.html"\)/);
  assert.match(script, /accessDenied \? "Class access needed" : "Sign in to play"/);
  assert.match(script, /roomsRequest \+= 1;/);
});

test('floating Gallery button is absent on Arcade catalog but not game pages', () => {
  const gallery = read('gallery-share.js');
  // Match the narrowly scoped pathname guard without changing other activity captures.
  assert.ok(gallery.includes('if (/\\/multiplayer\\/(?:index\\.html)?$/i.test(location.pathname)) return;'));
  assert.ok(!gallery.includes('if (/\\/multiplayer\\/.*game'));
  assert.match(gallery, /function capture\(\)/);
});

test('HTML uses fresh assets and does not promise games are playable without sign-in', () => {
  const html = read('multiplayer/index.html');
  assert.match(html, /center\.css\?v=arcade-mobile-access-20261103-1/);
  assert.match(html, /center\.js\?v=arcade-mobile-access-20261103-1/);
  assert.match(html, /Sign in with your class account to play/);
});
