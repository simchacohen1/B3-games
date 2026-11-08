'use strict';
// Guards: every Nigri page is behind the school check, and Owner Admin manages schools.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const GATED_PAGES = [
  'sync-to-nigri/index.html', 'sync-to-nigri/school-marks.html', 'sync-to-nigri/chossid-lamdan.html',
  'sync-to-nigri/classtime.html', 'chossid-lamdan.html', 'weekly-quiz/chossid-lamdan.html',
  'weekly-quiz/B3SchoolMarksBridge.html'
];

test('every standalone Nigri page loads the school gate before its own scripts run', () => {
  for (const page of GATED_PAGES) {
    const html = read(page);
    const gate = html.search(/<script src="[^"]*sync-to-nigri\/nigri-school-gate\.js[^"]*"><\/script>/);
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
  assert.match(html, /<a class="teacher-tool-card nigri-hidden" href="sync-to-nigri\/index\.html" id="nigriSyncCard">/);
  assert.match(html, /\.teacher-tool-card\.nigri-hidden\{display:none!important\}/);
  assert.match(html, /B3SchoolScope\.checkNigri/);
});

test('gate fails closed: page content is hidden until the check passes', () => {
  const js = read('sync-to-nigri/nigri-school-gate.js');
  assert.match(js, /classList\.add\('ftt-nigri-locked'\)/);
  assert.match(js, /if \(result\.allowed\) unlock\(\); else cover\(/);
  assert.match(js, /start\(\)\.catch\(/);
});

test('Owner Admin: schools section, required school for new teachers and principals, owner-only move', () => {
  const html = read('owner-admin.html');
  assert.match(html, /<script src="school-scope\.js\?v=\d+"><\/script>/);
  for (const id of ['schoolsCard', 'schoolMove', 'schoolName', 'addSchool', 'schools', 'teacherSchool', 'principalSchool']) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /if\(!schoolData\[schoolId\]\)\{q\("status"\)\.textContent="Choose the teacher's school\.";return;\}/);
  assert.match(html, /updatedAt:firebase\.database\.ServerValue\.TIMESTAMP,schoolId:schoolId\}/);
  assert.match(html, /Choose the principal's school\./);
  assert.match(html, /Move them to another school first\./);
  // The school is stored on the invitation only; teachers/<uid> is rebuilt by the claim server.
  assert.ok(!/teachers\/"\+uid\+"\/schoolId/.test(html));
});
