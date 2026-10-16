'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const rules=JSON.parse(fs.readFileSync(__dirname+'/../firebase-rules.json','utf8')).rules;
const classPointerRule=rules.b3Games.workspaces['$workspaceId'].classes['$classId'].classPointerSessions['.write'];

test('Class Pointer session writes require an authenticated teacher assigned to the exact active class',()=>{
  assert.ok(classPointerRule.includes('auth != null'));
  assert.ok(classPointerRule.includes("teachers/' + auth.uid + '/active').val() == true"));
  assert.ok(classPointerRule.includes("classIds/' + $classId).val() == true"));
  assert.ok(classPointerRule.includes("classes/' + $classId + '/active').val() != false"));
  assert.ok(classPointerRule.includes("toolGrants/class-pointer').val() == true"));
  assert.ok(classPointerRule.includes("$classId == 'et' || $classId == 'wt'"));
  assert.ok(!classPointerRule.includes('classIds/*'));
  assert.ok(!classPointerRule.includes("'.write': true"));
});

test('the rule is nested under the class ID, preventing ET and WT cross-class writes',()=>{
  assert.ok(rules.b3Games.workspaces['$workspaceId'].classes['$classId'].classPointerSessions);
  const classRule=rules.b3Games.workspaces['$workspaceId'].classes['$classId']['.write'];
  assert.ok(!classRule.includes("teachers/' + auth.uid"));
});

test('session rules do not grant students access to write sharing sessions',()=>{
  assert.equal(rules.b3Games.students['$studentId'].classPointerSessions,undefined);
  assert.doesNotMatch(classPointerRule,/b3StudentId/);
});
