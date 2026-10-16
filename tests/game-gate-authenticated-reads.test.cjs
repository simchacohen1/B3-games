'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('game-gate.js','utf8');

test('Firebase REST gate reads attach the active Firebase ID token',()=>{
  assert.match(source,/user\.getIdToken\(\)/);
  assert.match(source,/params\.set\("auth"/);
});

test('student gate resolves only the selected class fields and own member record',()=>{
  assert.match(source,/classPath\+"\/toolGrants\.json"/);
  assert.match(source,/classPath\+"\/members\/"\+encodeURIComponent\(studentId\)\+"\.json"/);
  assert.doesNotMatch(source,/classes\/"\+encodeURIComponent\(studentClassId\)\+"\.json/);
});

test('teacher gate resolves only the selected class access fields',()=>{
  assert.match(source,/teacherClassPath\+"\/toolGrants\.json"/);
  assert.doesNotMatch(source,/classes\/"\+encodeURIComponent\(selected\)\+"\.json/);
});
