const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const js = fs.readFileSync(path.join(__dirname, '..', 'class-pointer-prototype', 'saved-work.js'), 'utf8');

test('Open and Delete ask on the page, not with the browser grey box', () => {
  assert.match(js, /function ask\(question,yes,danger\)/);
  assert.match(js, /if\(!await ask\('Delete "'\+file\.name\+'"\? You cannot get it back\.','Delete',true\)\)return;/);
  assert.match(js, /if\(!await ask\(file\.template\?'Open a fresh copy/);
  assert.doesNotMatch(js, /if\(!confirm\(file\.template/);
});

test('after a teacher saves, the message names the file and says where it is, and stays long enough to read', () => {
  assert.match(js, /ui\.say\('Saved as "'\+clean\+'"\. Find it in My files\.'\);setTimeout\(\(\)=>ui\.dialog\.close\(\),2200\);/);
});
