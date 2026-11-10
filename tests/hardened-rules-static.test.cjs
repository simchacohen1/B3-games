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
// Owner Admin, the owner's class pickers and teacher preview list whole collections.
// A rule on one record does not allow listing its parent, so the owner needs these.
test('owner and active admins can list the collections Owner Admin needs; nobody else can',()=>{
  const OWNER_OR_ADMIN="auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true)";
  const ws=rules.b3Games.workspaces.$workspaceId;
  assert.equal(rules.b3Games.students['.read'],OWNER_OR_ADMIN);
  for(const list of ['classes','teachers','schools','students','contentGrants','meta','siteSettings'])assert.equal(ws[list]['.read'],OWNER_OR_ADMIN,list+' list');
  for(const list of ['schools','students','contentGrants','meta','siteSettings'])assert.equal(ws[list]['.write'],OWNER_OR_ADMIN,list+' write');
  // Listing must not open writes that were owner-only, or the whole workspace.
  assert.equal(ws['.read'],undefined);assert.equal(ws['.write'],undefined);
  assert.equal(ws.classes['.write'],undefined);assert.equal(ws.teachers['.write'],undefined);assert.equal(rules.b3Games.students['.write'],undefined);
  assert.doesNotMatch(ws.teachers.$uid['.write'],/admins/,'only the owner writes teacher records');
});
test('a teacher can read one school record (name and Nigri flag) but cannot list or change schools',()=>{
  const schools=rules.b3Games.workspaces.$workspaceId.schools;
  assert.match(schools.$schoolId['.read'],/teachers\/' \+ auth\.uid \+ '\/active'\)\.val\(\) == true/);
  assert.doesNotMatch(schools['.read'],/teachers\//);
  assert.equal(schools.$schoolId['.write'],undefined);
});
test('staging rules are the hardened rules with only the owner email swapped',()=>{
  const staging=fs.readFileSync('staging/database.rules.json','utf8').replaceAll('owner@funtorahtools-staging.test','simcha5770@gmail.com');
  assert.deepEqual(JSON.parse(staging).rules,rules);
});
