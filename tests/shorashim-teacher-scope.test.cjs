'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const teacher=fs.readFileSync('shorashim/teacher.js','utf8');
const page=fs.readFileSync('shorashim/teacher.html','utf8');

test('legacy Shorashim teacher loads only its assigned roster and students',()=>{
  assert.match(page,/teacher-class-rosters\.js/);
  assert.match(teacher,/const roster=await window\.B3TeacherClassRosters\.load\(\)/);
  assert.match(teacher,/scopedStudentIds=selected\.studentIds\|\|\[\]/);
  assert.match(teacher,/scopedStudentIds\.map\(id=>db\.ref\(`\$\{ROOT\}\/students\/\$\{id\}`\)/);
  assert.match(teacher,/scopedStudentIds\.map\(id=>db\.ref\(`\$\{ROOT\}\/leaderboards\/match\/8\/\$\{id\}`\)/);
  assert.match(teacher,/function bindFullScopeListener\(\)\{[\s\S]*?if\(legacyScoped\(\)\|\|fullScopeListenerBound\)return;[\s\S]*?studentsRef\.on\('child_added'/);
  assert.doesNotMatch(teacher,/db\.ref\(SPACE\)\.on\('value'/);
  for(const key of ['catalog','settings','leaderboards'])assert.ok(teacher.includes("on('"+key+"'"));
  assert.match(teacher,/const studentsRef=db\.ref\(\`\$\{SPACE\}\/students\`\)/);
  assert.match(teacher,/studentsRef\.on\('child_changed',updateStudent\)/);
  assert.match(teacher,/studentsRef\.on\('child_removed'/);
  assert.match(teacher,/Object\.prototype\.hasOwnProperty\.call\(state\.students,snap\.key\)/);
  assert.match(teacher,/loadShorashimRecordings\(\);\s*bindFullScopeListener\(\);/);
});

test('legacy Shorashim teacher saves class settings and only changed roster records',()=>{
  assert.match(teacher,/const teacherSettingsPath=\(\)=>legacyScoped\(\)\?`\$\{ROOT\}\/classes\/\$\{activeLegacyClassScope\}\/settings`/);
  assert.match(teacher,/changedStudentIds\.filter\(id=>scopedStudentIds\.includes\(id\)\)/);
  assert.match(teacher,/if\(legacyScoped\(\)\)\{[\s\S]*?bindLegacyScopedListeners/);
});
