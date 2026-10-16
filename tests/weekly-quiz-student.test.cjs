'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {weeklyQuizStudentAction,safeLaunch,completedRecord}=require('../backend/functions/weekly-quiz-student-core.cjs');

const student={b3StudentRole:'student',b3StudentId:'student_a',b3ClassId:'alpha'};
function fixture(){
  const data={
    'b3Games/students/student_a/profile':{name:'Synthetic Student',classId:'alpha'},
    'b3Games/students/student_a/memberships':{alpha:{workspaceId:'b3-2026',classId:'alpha',active:true}},
    'b3Games/workspaces/b3-2026/classes/alpha':{active:true,toolGrants:{'weekly-quiz':true},members:{student_a:{active:true,toolAccess:{'weekly-quiz':true}}}},
    'b3Games/workspaces/b3-2026/classes/beta':{active:true,toolGrants:{'weekly-quiz':true},members:{student_b:{active:true}}},
    'b3Games/students/student_b/profile':{name:'Other Synthetic Student',classId:'beta'},
    'b3Games/students/student_b/memberships':{beta:{workspaceId:'b3-2026',classId:'beta',active:true}},
    'b3Quiz/classes/alpha/launches/quiz_1':{classId:'alpha',started:true,mode:'test',showScore:false,targetStudents:{student_a:true,student_b:true},quizSnapshot:{title:'Synthetic Quiz',questions:[{q:'Synthetic question?',choices:['No','Yes'],correctIndex:1}]}},
    'b3Quiz/classes/alpha/launches/quiz_2':{classId:'alpha',started:true,mode:'test',showScore:true,quizSnapshot:{title:'Released Quiz',questions:[{q:'Another synthetic question?',choices:['A','B'],correctIndex:0}]}},
    'b3Quiz/classes/beta/launches/quiz_other':{classId:'beta',started:true,mode:'test',quizSnapshot:{questions:[{q:'Private',choices:['A'],correctIndex:0}]}}
  };
  const pathParts=path=>path.split('/');
  const read=path=>{
    if(Object.prototype.hasOwnProperty.call(data,path))return structuredClone(data[path]);
    const ancestor=Object.keys(data).filter(key=>path.startsWith(key+'/')).sort((a,b)=>b.length-a.length)[0];
    if(ancestor){let value=structuredClone(data[ancestor]);for(const part of path.slice(ancestor.length+1).split('/'))value=value&&value[part];if(value!==undefined)return structuredClone(value);}
    const prefix=path+'/';const matching=Object.entries(data).filter(([key])=>key.startsWith(prefix));
    if(matching.length){const result={};for(const [key,value] of matching){const rest=key.slice(prefix.length).split('/');let node=result;while(rest.length>1){const part=rest.shift();node=node[part]||(node[part]={});}node[rest[0]]=structuredClone(value);}return result;}
    const parts=pathParts(path);let value=data;for(const part of parts)value=value&&value[part];return value===undefined?null:structuredClone(value);
  };
  const write=(path,value)=>{const parts=pathParts(path),key=parts.pop();let parent=data;for(const part of parts)parent=parent[part]||(parent[part]={});parent[key]=structuredClone(value);};
  const get=async path=>read(path);
  const set=async(path,value)=>write(path,value);
  const tx=async(path,update)=>{const current=read(path),next=update(current);if(next===undefined)return{committed:false,snapshot:{val:()=>current}};write(path,next);return{committed:true,snapshot:{val:()=>structuredClone(next)}};};
  return {data,get,set,tx};
}
const action=(fx,decoded,body,now=1700000000000)=>weeklyQuizStudentAction({...fx,decoded,body,now});

test('Weekly Quiz launch response strips answer keys and target roster until release',async()=>{
  const fx=fixture();
  fx.data['b3Quiz/classes/alpha/responses/quiz_1/student_a/0']={choiceIndex:1,correct:true,submittedAt:55};
  const result=await action(fx,student,{action:'launch',launchId:'quiz_1'});
  assert.equal(result.launch.quizSnapshot.questions[0].correctIndex,undefined);
  assert.equal(result.launch.targetStudents,undefined);
  assert.deepEqual(result.responses,{0:{choiceIndex:1,submittedAt:55}});
  const released=await action(fx,student,{action:'launch',launchId:'quiz_2'});
  assert.equal(released.launch.quizSnapshot.questions[0].correctIndex,0);
});

test('Weekly Quiz refuses wrong class, inactive membership, and non-student tokens',async()=>{
  const fx=fixture();
  await assert.rejects(action(fx,student,{action:'launch',launchId:'quiz_other'}),{status:403});
  await assert.rejects(action(fx,{...student,b3StudentRole:'teacher'},{action:'history'}),{status:401});
  fx.data['b3Games/workspaces/b3-2026/classes/alpha'].members.student_a.active=false;
  await assert.rejects(action(fx,student,{action:'launch',launchId:'quiz_1'}),{status:403});
});

test('answer correctness is computed on server and only one answer is accepted',async()=>{
  const fx=fixture();
  await action(fx,student,{action:'answer',launchId:'quiz_1',questionIndex:0,choiceIndex:0,correct:true});
  const saved=await fx.get('b3Quiz/classes/alpha/responses/quiz_1/student_a/0');
  assert.equal(saved.correct,false);
  assert.equal(saved.choiceIndex,0);
  await assert.rejects(action(fx,student,{action:'answer',launchId:'quiz_1',questionIndex:0,choiceIndex:1}),{status:409});
});

test('completion is server-scored, requires all answers, and hides unreleased score',async()=>{
  const fx=fixture();
  await assert.rejects(action(fx,student,{action:'complete',launchId:'quiz_1'}),{status:409});
  await action(fx,student,{action:'answer',launchId:'quiz_1',questionIndex:0,choiceIndex:1});
  const hidden=await action(fx,student,{action:'complete',launchId:'quiz_1'});
  assert.deepEqual(hidden.completion,{completedAt:1700000000000});
  assert.equal((await fx.get('b3Quiz/classes/alpha/completions/quiz_1/student_a')).correct,1);
  const history=await action(fx,student,{action:'history'});
  assert.deepEqual(history.completions.quiz_1,{completedAt:1700000000000});
  fx.data['b3Quiz/classes/alpha/launches/quiz_1'].showScore=true;
  const released=await action(fx,student,{action:'history'});
  assert.equal(released.completions.quiz_1.correct,1);
});

test('history includes only this student completion and assigned launches',async()=>{
  const fx=fixture();
  fx.data['b3Quiz/classes/alpha/completions']={quiz_1:{student_a:{completedAt:100,correct:0,total:1,pct:0},student_b:{completedAt:101,correct:1,total:1,pct:100}}};
  const result=await action(fx,student,{action:'history'});
  assert.deepEqual(Object.keys(result.launches),['quiz_1']);
  assert.deepEqual(Object.keys(result.completions),['quiz_1']);
  assert.equal(JSON.stringify(result).includes('student_b'),false);
});

test('revealing a paced question exposes only its answer and does not open submissions',async()=>{
  const fx=fixture();
  const launch=fx.data['b3Quiz/classes/alpha/launches/quiz_1'];launch.mode='paced';launch.questionStates={'0':{reveal:true}};
  const result=await action(fx,student,{action:'launch',launchId:'quiz_1'});
  assert.equal(result.launch.quizSnapshot.questions[0].correctIndex,1);
  await assert.rejects(action(fx,student,{action:'answer',launchId:'quiz_1',questionIndex:0,choiceIndex:1}),{status:409});
});

test('score helper counts only correct server response flags',()=>{
  assert.deepEqual(completedRecord({quizSnapshot:{questions:[{},{}]}},{0:{correct:true},1:{correct:false}},5),{completedAt:5,correct:1,total:2,pct:50,answered:2});
  assert.equal(safeLaunch('x',{quizSnapshot:{questions:[{correctIndex:4}]}}).quizSnapshot.questions[0].correctIndex,undefined);
});

test('Weekly Quiz browser page uses the authenticated API for launches, answers, history, and review',()=>{
  const html=fs.readFileSync('weekly-quiz/index.html','utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).filter(source=>source.trim());
  assert.ok(scripts.length);
  for(const source of scripts)new vm.Script(source);
  for(const actionName of ['launch','answer','history','review'])assert.ok(html.includes(`callStudentQuiz('${actionName}'`));
  assert.doesNotMatch(html,/db\.ref\(QROOT\+'\/(?:launches|responses|completions)/);
});
