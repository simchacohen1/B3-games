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

test('answers score automatically and an incorrect team answer opens one usable steal', () => {
  const logic = loadTeamLogic();
  const solo = {
    teamMode: false, multipleChoice: true, roundActive: true, buzzedBy: 'Ari',
    scores: { Ari: 0 }
  };
  const soloCorrect = logic.applyChoice(solo, 'Ari', 1, 1, 100);
  assert.equal(soloCorrect.scores.Ari, 10);
  assert.equal(soloCorrect.answerState.outcome, 'correct');

  const team = {
    teamMode: true, multipleChoice: true, roundActive: true, buzzedBy: 'Ari',
    scores: { Ari: 0, Benny: 0 }, teamScores: { A: 0, B: 0 }
  };
  const firstWrong = logic.applyChoice(team, 'Ari', 0, 1, 101);
  assert.equal(firstWrong.teamScores.A, -5);
  assert.equal(firstWrong.stealTeam, 'B');
  assert.equal(firstWrong.answerState, null);
  assert.equal(firstWrong.lastAnswerState.outcome, 'incorrect');
  assert.equal(logic.applyChoice(firstWrong, 'Ari', 1, 1, 102), undefined);

  const stealTurn = { ...firstWrong, buzzedBy: 'Benny' };
  const stealCorrect = logic.applyChoice(stealTurn, 'Benny', 1, 1, 103);
  assert.equal(stealCorrect.teamScores.B, 10);
  assert.equal(stealCorrect.answerState.outcome, 'correct');
  assert.equal(stealCorrect.revealed, true);
  assert.equal(stealCorrect.stealTeam, null);
});

test('Team Mode and Multiple Choice are separately persisted switches', () => {
  assert.match(teamSource, /id="teamModeToggle"/);
  assert.match(teamSource, /id="multipleChoiceToggle"/);
  assert.match(teamSource, /teamMode:\s*document\.getElementById\("teamModeToggle"\)\.checked/);
  assert.match(teamSource, /multipleChoice:\s*document\.getElementById\("multipleChoiceToggle"\)\.checked/);
});
