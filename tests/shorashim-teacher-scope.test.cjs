'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const teacher=fs.readFileSync('shorashim/teacher.js','utf8');
const page=fs.readFileSync('shorashim/teacher.html','utf8');

test('Shorashim teacher loads its assigned roster once and keeps subscriptions narrow',()=>{
  assert.match(page,/teacher-class-rosters\.js/);
  assert.match(teacher,/const roster=await window\.B3TeacherClassRosters\.load\(\)/);
  assert.match(teacher,/scopedStudentIds=selected\.studentIds\|\|\[\]/);
  assert.match(teacher,/Object\.fromEntries\(scopedStudentIds\.map\(id=>\[id,db\.ref\(`\$\{ROOT\}\/students\/\$\{id\}`\)\]\)\)/);
  assert.match(teacher,/scopedStudentIds\.forEach\(id=>on\(`\$\{ROOT\}\/leaderboards\/match\/8\/\$\{id\}`/);
  assert.match(teacher,/function bindFullScopeListener\(\)\{[\s\S]*?if\(legacyScoped\(\)\)return Promise\.resolve\(\);[\s\S]*?if\(fullScopeListenerBound\)return fullScopeInitialPromise/);
  assert.doesNotMatch(teacher,/db\.ref\(SPACE\)\.on\('value'/);
  for(const key of ['catalog','settings','leaderboards'])assert.match(teacher,new RegExp(`observe\\('${key}'`));
  assert.match(teacher,/const studentsRef=db\.ref\(`\$\{SPACE\}\/students`\)/);
  assert.doesNotMatch(teacher,/db\.ref\(`\$\{SPACE\}\/students`\)\.once\('value'\)/);
  assert.match(teacher,/fullScopeRosterSync=window\.B3ShorashimTeacherRosterSync\.bindStudentEvents\(studentsRef,state,renderDashboard\)/);
  assert.match(teacher,/await bindFullScopeListener\(\)/);
  assert.match(teacher,/fullScopeRosterSync\?\.ready\(\)/);
  assert.match(teacher,/bindStudentValues\(studentRefs,state,renderDashboard\)/);
  assert.doesNotMatch(teacher,/db\.ref\(`\$\{ROOT\}\/students\/\$\{id\}`\)\.once\('value'\)/);
  assert.match(teacher,/if\(fullScopeReady\)render\(\)/);
  assert.match(page,/teacher-roster-sync\.js/);
  assert.match(teacher,/loadShorashimRecordings\(\);\s*fullScopeReady=true;/);
});

test('legacy Shorashim teacher saves class settings and only changed roster records',()=>{
  assert.match(teacher,/const teacherSettingsPath=\(\)=>legacyScoped\(\)\?`\$\{ROOT\}\/classes\/\$\{activeLegacyClassScope\}\/settings`/);
  assert.match(teacher,/changedStudentIds\.filter\(id=>scopedStudentIds\.includes\(id\)\)/);
  assert.match(teacher,/if\(legacyScoped\(\)\)\{[\s\S]*?bindLegacyScopedListeners/);
});

