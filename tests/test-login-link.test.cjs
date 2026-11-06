'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const links = require('../test-login-link.js');
const { batFile } = require('../scripts/make-test-login-link.cjs');

test('link round-trips name and passcode through the # part only', () => {
  const url = links.link('https://funtorahtools.com/', 'Monitor Testbot', '4821');
  const u = new URL(url);
  assert.equal(u.search, '');
  assert.match(u.hash, /^#ftt-test=[A-Za-z0-9_-]+$/);
  assert.ok(!url.includes('4821'), 'passcode is not readable in the link');
  assert.deepEqual(links.readHash(u.hash), { name: 'Monitor Testbot', passcode: '4821' });
});

test('bad or missing tokens are ignored', () => {
  for (const hash of ['', '#', '#other=1', '#ftt-test=', '#ftt-test=@@@@@@@@@', '#ftt-test=' + Buffer.from('{"v":2,"n":"a","p":"b"}').toString('base64url'), '#ftt-test=' + Buffer.from('not json').toString('base64url')]) {
    assert.equal(links.readHash(hash), null, hash);
  }
});

test('only test classes are accepted', () => {
  assert.equal(links.onlyTestClasses([{ id: 'abc', name: 'Testing' }], 'abc'), true);
  assert.equal(links.onlyTestClasses([{ id: 'TEST-ALEF', name: 'Test Class Alef' }], 'TEST-ALEF'), true);
  assert.equal(links.onlyTestClasses([{ id: 'et', name: 'ET' }], 'et'), false);
  assert.equal(links.onlyTestClasses([{ id: 'TEST-ALEF', name: 'Test Class Alef' }, { id: 'wt', name: 'WT' }], 'TEST-ALEF'), false, 'a test student also in a real class is refused');
  assert.equal(links.onlyTestClasses([], 'et'), false);
  assert.equal(links.onlyTestClasses([], 'testing'), true);
});

test('bat file escapes % and opens a private window', () => {
  const out = batFile([{ name: 'A', url: 'https://x/#ftt-test=a%b' }]);
  assert.match(out, /chrome --incognito --new-window "https:\/\/x\/#ftt-test=a%%b"/);
});

test('home page wires the link to the guarded sign-in', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<script src="test-login-link\.js[^"]*"><\/script>/);
  assert.match(html, /history\.replaceState\(null,"",location\.pathname\+location\.search\)/);
  assert.match(html, /onlyTestClasses\(studentClassChoices,r\.classId\)/);
  assert.match(html, /isAuthorizedTeacher\|\|currentUser\?\.email/);
});
