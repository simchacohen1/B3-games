'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const teamSource = fs.readFileSync(path.join(root, 'game-show/team-modes.js'), 'utf8');
const teacherSource = fs.readFileSync(path.join(root, 'game-show/teacher.html'), 'utf8');

function loadTeamLogic() {
  const window = {};
  const context = {
    window,
    location: { pathname: '/teacher.html' },
    document: { querySelector: () => ({ querySelectorAll: () => [] }) },
    gameRef: { on: () => {} }
  };
  vm.runInNewContext(teamSource, context, { filename: 'team-modes.js' });
  return window.GameShowTeamModeLogic;
}

test('two simulated students are assigned to opposite teams and can both compete', () => {
  const logic = loadTeamLogic();
  const data = { scores: { 'Student One': 0, 'Student Two': 0 } };
  const teams = JSON.parse(JSON.stringify(logic.teamsFor(data)));
  assert.deepEqual(teams, { A: ['Student One'], B: ['Student Two'] });
  assert.deepEqual(JSON.parse(JSON.stringify(logic.contestantsFor(data, 0))), {
    A: 'Student One', B: 'Student Two'
  });
});

test('balanced teams rotate every student through a turn before repeating', () => {
  const logic = loadTeamLogic();
  const data = { scores: Object.fromEntries(['Ari', 'Benny', 'Chaim', 'Dovid', 'Eli', 'Feivel'].map(name => [name, 0])) };
  const teams = JSON.parse(JSON.stringify(logic.teamsFor(data)));
  assert.equal(Math.abs(teams.A.length - teams.B.length), 0);
  const rounds = Array.from({ length: 3 }, (_, i) => logic.contestantsFor(data, i));
  const seen = rounds.flatMap(round => [round.A, round.B]);
  assert.equal(new Set(seen).size, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(logic.contestantsFor(data, 3))), {
    A: rounds[0].A, B: rounds[0].B
  });
});

test('answer eligibility handles all four game modes and blocks non-selected students', () => {
  const canAnswer = loadTeamLogic().canAnswerChoice;
  assert.equal(canAnswer({ roundActive: true, teamMode: false, multipleChoice: false, buzzedBy: 'Ari' }, 'Ari'), false);
  assert.equal(canAnswer({ roundActive: true, teamMode: false, multipleChoice: true, buzzedBy: 'Ari' }, 'Ari'), true);
  assert.equal(canAnswer({ roundActive: true, teamMode: false, multipleChoice: true, buzzedBy: 'Ari' }, 'Benny'), false);
  assert.equal(canAnswer({ roundActive: true, teamMode: true, multipleChoice: false, buzzedBy: 'Ari' }, 'Ari'), false);
  assert.equal(canAnswer({ roundActive: true, teamMode: true, multipleChoice: true, buzzedBy: 'Ari' }, 'Ari'), true);
  assert.equal(canAnswer({ roundActive: true, teamMode: true, multipleChoice: true, buzzedBy: 'Ari', helperName: 'Chaim' }, 'Chaim'), true);
  assert.equal(canAnswer({ roundActive: true, teamMode: true, multipleChoice: true, buzzedBy: 'Ari', helperName: 'Chaim' }, 'Ari'), false);
  assert.equal(canAnswer({ roundActive: false, teamMode: false, multipleChoice: true, buzzedBy: 'Ari' }, 'Ari'), false);
});

test('Team Mode and Multiple Choice are separately persisted switches', () => {
  assert.match(teamSource, /id="teamModeToggle"/);
  assert.match(teamSource, /id="multipleChoiceToggle"/);
  assert.match(teamSource, /teamMode:\s*document\.getElementById\("teamModeToggle"\)\.checked/);
  assert.match(teamSource, /multipleChoice:\s*document\.getElementById\("multipleChoiceToggle"\)\.checked/);
});
