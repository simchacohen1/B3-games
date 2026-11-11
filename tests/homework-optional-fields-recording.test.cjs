'use strict';
// #755: every Create Assignment field is optional (a blank name is auto-filled with the assignment type
// plus the Hebrew date), and every student homework always shows a microphone.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../assignment-center/homework-common.js');
const read = name => fs.readFileSync(path.join(__dirname, '..', 'assignment-center', name), 'utf8');
const noon = day => new Date(day + 'T12:00:00');

test('a blank assignment name becomes the type plus the Hebrew date, worked out from the date', () => {
  assert.strictEqual(H.autoTitle('Homework', noon('2026-11-09')), 'Homework, 29 Cheshvan');
  assert.strictEqual(H.autoTitle('Class Assignment', noon('2026-11-10')), 'Class Assignment, 30 Cheshvan');
  assert.strictEqual(H.hebrewDate(noon('2026-09-12')), '1 Tishrei');
  assert.strictEqual(H.hebrewDate(noon('2027-03-01')), '22 Adar I'); // 5787 is a leap year
  assert.strictEqual(H.hebrewDate(noon('2027-03-20')), '11 Adar II');
  assert.strictEqual(H.hebrewDate(noon('2027-04-22')), '15 Nissan');
});

test('Create Assignment: nothing is required and Next never blocks', () => {
  const page = read('teacher.html');
  assert.ok(page.includes("function continueToStudents(){say($('formMsg'),'');goCreateStep(2)}"));
  assert.ok(!/Add a short name|Please add a short assignment name|Add at least one item|Choose a start date/.test(page));
  assert.ok(!/<input[^>]*\srequired/.test(page));
  assert.ok(page.includes('title:titleValue()'));
});

test('student homework always shows the microphone, and the teacher review plays the recordings', () => {
  const student = read('student.html'), teacher = read('teacher.html');
  // Added before any status-based early return, and not behind an items or type check.
  const mic = student.indexOf("H.recordings({role:'student'"), firstReturn = student.indexOf("if(a.status==='approved'){");
  assert.ok(mic > 0 && mic < firstReturn);
  assert.strictEqual(teacher.split("H.recordings({role:'teacher'").length - 1, 2); // Check Assignments and the report notes row
});
