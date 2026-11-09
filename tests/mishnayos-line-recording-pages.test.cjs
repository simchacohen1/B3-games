'use strict';
// Issue #692: Mishnayos Practice records one line at a time and sends work to
// the teacher only on Submit; the comprehension step lives in Mishnayos חידון (test-me.html).
// These checks keep the pages wired the way the redesign needs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const student = read('record-mishnayos/student.html');
const testMe = read('record-mishnayos/test-me.html');
const recorder = read('record-mishnayos/line-recorder.js');
const grade = read('record-mishnayos/grade.html');
const index = read('index.html');

test('Mishnayos Practice shows one record button per line and a single Submit', () => {
  assert.match(student, /<script src="line-recorder\.js\?v=[^"]+"><\/script>/);
  assert.match(student, /id="lineRecorder"/);
  assert.match(student, /id="submitMishnaBtn"/);
  assert.match(student, /window\.MishnayosLines\.open\(perekNum, sectionInfo\(perekNum, posukNum\)\)/);
  assert.match(recorder, /class="line-rec"/);
  assert.match(recorder, /action:'submit'/);
  assert.match(recorder, /mishnayosSubmissions/);
});

test('the whole mishna is one step, so every one of its lines is on the page', () => {
  assert.match(student, /\[\[0, m\.lines\.length\]\]\.forEach\(/);
  assert.doesNotMatch(student, /\(m\.sections \|\| \[\[0, m\.lines\.length\]\]\)\.forEach/);
});

test('the comprehension step is gone from Mishnayos Practice and lives in Mishnayos חידון (test-me.html)', () => {
  const legacy = student.slice(student.indexOf('<div id="legacyTasks"'), student.indexOf('<!-- /legacyTasks -->'));
  assert.match(student, /<div id="legacyTasks" style="display:none" aria-hidden="true">/);
  assert.ok(legacy.includes('id="comprehensionPanel"'), 'the old Understand step is inside the hidden block');
  assert.match(student, /p\.get\('mode'\) === 'quiz' \|\| p\.get\('tab'\) === 'comprehension'/);
  assert.match(student, /location\.replace\('test-me\.html'/);
  assert.match(testMe, /<title>Mishnayos חידון<\/title>/);
  assert.match(testMe, /const TEST_ME_ONLY = true;/);
  assert.match(testMe, /if\(TEST_ME_ONLY\) tab = 'comprehension';/);
  assert.match(testMe, /<div class="task-tabs hidden" aria-hidden="true">/);
  assert.match(index, /href="record-mishnayos\/test-me\.html"><span class="card-icon">🧠<\/span><span class="card-title">Mishnayos חידון<\/span>/);
  assert.match(index, /data-companion-of="posuk-practice-scroll" href="record-mishnayos\/test-me\.html"/);
});

test('the practice page no longer wakes the paid grading services', () => {
  const perekChange = student.slice(student.indexOf('perekSelect.onchange = async'), student.indexOf('async function loadSelectedPesukim'));
  const load = student.slice(student.indexOf('async function loadSelectedPesukim'), student.indexOf('posukSelect.onchange = async'));
  for(const part of [perekChange, load]){
    assert.doesNotMatch(part, /warmTranslationServices\(\)|warmQuestionGradingService\(\)|wakeScorer\(\)/);
  }
});

test('the text box spans the page and each line keeps to one row', () => {
  assert.match(student, /body\.lines-mode \.wrap\{ max-width:1240px; \}/);
  assert.match(student, /\.line-row \.line-text\{[^}]*white-space:nowrap/);
  assert.match(recorder, /function fitLines\(\)/);
});

test('draft recordings go where the database and storage rules allow', () => {
  const rules = JSON.parse(read('firebase-rules.json')).rules.posukPractice.mishnayos.drafts.$studentId.$mishnaKey;
  assert.match(rules.lines.$line.path['.validate'], /beginsWith\('posukPractice\/' \+ \$studentId \+ '\/mishnayosDrafts\/' \+ \$mishnaKey \+ '\/'\)/);
  assert.match(recorder, /'posukPractice\/' \+ studentId \+ '\/mishnayosDrafts\/' \+ key \+ '\/line'/);
  assert.match(recorder, /ROOT \+ '\/drafts\/' \+ studentId \+ '\/' \+ key/);
  assert.match(read('storage-rules.hardened.rules'), /match \/posukPractice\/\{studentId\}\/\{file=\*\*\}/);
});

test('teachers grade from their own page and the dashboard links to it', () => {
  assert.match(grade, /action:'teacher-list'/);
  assert.match(grade, /action:'teacher-grade'/);
  assert.match(grade, /B3PrivateMedia\.url\(path\)/);
  assert.match(read('record-mishnayos/teacher.html'), /href="grade\.html"/);
  assert.match(index, /href="record-mishnayos\/grade\.html"/);
});
