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

test('per-student permission rows remain unreadable in Firebase and are served by the authenticated endpoint',()=>{
  const permissions=rules.b3Private.classPointerSharePermissions['$workspaceId']['$classId']['$roomId'];
  assert.ok(permissions['.write'].includes("teachers/' + auth.uid + '/active').val() == true"));
  assert.equal(permissions['.read'],undefined);
  assert.equal(permissions['$studentId'],undefined);
  const endpoint=fs.readFileSync(__dirname+'/../backend/functions/class-pointer-share-auth.js','utf8');
  assert.match(endpoint,/action==='permissions'/);
  assert.match(endpoint,/equal\(code\.passcode,body\.pin\)/);
  assert.match(endpoint,/classPointerSharePermissions\/[^\n]+studentId/);
  // TEMPORARY compatibility: the live site still writes denials to the public session record; every read must be OR'd with the private policy.\n  for (const line of endpoint.split(/\\r?\\n/).filter(l => /session\\.(screenSharingDenied|whiteboardDenied)/.test(l))) assert.match(line, /permission\\??\\.(screenSharing|whiteboard)Denied===true\\|\\|/);
});
