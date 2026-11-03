'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const rules=JSON.parse(fs.readFileSync('firebase-rules.hardened.json','utf8')).rules;
const firebaseConfig=JSON.parse(fs.readFileSync('firebase.json','utf8'));
function publicGrants(node,path=''){
  const grants=[];
  for(const [key,value] of Object.entries(node||{})){
    if(key==='.read'||key==='.write'){
      if(value===true||typeof value==='string'&&value.trim()==='true')grants.push({path:path||'/',permission:key});
    }else if(value&&typeof value==='object')grants.push(...publicGrants(value,path+'/'+key));
  }
  return grants;
}

test('hardened candidate has no public writes or student-data read grants',()=>{
  const grants=publicGrants(rules);
  assert.deepEqual(grants.filter(x=>x.permission==='.write'),[]);
  assert.ok(!grants.some(x=>['/b3Games','/b3Games/students','/posukPractice','/posukPractice/attempts','/posukPractice/chazara','/studentRewards'].includes(x.path)&&x.permission==='.read'));
  assert.deepEqual(grants.filter(x=>x.permission==='.read').map(x=>x.path).sort(),[
    '/b3Games/siteSettings','/studentRewards/settings/studentWebsiteEnabled'
  ]);
});
// Production still runs firebase-rules.json. An ordinary deploy must not switch
// every rule at once; the hardened rules go out only through the explicit config.
test('default Firebase CLI configuration selects the live rules; hardened rules need the explicit config',()=>{
  assert.equal(firebaseConfig.database.rules,'firebase-rules.json');
  const securityDeploy=JSON.parse(fs.readFileSync('firebase.security-deploy.json','utf8'));
  assert.equal(securityDeploy.database.rules,'firebase-rules.hardened.json');
});
test('Class Pointer sessions are class-scoped and reject unlisted student permission data',()=>{
  const sessions=rules.b3Games.workspaces.$workspaceId.classes.$classId.classPointerSessions;
  assert.match(sessions['.read'],/b3StudentId != null/);
  assert.match(sessions['.read'],/b3ClassId == \$classId/);
  assert.match(sessions['.write'],/classIds\/' \+ \$classId/);
  assert.equal(sessions.$roomId.$other['.validate'],false);
  assert.equal(sessions.$roomId.screenSharingDenied,undefined);
  assert.equal(sessions.$roomId.whiteboardDenied,undefined);
});
test('student work rules bind access to the signed student ID',()=>{
  assert.match(rules.posukPractice.attempts.$studentId['.write'],/auth\.token\.b3StudentId == \$studentId/);
  assert.match(rules.posukPractice.chazara.events.$studentId['.write'],/auth\.token\.b3StudentId == \$studentId/);
  assert.match(rules.posukPractice.students.$studentId['.write'],/auth\.token\.b3StudentId == \$studentId/);
});
test('class access requires a matching class token or assigned teacher record',()=>{
  const expression=rules.b3Games.workspaces.$workspaceId.classes.$classId.members.$studentId['.read'];
  assert.match(expression,/auth\.token\.b3ClassId == \$classId/);
  assert.match(expression,/teachers\/' \+ auth\.uid/);
  assert.match(expression,/classIds\/' \+ \$classId/);
});
test('Shorashim legacy teacher reads follow the student profile class and active assignment',()=>{
  const shorashim=rules.posukPractice.shorashimLearning;
  for(const path of ['students','recordingEvents','recordings']){
    const expression=shorashim[path].$studentId['.read'];
    assert.ok(expression.includes("teachers/' + auth.uid + '/active"));
    assert.ok(expression.includes("students/' + $studentId + '/profile/classId"));
    assert.ok(expression.includes("classIds/' + root.child('b3Games/students/' + $studentId"));
    assert.doesNotMatch(expression,/auth\.token\.b3ClassId/);
  }
  assert.ok(shorashim.leaderboards.match.$pairCount.$studentId['.read']);
});
