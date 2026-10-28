'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=path=>fs.readFileSync(path,'utf8');

test('homepage signs student sessions into Firebase with the selected class token',()=>{
  const html=read('index.html');
  assert.match(html,/action:"login",name:r\.name,pin,classId:r\.classId/);
  assert.match(html,/signInWithCustomToken\(customToken\)/);
  assert.match(html,/setPersistence\(firebase\.auth\.Auth\.Persistence\.SESSION\)/);
  assert.match(html,/if\(actingStudent&&!isStudentPreview\)/);
});
test('Posuk Practice, Chazara, and Shorashim point requests send Firebase ID tokens',()=>{
  assert.match(read('record_pesukim/student.html'),/Authorization':'Bearer '\+idToken/);
  assert.match(read('chazara/index.html'),/Authorization':'Bearer '\+idToken/);
  assert.match(read('shorashim/app.js'),/Authorization':'Bearer '\+idToken/);
});
test('student auth returns tokens only after checking the selected class membership',()=>{
  const handler=read('backend/functions/student-auth.js');
  const loginBranch=handler.indexOf('if(result?.ok');
  assert.ok(handler.indexOf('if(!enrolled||!cls||cls.active===false',loginBranch)<handler.indexOf('createCustomToken(uid',loginBranch));
  assert.match(handler,/b3StudentId:studentId,b3ClassId:requestedClassId,b3StudentRole:'student'/);
});
test('the no-action rewards path requires a verified practice-student token before reading student state',()=>{
  const source=read('backend/functions/student-rewards-auto-award.js');
  const start=source.indexOf('const source=String(body.source||"").trim();',source.indexOf('exports.studentRewardsAutoAward'));
  const auth=source.indexOf('requirePracticeStudent(req,source)',start);
  const profileRead=source.indexOf('b3Games/students/${studentId}/profile',auth);
  assert.ok(start>=0&&auth>start&&profileRead>auth);
  assert.match(source,/body\.studentId&&String\(body\.studentId\)!==studentId/);
  assert.match(source,/function isMilestoneRequest\(item\)/);
  // Both pending-list paths must gate on pending status AND reviewable source.
  // Scoped path skips non-pending/unreviewable rows; owner path admits only both.
  assert.match(source,/if\(!studentRows\|\|item\.status!=='pending'\|\|!isReviewableRequest\(item\)\)continue;/);
  assert.match(source,/if\(item\.status\s*===\s*"pending"\s*&&\s*isReviewableRequest\(item\)\)/);
  assert.doesNotMatch(source,/awardMilestoneImmediately\(\{requestId,rewardStudentId,studentId,source,amount,reason,record\}\)/);
});
