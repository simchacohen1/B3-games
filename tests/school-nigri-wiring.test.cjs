'use strict';
// Guards: every Nigri page is behind the school check, and Owner Admin manages schools.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const GATED_PAGES = [
  'sync-to-nigri/index.html', 'sync-to-nigri/school-marks.html', 'sync-to-nigri/chossid-lamdan.html',
  'sync-to-nigri/classtime.html', 'chossid-lamdan.html', 'weekly-quiz/chossid-lamdan.html',
  'weekly-quiz/B3SchoolMarksBridge.html'
];

test('every standalone Nigri page loads the school gate before its own scripts run', () => {
  for (const page of GATED_PAGES) {
    const html = read(page);
    const gate = html.search(/<script src="[^"]*sync-to-nigri\/nigri-school-gate\.js[^"]*"( data-owner-only="1")?><\/script>/);
    assert.ok(gate > 0, page + ' is missing the school gate');
    assert.ok(!/nigri-school-gate\.js[^"]*" data-mode="panel"/.test(html), page + ' must use full-page mode');
    const firstOther = html.slice(0, gate).match(/<script(?![^>]*guest-mode\.js)[^>]*>/);
    assert.equal(firstOther, null, page + ': only guest-mode.js may run before the gate');
  }
});

test('every page that talks to the Nigri sync server is covered by the gate', () => {
  const walk = dir => fs.readdirSync(path.join(__dirname, '..', dir), { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? [] : e.name.endsWith('.html') ? [path.posix.join(dir, e.name)] : []);
  const pages = ['.', 'sync-to-nigri', 'weekly-quiz'].flatMap(walk).map(p => p.replace(/^\.\//, ''));
  for (const page of pages) {
    const html = read(page);
    if (!/nigrisync\.onrender\.com|nigri-auth\.js|nigri-sync\.js/.test(html)) continue;
    assert.match(html, /nigri-school-gate\.js/, page + ' reaches NigriSync without the school gate');
  }
});

test('Weekly Quiz "Send to Nigri" starts hidden and appears only when the check allows it', () => {
  assert.match(read('weekly-quiz/teacher.html'), /nigri-school-gate\.js[^"]*" data-mode="panel"><\/script><script src="\.\.\/sync-to-nigri\/nigri-auth\.js"/);
  const js = read('weekly-quiz/nigri-sync.js');
  assert.match(js, /btn\.hidden = true;/);
  assert.match(js, /B3NigriGate\.ready\.then\(r => \{ btn\.hidden = !\(r && r\.allowed\); \}\)/);
});

test('home page Sync to Nigri card is hidden by default with a class the card filter cannot undo', () => {
  const html = read('index.html');
  const registryContext={window:{}};vm.runInNewContext(read('shared/home-tool-registry.js'),registryContext);
  const nigri=registryContext.window.B3HomeToolRegistry.homepageTeacherTools.find(item=>item.tool==='sync-to-nigri');
  assert.equal(nigri.elementId,'nigriSyncCard');
  assert.equal(nigri.className,'nigri-hidden');
  assert.match(html, /registry\.homepageTeacherTools/);
  assert.match(html, /renderTeacherHomepageTools\(\{role:"",classIds:\[\]\},true\)/,'the gated tile exists before the DOM-ready school check');
  assert.match(html, /\.teacher-tool-card\.nigri-hidden\{display:none!important\}/);
  assert.match(html, /B3SchoolScope\.checkNigri/);
  assert.match(html, /currentCard=document\.getElementById\("nigriSyncCard"\)/,'school authorization updates the current registry-rendered card');
});

test('gate fails closed: page content is hidden until the check passes', () => {
  const js = read('sync-to-nigri/nigri-school-gate.js');
  assert.match(js, /classList\.add\('ftt-nigri-locked'\)/);
  assert.match(js, /if \(result\.allowed\) unlock\(\);\s+else cover\(/);
  assert.match(js, /start\(\)\.catch\(/);
});

test('old password-locked pages that sync with the service account are owner-only', () => {
  for (const page of ['weekly-quiz/B3SchoolMarksBridge.html', 'weekly-quiz/chossid-lamdan.html']) {
    assert.match(read(page), /nigri-school-gate\.js\?v=\d+" data-owner-only="1"><\/script>/, page);
  }
  assert.match(read('sync-to-nigri/nigri-school-gate.js'), /if \(ownerOnly && result\.allowed && result\.reason !== 'owner'\)/);
});

const MARKS_PAGES = ['sync-to-nigri/school-marks.html', 'chossid-lamdan.html', 'sync-to-nigri/chossid-lamdan.html'];

test('School Marks pages show the Connect box and send through NigriConnect (owner path is the old fetch)', () => {
  for (const page of MARKS_PAGES) {
    const html = read(page);
    assert.match(html, /<div data-nigri-connect hidden><\/div>/, page);
    assert.match(html, /nigri-auth\.js"><\/script><script src="[^"]*nigri-connect\.js\?v=\d+"><\/script>/, page);
    // Helper missing: a teacher is stopped before anything is sent; the owner (or a page without the gate) keeps the old path.
    assert.match(html, /await \(window\.NigriConnect\?window\.NigriConnect\.cannotSync\(\):\(window\.B3NigriGate&&\(window\.B3NigriGate\.result\|\|\{\}\)\.reason!=='owner'\?'The Nigri sync helper did not load\. Refresh the page\.':null\)\)/, page);
    // The shared-key fetch appears only as the owner's path: handed to sendMarks, or used when the helper is missing.
    assert.match(html, /\(window\.NigriConnect\?\(await window\.NigriConnect\.sendMarks\(body,\(\)=>fetch\(SYNC_URL,\{[^\n]*?\)\)\)\.response:await fetch\(SYNC_URL,/, page);
    assert.equal((html.match(/fetch\(SYNC_URL,/g) || []).length, 2, page);
  }
  assert.match(read('sync-to-nigri/index.html'), /<h1>Sync to Nigri<\/h1>\s+<div data-nigri-connect hidden><\/div>/);
});

test('Weekly Quiz: Connect box in the modal; teachers send with their own login, owner path unchanged', () => {
  const js = read('weekly-quiz/nigri-sync.js');
  assert.match(js, /'<div data-nigri-connect hidden><\/div>'/);
  assert.match(js, /if \(window\.NigriConnect && \(await window\.NigriConnect\.ready\)\.role !== 'owner'\) \{\s+\/\/[^\n]*\n\s+res = \(await window\.NigriConnect\.sendMarks\(body\)\)\.response; via = 'teacher';\s+\} else if \(window\.NigriAuth\) \{/);
  assert.match(js, /: \(window\.B3NigriGate && \(window\.B3NigriGate\.result \|\| \{\}\)\.reason !== 'owner' \? 'The Nigri sync helper did not load\. Refresh the page\.' : null\);/);
  assert.match(read('weekly-quiz/teacher.html'), /nigri-auth\.js"><\/script><script src="\.\.\/sync-to-nigri\/nigri-connect\.js\?v=\d+"><\/script>/);
});

test('NigriConnect: teachers never send the shared key; password field is cleared and never stored', () => {
  const js = read('sync-to-nigri/nigri-connect.js');
  assert.ok(!/X-Sync-Key|SYNC_KEY/.test(js), 'connect helper must never use the old key');
  assert.match(js, /if \(state\.role === 'owner'\) return \{ response: await ownerSend\(\), via: 'owner' \};/);
  assert.match(js, /Authorization: 'Bearer ' \+ token \},\s+body: JSON\.stringify\(body\)/);
  assert.match(js, /pass\.value = '';/);
  assert.ok(!/localStorage|sessionStorage|console\.(log|info|debug)/.test(js), 'no browser storage or logging');
  assert.match(js, /if \(state\.role !== 'teacher'\) \{ host\.hidden = true;/);
});

test('Owner Admin: schools section, required school for new teachers and principals, owner-only move', () => {
  const html = read('owner-admin.html');
  assert.match(html, /<script src="school-scope\.js\?v=\d+"><\/script>/);
  for (const id of ['schoolsCard', 'schoolMove', 'schoolName', 'addSchool', 'schools']) assert.match(html, new RegExp('id="' + id + '"'));
  // The school is the one that is open (issue #722): the add forms have no school dropdown.
  for (const id of ['teacherSchool', 'principalSchool', 'classSchool']) assert.doesNotMatch(html, new RegExp('id="' + id + '"'));
  assert.match(html, /const schoolId=nav\.school;if\(!schoolData\[schoolId\]\)/);
  assert.match(html, /if\(!schoolData\[schoolId\]\)\{q\("status"\)\.textContent="Choose the teacher's school\.";return;\}/);
  assert.match(html, /updatedAt:firebase\.database\.ServerValue\.TIMESTAMP,schoolId:schoolId\}/);
  assert.match(html, /Choose the principal's school\./);
  assert.match(html, /Move them to another school first\./);
  // The school is stored on the invitation only; teachers/<uid> is rebuilt by the claim server.
  assert.ok(!/teachers\/"\+uid\+"\/schoolId/.test(html));
});
