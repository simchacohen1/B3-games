'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../follow-teacher/core.js');
const policy = require('../backend/functions/student-tool-policy.js');

const NOW = 1_800_000_000_000;
const STATE = {
  workspaceId: 'b3-2026', classId: 'et', teacherUid: 'teacher123', revision: 'arcade1',
  mode: 'locked', destination: 'multiplayer-center', targets: 'all',
  issuedAt: NOW - 5000, heartbeatAt: NOW - 1000, expiresAt: NOW + 60_000
};
const ctx = url => ({studentAuthorized: true, workspaceId: 'b3-2026', classId: 'et', studentId: 'boy1',
  allowedTools: {'multiplayer-center': true}, currentUrl: url, now: NOW});
const at = p => 'https://funtorahtools.com' + p;

test('the Arcade is a registered Follow the Teacher destination and student tool', () => {
  assert.equal(C.DESTINATIONS['multiplayer-center'].path, '/multiplayer/');
  assert.ok(policy.studentActivities.includes('multiplayer-center'));
});

test('locked to the Arcade: students elsewhere are brought in, and center and games both count as inside', () => {
  const away = C.decide(STATE, ctx(at('/shorashim/')));
  assert.equal(away.action, 'navigate');
  assert.equal(away.destination, '/multiplayer/');
  assert.equal(C.decide(STATE, ctx(at('/multiplayer/index.html'))).action, 'stay');
  assert.equal(C.decide(STATE, ctx(at('/multiplayer/game.html?game=checkers'))).action, 'stay');
});

test('locked to another tool: a student in an Arcade game or the Arcade is moved out', () => {
  const shorashim = {...STATE, destination: 'shorashim'};
  const c = {...ctx(at('/multiplayer/game.html?game=checkers')), allowedTools: {shorashim: true}};
  assert.equal(C.decide(shorashim, c).action, 'navigate');
  assert.equal(C.decide(shorashim, {...c, currentUrl: at('/multiplayer/')}).action, 'navigate');
});

test('Once mode sends a student to the Arcade a single time, then lets them leave', () => {
  const once = {...STATE, mode: 'free'};
  const sent = C.decide(once, ctx(at('/shorashim/')));
  assert.equal(sent.action, 'navigate');
  const after = C.decide(once, {...ctx(at('/shorashim/')), lastAppliedKey: sent.applyKey});
  assert.equal(after.action, 'none');
});

test('Unlock Everyone (independent) frees students inside the Arcade', () => {
  const freed = {...STATE, mode: 'independent', destination: null};
  assert.equal(C.decide(freed, ctx(at('/multiplayer/game.html?game=set'))).action, 'none');
});

test('a student without Arcade access is never sent there', () => {
  const c = {...ctx(at('/shorashim/')), allowedTools: {'multiplayer-center': false}};
  assert.equal(C.decide(STATE, c).action, 'none');
});

test('both Arcade pages load the shared gate (which starts the follow listener) as multiplayer-center', () => {
  for (const page of ['index.html', 'game.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'multiplayer', page), 'utf8');
    assert.match(html, /<script src="\.\.\/game-gate\.js\?v=[^"]+" data-game-id="multiplayer-center"><\/script>/, page);
    assert.ok(html.indexOf('firebase-config.js') < html.indexOf('game-gate.js'), page);
  }
});
