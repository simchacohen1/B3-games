'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../follow-teacher/core.js');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const NOW = 1_800_000_000_000;
const STATE = {
  workspaceId: 'b3-2026', classId: 'et', teacherUid: 'teacher123', revision: 'lock1',
  mode: 'locked', destination: 'shorashim', targets: 'all',
  issuedAt: NOW - 5000, heartbeatAt: NOW - 1000, expiresAt: NOW + 60_000
};
const ctx = (url, extra) => ({studentAuthorized: true, workspaceId: 'b3-2026', classId: 'et', studentId: 'boy1',
  allowedTools: {shorashim: true}, currentUrl: 'https://funtorahtools.com' + url, now: NOW, ...extra});

test('multiplayer is NOT a Follow the Teacher destination', () => {
  assert.equal(C.DESTINATIONS['multiplayer-center'], undefined);
  assert.equal(C.decide({...STATE, destination: 'multiplayer-center'}, ctx('/shorashim/', {allowedTools: {'multiplayer-center': true}})).action, 'none');
});

test('teacher locks Shorashim: a student in the Arcade center or a game is moved out', () => {
  for (const url of ['/multiplayer/', '/multiplayer/index.html', '/multiplayer/game.html?game=checkers']) {
    const d = C.decide(STATE, ctx(url));
    assert.equal(d.action, 'navigate', url);
    assert.equal(d.destination, '/shorashim/');
  }
});

test('Once mode moves the student one time, then lets them go back to the Arcade', () => {
  const once = {...STATE, mode: 'free'};
  const sent = C.decide(once, ctx('/multiplayer/game.html?game=set'));
  assert.equal(sent.action, 'navigate');
  assert.equal(C.decide(once, ctx('/multiplayer/', {lastAppliedKey: sent.applyKey})).action, 'none');
});

test('Unlock Everyone frees students in the Arcade', () => {
  const freed = {...STATE, mode: 'independent', destination: null};
  assert.equal(C.decide(freed, ctx('/multiplayer/game.html?game=set')).action, 'none');
});

test('a locked student who is not selected, or lacks the tool, is not moved', () => {
  assert.equal(C.decide({...STATE, targets: ['boy2']}, ctx('/multiplayer/')).action, 'none');
  assert.equal(C.decide(STATE, ctx('/multiplayer/', {allowedTools: {shorashim: false}})).action, 'none');
});

test('both Arcade pages load the shared gate after firebase-config, as multiplayer-center, with teachers left open', () => {
  for (const page of ['index.html', 'game.html']) {
    const html = read('multiplayer/' + page);
    assert.match(html, /<script src="\.\.\/game-gate\.js\?v=[^"]+" data-game-id="multiplayer-center" data-teachers-open><\/script>/, page);
    assert.ok(html.indexOf('firebase-config.js') < html.indexOf('game-gate.js'), page);
    assert.ok(html.indexOf('game-gate.js') < html.indexOf('identity.js'), page);
  }
});

test('the gate lets a verified teacher through only when the page opts in, and before the ?class= check', () => {
  const gate = read('game-gate.js');
  const optIn = gate.indexOf('hasAttribute("data-teachers-open")');
  assert.ok(optIn > 0);
  assert.ok(gate.lastIndexOf('verifiedTeacherAccess.authorized){', optIn) > gate.lastIndexOf('function decide', optIn));
  assert.ok(optIn < gate.indexOf('Choose an assigned class'));
  assert.equal((read('shorashim/index.html').match(/data-teachers-open/g) || []).length, 0);
});

test('the follow listener warns students to save before moving them and honors the unsaved-work veto', () => {
  const student = read('follow-teacher/student.js');
  assert.match(student, /Save your work now\./);
  assert.match(student, /ftt:before-follow-navigation/);
  assert.match(student, /data-ftt-unsaved/);
});
