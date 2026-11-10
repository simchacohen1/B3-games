'use strict';
// Grade themes (#737): grade from the class name, band defaults, saved choice per grade.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../grade-themes.js');
const repo = path.resolve(__dirname, '..');

test('the grade is the number after B in the class name', () => {
  assert.equal(T.gradeFromName('B4 ET 1 · Morning'), 4);
  assert.equal(T.gradeFromName('B6 WT 2 · Afternoon'), 6);
  assert.equal(T.gradeFromName(' b8 ET'), 8);
  for (const name of ['ET', 'WT', 'B3 ET · Morning', 'B9 ET', 'B45 ET', 'Class B4', '', null, undefined]) {
    assert.equal(T.gradeFromName(name), null, String(name));
  }
});

test('three bands with 3 to 4 themes each, and a default inside its own band', () => {
  assert.deepEqual(T.BANDS.map(b => b.grades), [[4, 5], [6, 7], [8]]);
  for (const band of T.BANDS) {
    const themes = T.THEMES.filter(t => t.band === band.id);
    assert.ok(themes.length >= 3 && themes.length <= 4, band.id);
    assert.ok(themes.some(t => t.id === band.defaultTheme), band.id);
  }
  assert.equal(new Set(T.THEMES.map(t => t.id)).size, T.THEMES.length);
});

test('a class uses its grade\'s saved theme, else the band default', () => {
  assert.equal(T.themeForClassName('B4 ET 1 · Morning', {}), 'g45-sunny');
  assert.equal(T.themeForClassName('B5 WT 1 · Morning', { 5: 'g45-ocean' }), 'g45-ocean');
  assert.equal(T.themeForClassName('B4 ET 1 · Morning', { 5: 'g45-ocean' }), 'g45-sunny'); // saved per grade, not per band
  assert.equal(T.themeForClassName('B7 ET 1 · Morning', null), 'g67-slate');
  assert.equal(T.themeForClassName('B8 ET 1 · Morning', { 8: 'g8-midnight' }), 'g8-midnight');
  assert.equal(T.themeForClassName('ET', { 4: 'g45-candy' }), null); // no grade: normal look
});

test('a saved value from another band or an unknown id falls back to the default', () => {
  assert.equal(T.themeForGrade(8, { 8: 'g45-candy' }), 'g8-ink');
  assert.equal(T.themeForGrade(6, { 6: 'nonsense' }), 'g67-slate');
  assert.equal(T.themeForGrade(3, {}), null);
});

test('every theme has its variables in the stylesheet and passes the database rule', () => {
  const css = fs.readFileSync(path.join(repo, 'grade-themes.css'), 'utf8');
  const rules = JSON.parse(fs.readFileSync(path.join(repo, 'firebase-rules.json'), 'utf8')).rules;
  const rule = rules.b3Games.workspaces.$workspaceId.gradeThemes.$grade;
  const idPattern = new RegExp(/newData\.val\(\)\.matches\(\/(.+?)\/\)/.exec(rule['.validate'])[1]);
  for (const theme of T.THEMES) {
    assert.ok(css.includes('.ftt-theme-' + theme.id + ' {\n  --ftt-bg:') || css.includes('.ftt-theme-' + theme.id + ' {\r\n  --ftt-bg:'), theme.id + ' variables');
    assert.match(theme.id, idPattern);
  }
  assert.match(rule['.write'], /teachers\/' \+ auth\.uid \+ '\/active'\)\.val\(\) == true/);
});

test('both home pages load the theme files and apply a theme when a class is chosen', () => {
  const home = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const teacher = fs.readFileSync(path.join(repo, 'teacher-home.html'), 'utf8');
  for (const page of [home, teacher]) {
    assert.match(page, /grade-themes\.css/);
    assert.match(page, /grade-themes\.js/);
  }
  assert.match(home, /FTTGradeThemes\?\.useClass\(className\)/);
  assert.match(home, /id="gradeThemeCard"/);
  assert.match(teacher, /data-ftt-theme-picker/);
  assert.match(teacher, /FTTGradeThemes\.decorate\(q\("classes"\)\)/);
});
