'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const rules=JSON.parse(fs.readFileSync('firebase-rules.hardened.json','utf8')).rules;
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
