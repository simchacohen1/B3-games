'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const lesson=fs.readFileSync('halacha/seif-a-teacher-led.js','utf8');
const art=fs.readFileSync('halacha/illustrated-seif-a.js','utf8');
const lessonCss=fs.readFileSync('halacha/seif-a-teacher-led.css','utf8');
const artCss=fs.readFileSync('halacha/illustrated-seif-a.css','utf8');
const index=fs.readFileSync('halacha/index.html','utf8');

test('complete original Kitzur is preserved, closed by default and opens when student clicks',()=>{
  new vm.Script(lesson);
  assert.match(lesson,/reading\.open = false;/);
  assert.match(lesson,/Read full Kitzur text|Full Kitzur text/);
  assert.match(lesson,/שִׁוִיתִי/);
  assert.match(lesson,/וְיֵבוֹשׁ/);
  assert.match(lesson,/reading\.append\(readingTitle, fullText\)/);
  assert.doesNotMatch(lesson,/reading\.open = true/);
});
test('lesson is compact and provides picture and scrapbook jump controls',()=>{
  assert.match(lesson,/hal-a-jumps/);
  assert.match(lesson,/scrollIntoView/);
  assert.match(lesson,/hal-a-quiz-details/);
  assert.match(lesson,/make\('details', 'hal-a-prompts'\)/);
  assert.match(lessonCss,/position:sticky/);
  assert.match(lessonCss,/hal-a-heading h2/);
});
test('important Hebrew phrases and everyday captions can be used as scrapbook text',()=>{
  assert.match(lesson,/addScrapbookText\(phrase\.he, true\)/);
  assert.match(lesson,/contenteditable="true"/);
  assert.match(lesson,/window\.persist\(ROOT_ID\)/);
  assert.match(art,/addWords\(item\.caption\)/);
  assert.match(art,/addPicture\(SCENE_BASE \+ item\.file/);
  assert.match(art,/window\.persist\('a'\)/);
  assert.match(art,/isReadonly\(\)/);
});
test('new image, script and styles have fresh versions and all gallery actions are keyboard controls',()=>{
  new vm.Script(art);
  assert.match(index,/illustrated-seif-a\.js\?v=20261019-chabad1/);
  assert.match(index,/illustrated-seif-a\.css\?v=20261019-compact1/);
  assert.match(index,/seif-a-teacher-led\.js\?v=20261019-compact1/);
  assert.match(lesson,/seif-a-teacher-led\.css\?v=20261019-compact1/);
  assert.match(art,/20261019-chabad1/);
  assert.match(art,/useImage\.type = 'button'/);
  assert.match(art,/useWords\.type = 'button'/);
  assert.match(artCss,/hal-story-actions/);
});
