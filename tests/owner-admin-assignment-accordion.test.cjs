'use strict';
// Owner Admin "Who has what" (#704): one teacher open at a time, class
// checkboxes reuse the existing Assign and unassign writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'owner-admin.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

test('owner admin inline scripts still parse', () => {
  for (const s of scripts) assert.doesNotThrow(() => new Function(s));
});

test('Who has what renders one collapsible row per teacher with a class summary', () => {
  assert.match(html, /function renderAssignments\(\)/);
  assert.match(html, /load\(\)[\s\S]*renderAssignments\(\);/);
  assert.match(html, /data-acc-toggle=/);
  assert.match(html, /aria-expanded=/);
  assert.match(html, /' class: ':' classes: '/);
  assert.match(html, /'No classes yet'/);
});

test('only one teacher is open, and it survives the re-render after a save', () => {
  assert.match(html, /let openAssignTeacher="";/);
  assert.match(html, /openAssignTeacher=openAssignTeacher===head\.dataset\.accToggle\?"":head\.dataset\.accToggle/);
  assert.match(html, /const tid=box\.dataset\.assignTeacher,cid=box\.value;openAssignTeacher=tid;/);
  assert.match(html, /open=tid===openAssignTeacher/);
});

test('ticking uses the Assign button writes; unticking uses unassign and its confirm', () => {
  assert.match(html, /q\("assign"\)\.onclick=[^\n]*await assignClass\(t,c\)\};/);
  assert.match(html, /async function assignClass\(t,c\)\{[^\n]*\/teacherInvites\/"\+t\+"\/classIds\/"\+c\]:true/);
  assert.match(html, /if\(box\.checked\)await assignClass\(tid,cid\);/);
  assert.match(html, /else if\(await unassign\(tid,cid\)===false\)\{box\.checked=true;/);
  assert.match(html, /away from "\+\(t\.name\|\|t\.email\)\+"\?"\)\)return false;/);
});
