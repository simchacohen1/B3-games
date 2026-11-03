'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

for (const folder of ['functions', 'functions-staging']) {
  test(`Uno current color follows a played colored card (${folder})`, () => {
    const core = require(`../backend/${folder}/multiplayer-games-core.cjs`);
    const group = { a: { name: 'a', active: true, joinedAt: 1 }, b: { name: 'b', active: true, joinedAt: 2 } };
    const card = (color, value, id) => ({ id, color, kind: 'number', value });
    const state = core.hydrateGameState('uno-style', {
      deck: [card('red', '9', 'r9'), card('red', '8', 'r8')],
      discard: [card('red', '5', 'r5')],
      hands: { a: [card('green', '5', 'g5'), card('blue', '1', 'b1')], b: [card('yellow', '2', 'y2'), card('yellow', '3', 'y3')] },
      playersOrder: ['a', 'b'], turn: 'a', color: 'red', moves: 0,
    });
    core.applyMove('uno-style', state, 'a', { type: 'play', index: 0 }, group);
    assert.equal(state.color, 'green', 'playing green 5 on red 5 makes green the current color');
    assert.equal(state.turn, 'b');
    assert.throws(() => core.applyMove('uno-style', state, 'b', { type: 'play', index: 0 }, group), /Match the current color or number/);
  });
}
