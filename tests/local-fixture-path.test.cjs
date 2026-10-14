'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveFixtureFile } = require('./helpers/local-fixture-path.cjs');

for (const [platform, paths, root] of [
  ['Windows', path.win32, 'C:\\fixture\\B3-games'],
  ['POSIX', path.posix, '/fixture/B3-games'],
]) {
  test(platform + ' fixtures accept nested files and reject escapes', () => {
    assert.equal(resolveFixtureFile(root, 'class-pointer-prototype/classroom-core.js', paths), paths.join(root, 'class-pointer-prototype', 'classroom-core.js'));
    assert.equal(resolveFixtureFile(root, '../B3-games-other/secret.js', paths), null);
    assert.equal(resolveFixtureFile(root, '../secret.js', paths), null);
    assert.equal(resolveFixtureFile(root, '.', paths), null);
    assert.equal(resolveFixtureFile(root, 'nested/../../secret.js', paths), null);
    assert.equal(resolveFixtureFile(root, 'nested/../safe.js', paths), paths.join(root, 'safe.js'));
  });
}

test('Windows fixtures reject another drive and backslash traversal', () => {
  assert.equal(resolveFixtureFile('C:\\fixture', 'D:\\secret.js', path.win32), null);
  assert.equal(resolveFixtureFile('C:\\fixture', '..\\secret.js', path.win32), null);
});
