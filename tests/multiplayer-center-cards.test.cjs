'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('multiplayer/center.js', 'utf8') + fs.readFileSync('multiplayer/art.js', 'utf8');
function capture(expression, label) {
  const match = source.match(expression);
  assert.ok(match, `missing ${label}`);
  return vm.runInNewContext('(' + match[1] + ')');
}

const games = capture(/var GAMES = (\[[\s\S]*?\]);/, 'game catalog');
const categories = capture(/var GAME_CATEGORIES = (\{[\s\S]*?\n  \});/, 'game categories');
const artwork = capture(/var GAME_ART = (\{[\s\S]*?\n  \});/, 'game artwork');

test('all 17 multiplayer cards have a distinct illustration, category, and playable route', () => {
  assert.equal(games.length, 17);
  assert.equal(new Set(games.map(game => game.key)).size, 17);
  for (const game of games) {
    assert.ok(game.name && game.description && game.url, `${game.key} has its child-friendly card copy and route`);
    assert.ok(categories[game.key], `${game.key} belongs to a visible category`);
    assert.match(artwork[game.key] || '', /<|>/, `${game.key} has custom vector artwork`);
  }
  assert.match(source, /button\.addEventListener\("click", function \(\) \{ route\(game, game\.mode\); \}\)/,
    'every card button launches its game route');
  assert.match(source, /games\.forEach\(function \(game\) \{ gameGrid\.appendChild\(drawGameCard\(game\)\); \}\)/,
    'every catalog entry renders as a card');
});
