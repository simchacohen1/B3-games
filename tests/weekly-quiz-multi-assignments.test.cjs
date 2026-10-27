'use strict';
// Issue #376: several individual Weekly Quiz assignments (retakes, make-ups,
// take-anytime) can be open for one student at the same time. Synthetic data only.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {weeklyQuizStudentAction}=require('../backend/functions/weekly-quiz-student-core.cjs');
const WQA=require('../weekly-quiz/quiz-assignments.js');

const ROOT='b3Quiz/classes/alpha';
const ari={b3StudentRole:'student',b3StudentId:'ari',b3ClassId:'alpha'};
const bina={b3StudentRole:'student',b3StudentId:'bina',b3ClassId:'alpha'};
const dov={b3StudentRole:'student',b3StudentId:'dov',b3ClassId:'beta'};
const quiz=(title,n=2)=>({title,questions:Array.from({length:n},(_,i)=>({q:title+' question '+(i+1),choices:['Wrong','Right'],correctIndex:1}))});

function store(){
  const tree={};
  const parts=path=>path.split('/').filter(Boolean);
  const read=path=>{let node=tree;for(const part of parts(path)){if(node==null||typeof node!=='object')return null;node=node[part];}return node===undefined?null:structuredClone(node);};
  const write=(path,value)=>{
    const p=parts(path),last=p.pop();let node=tree;
    for(const part of p){if(!node[part]||typeof node[part]!=='object')node[part]={};node=node[part];}
    if(value===null||value===undefined)delete node[last];else node[last]=structuredClone(value);
  };
  return {
    tree,read,write,
    get:async path=>read(path),
    set:async(path,value)=>write(path,value),
    update:updates=>Object.entries(updates).forEach(([path,value])=>write(path,value)),
    tx:async(path,update)=>{const current=read(path),next=update(current);if(next===undefined)return {committed:false};write(path,next);return {committed:true};}
  };
}
function classroom(){
  const db=store();
  for(const [id,classId] of [['ari','alpha'],['bina','alpha'],['dov','beta']]){
    db.write(`b3Games/students/${id}/profile`,{name:'Synthetic '+id,classId});
    db.write(`b3Games/students/${id}/memberships/m`,{workspaceId:'b3-2026',classId,active:true});
  }
  db.write('b3Games/workspaces/b3-2026/classes/alpha',{active:true,toolGrants:{'weekly-quiz':true},members:{ari:{active:true},bina:{active:true}}});
  db.write('b3Games/workspaces/b3-2026/classes/beta',{active:true,toolGrants:{'weekly-quiz':true},members:{dov:{active:true}}});
  // Three different original class quizzes, all already finished by Ari with low scores.
  ['A','B','C'].forEach((name,i)=>{
    db.write(`${ROOT}/launches/orig_${name}`,{classId:'alpha',started:false,endedAt:10+i,showScore:true,mode:'test',createdAt:i+1,attemptGroupId:`orig_${name}`,attemptNumber:1,quizSnapshot:quiz('Quiz '+name)});
    db.write(`${ROOT}/completions/orig_${name}/ari`,{completedAt:20+i,correct:0,total:2,pct:0});
  });
  return db;
}
// Same shape launchRetake() in weekly-quiz/teacher.html writes.
function teacherRetake(db,baseId,studentId,attempt,at){
  const base=db.read(`${ROOT}/launches/${baseId}`),id=`${at}_retake_${studentId}_${baseId}`;
  db.write(`${ROOT}/launches/${id}`,{quizId:'',quizSnapshot:base.quizSnapshot,classId:base.classId,targetStudents:{[studentId]:true},createdAt:at,started:true,startedAt:at,mode:'test',deliveryType:'anytime',showScore:true,activeQuestion:0,questionStates:{},attemptGroupId:base.attemptGroupId||baseId,attemptNumber:attempt,retakeOf:baseId,note:'Student retake'});
  db.update(WQA.assignUpdates(ROOT,[studentId],id,{kind:'retake',classId:base.classId,assignedAt:at}));
  return id;
}
const call=(db,who,body,now=1000)=>weeklyQuizStudentAction({get:db.get,set:db.set,tx:db.tx,decoded:who,body,now});
async function finish(db,who,launchId,choice=1){
  const {launch}=await call(db,who,{action:'launch',launchId});
  for(let i=0;i<launch.quizSnapshot.questions.length;i++)await call(db,who,{action:'answer',launchId,questionIndex:i,choiceIndex:choice});
  return call(db,who,{action:'complete',launchId});
}

test('1. retakes A, B and C for one student are all listed and all takeable',async()=>{
  const db=classroom();
  const ids=['A','B','C'].map((n,i)=>teacherRetake(db,'orig_'+n,'ari',2,100+i));
  // The old single pointer only remembers the newest one; the queue keeps all three.
  assert.equal(db.read(`${ROOT}/settings/studentActiveLaunch/ari`),ids[2]);
  const {assignments}=await call(db,ari,{action:'assignments'});
  assert.deepEqual(assignments.map(a=>a.id).sort(),[...ids].sort());
  assert.ok(assignments.every(a=>a.status==='not-started'&&a.launch.started===true));
  assert.equal(JSON.stringify(assignments).includes('targetStudents'),false);
  for(const id of ids)await call(db,ari,{action:'answer',launchId:id,questionIndex:0,choiceIndex:1});
  const after=await call(db,ari,{action:'assignments'});
  assert.ok(after.assignments.every(a=>a.status==='in-progress'&&a.answered===1));
});

test('2. finishing B keeps A and C open and keeps every old score',async()=>{
  const db=classroom();
  const [a,b,c]=['A','B','C'].map((n,i)=>teacherRetake(db,'orig_'+n,'ari',2,100+i));
  const done=await finish(db,ari,b);
  assert.equal(done.completion.pct,100);
  const {assignments}=await call(db,ari,{action:'assignments'});
  const status=Object.fromEntries(assignments.map(x=>[x.id,x.status]));
  assert.deepEqual(status,{[a]:'not-started',[b]:'completed',[c]:'not-started'});
  const history=await call(db,ari,{action:'history'});
  assert.equal(history.completions[b].pct,100);
  for(const n of ['A','B','C'])assert.equal(history.completions['orig_'+n].pct,0,'original attempt '+n+' is preserved');
  assert.equal(history.launches[b].retakeOf,'orig_B');
  // Completion is tied to B's exact launch, not to the newest pointer (C).
  assert.equal(db.read(`${ROOT}/completions/${c}/ari`),null);
  await assert.rejects(call(db,ari,{action:'answer',launchId:b,questionIndex:0,choiceIndex:0}),{status:409});
});

test('3. a retake chain counts attempts and shows the newest completed score',async()=>{
  const db=classroom();
  const r2=teacherRetake(db,'orig_A','ari',2,100);
  await finish(db,ari,r2,0);
  const r3=teacherRetake(db,'orig_A','ari',3,200);
  await finish(db,ari,r3,1);
  const html=fs.readFileSync('weekly-quiz/teacher.html','utf8');
  const source=['studentAttemptChain','studentDisplayAttempt'].map(name=>html.match(new RegExp('function '+name+'\\([\\s\\S]*?\\n}'))[0]).join('\n');
  const ctx={WeeklyQuizAssignments:WQA,allLaunches:db.read(`${ROOT}/launches`),completions:db.read(`${ROOT}/completions`)};
  vm.runInNewContext(source+';this.display=studentDisplayAttempt("orig_A","ari");',ctx);
  assert.equal(ctx.display.id,r3);
  assert.equal(ctx.display.attempt,3);
  assert.equal(db.read(`${ROOT}/completions/${r2}/ari`).pct,0);
  assert.equal(db.read(`${ROOT}/completions/${r3}/ari`).pct,100);
  // A fourth, revoked retake is not shown as "assigned, not completed".
  const r4=teacherRetake(db,'orig_A','ari',4,300);
  db.update(WQA.revokeUpdates(ROOT,r4,'ari',db.read(`${ROOT}/settings/studentActiveLaunch/ari`),301));
  ctx.allLaunches=db.read(`${ROOT}/launches`);
  vm.runInNewContext('this.display=studentDisplayAttempt("orig_A","ari");',ctx);
  assert.equal(ctx.display.pendingNewer.length,0);
});

test('4. other students cannot list, open, answer or review a boy\'s retakes; other classes are refused',async()=>{
  const db=classroom();
  const id=teacherRetake(db,'orig_A','ari',2,100);
  // Bina's list never contains Ari's retake, even if a stray entry is written under her name.
  db.write(`${ROOT}/settings/studentAssignments/bina/${id}`,{assignedAt:5});
  assert.deepEqual((await call(db,bina,{action:'assignments'})).assignments,[]);
  await assert.rejects(call(db,bina,{action:'launch',launchId:id}),{status:403});
  await assert.rejects(call(db,bina,{action:'answer',launchId:id,questionIndex:0,choiceIndex:1}),{status:403});
  await finish(db,ari,id);
  await assert.rejects(call(db,bina,{action:'review',launchId:id}),{status:403});
  // A student from another class reads only his own class space.
  assert.deepEqual((await call(db,dov,{action:'assignments'})).assignments,[]);
  await assert.rejects(call(db,dov,{action:'launch',launchId:id}),{status:403});
  await assert.rejects(call(db,{...ari,b3ClassId:'beta'},{action:'assignments'}),{status:403});
  await assert.rejects(call(db,{...ari,b3StudentRole:'teacher'},{action:'assignments'}),{status:401});
});

test('5. a live class quiz and several individual assignments coexist',async()=>{
  const db=classroom();
  db.write(`${ROOT}/launches/live_1`,{classId:'alpha',started:true,mode:'paced',activeQuestion:0,questionStates:{0:{open:true}},createdAt:500,quizSnapshot:quiz('Live')});
  db.write(`${ROOT}/settings/activeLaunchByClass/alpha`,'live_1');
  await call(db,ari,{action:'answer',launchId:'live_1',questionIndex:0,choiceIndex:1});
  const r1=teacherRetake(db,'orig_A','ari',2,600),r2=teacherRetake(db,'orig_B','ari',2,601);
  const {assignments}=await call(db,ari,{action:'assignments'});
  const bySource=Object.fromEntries(assignments.map(a=>[a.id,a.source]));
  assert.deepEqual(bySource,{[r1]:'assigned',[r2]:'assigned',live_1:'class'});
  assert.equal(assignments.find(a=>a.id==='live_1').status,'in-progress');
  // His live-quiz answer is still there after the retakes were assigned.
  assert.equal(db.read(`${ROOT}/responses/live_1/ari/0`).choiceIndex,1);
  assert.equal((await call(db,bina,{action:'assignments'})).assignments.map(a=>a.id).join(),'live_1');
});

test('6. revoked assignment, ended launch, stale entries and the legacy single pointer',async()=>{
  const db=classroom();
  // Legacy: an old assignment that only exists as the single pointer still shows.
  db.write(`${ROOT}/launches/old_makeup`,{classId:'alpha',started:true,mode:'test',deliveryType:'makeup',targetStudents:{ari:true},createdAt:50,quizSnapshot:quiz('Old make-up')});
  db.write(`${ROOT}/settings/studentActiveLaunch/ari`,'old_makeup');
  let list=(await call(db,ari,{action:'assignments'})).assignments;
  assert.deepEqual(list.map(a=>[a.id,a.source]),[['old_makeup','legacy']]);
  const a=teacherRetake(db,'orig_A','ari',2,100),b=teacherRetake(db,'orig_B','ari',2,101);
  list=(await call(db,ari,{action:'assignments'})).assignments;
  // The legacy pointer moved to the newest retake, but the old make-up is not in the queue: it is no longer listed,
  // exactly as before this change. Everything in the queue is.
  assert.deepEqual(list.map(x=>x.id).sort(),[a,b].sort());
  // Revoke A after he answered one question: his answer stays, he can no longer open it.
  await call(db,ari,{action:'answer',launchId:a,questionIndex:0,choiceIndex:1});
  db.update(WQA.revokeUpdates(ROOT,a,'ari',db.read(`${ROOT}/settings/studentActiveLaunch/ari`),150));
  assert.equal(db.read(`${ROOT}/responses/${a}/ari/0`).choiceIndex,1);
  assert.equal(db.read(`${ROOT}/settings/studentAssignments/ari/${a}`),null);
  assert.equal(db.read(`${ROOT}/settings/studentActiveLaunch/ari`),b,'revoking A leaves the pointer to B');
  await assert.rejects(call(db,ari,{action:'launch',launchId:a}),{status:403});
  await assert.rejects(call(db,ari,{action:'answer',launchId:a,questionIndex:1,choiceIndex:1}),{status:403});
  // Even a stray queue entry for the revoked launch is ignored by the server.
  db.write(`${ROOT}/settings/studentAssignments/ari/${a}`,{assignedAt:1});
  assert.deepEqual((await call(db,ari,{action:'assignments'})).assignments.map(x=>x.id),[b]);
  // Ended launches and deleted launches drop out; a finished one stays reviewable.
  db.write(`${ROOT}/settings/studentAssignments/ari/missing_launch`,{assignedAt:2});
  await finish(db,ari,b);
  db.write(`${ROOT}/launches/${b}/endedAt`,999);
  list=(await call(db,ari,{action:'assignments'})).assignments;
  assert.deepEqual(list.map(x=>[x.id,x.status]),[[b,'completed']]);
  assert.equal((await call(db,ari,{action:'review',launchId:b})).completion.pct,100);
});

test('7. teacher helpers: assign adds, revoke and clear remove only one assignment',()=>{
  const queue={ari:{l1:{assignedAt:1},l2:{assignedAt:2},l3:{assignedAt:3}},bina:{l2:{assignedAt:2}}};
  const launches={
    l1:{classId:'alpha',targetStudents:{ari:true},quizSnapshot:{title:'One',questions:[{},{}]}},
    l2:{classId:'alpha',targetStudents:{ari:true,bina:true},deliveryType:'makeup',quizSnapshot:{title:'Two',questions:[{}]}},
    l3:{classId:'alpha',targetStudents:{ari:true},revokedStudents:{ari:9},quizSnapshot:{title:'Three',questions:[{}]}},
    l4:{classId:'beta',targetStudents:{dov:true},quizSnapshot:{title:'Four',questions:[{}]}}
  };
  const rows=WQA.pendingRows({queue,legacyPointers:{dov:'l4'},launches,completions:{l2:{bina:{completedAt:1}}},responses:{l1:{ari:{0:{choiceIndex:1}}}}});
  assert.deepEqual(rows.map(r=>r.studentId+':'+r.launchId+':'+r.source).sort(),['ari:l1:assigned','ari:l2:assigned','dov:l4:legacy']);
  assert.equal(rows.find(r=>r.launchId==='l1').answered,1);
  assert.deepEqual(WQA.pendingRows({queue,launches,classFilter:'beta'}),[]);
  assert.deepEqual(WQA.assignUpdates('b3Quiz',['ari'],'l9',{kind:'retake',classId:'et',assignedAt:7}),{'b3Quiz/settings/studentAssignments/ari/l9':{assignedAt:7,kind:'retake',classId:'et'},'b3Quiz/settings/studentActiveLaunch/ari':'l9'});
  assert.deepEqual(WQA.revokeUpdates('b3Quiz','l1','ari','l2',5),{'b3Quiz/settings/studentAssignments/ari/l1':null,'b3Quiz/launches/l1/revokedStudents/ari':5});
  assert.deepEqual(WQA.clearUpdates('b3Quiz','l2',['ari','bina'],{bina:'l2'}),{'b3Quiz/settings/studentAssignments/ari/l2':null,'b3Quiz/settings/studentAssignments/bina/l2':null,'b3Quiz/settings/studentActiveLaunch/bina':null});
  assert.throws(()=>WQA.assignUpdates('b3Quiz',['ari'],'bad/id'));
});

test('8. student page lists every assignment and never auto-opens a finished quiz',()=>{
  const html=fs.readFileSync('weekly-quiz/index.html','utf8');
  assert.match(html,/My Quizzes to Complete/);
  assert.ok(html.includes("callStudentQuiz('assignments')"));
  assert.ok(html.includes("/settings/studentAssignments/'+myStudentId"));
  const pick=html.match(/function pickActiveLaunch\(\)\{[\s\S]*?\n\}/)[0];
  // Auto-choice is limited to unfinished quizzes (open[0]) or the one already on screen.
  assert.doesNotMatch(pick,/usable\.sort/);
  const teacher=fs.readFileSync('weekly-quiz/teacher.html','utf8');
  assert.doesNotMatch(teacher,/Replace their current assignment\?/);
  assert.ok(teacher.includes('WeeklyQuizAssignments.assignUpdates(QROOT,[studentId],id'));
  for(const source of [html,teacher])for(const m of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))if(m[1].trim())new vm.Script(m[1]);
});

test('9. one student\'s marks: a quiz given again is one row, not a missed quiz',()=>{
  const html=fs.readFileSync('weekly-quiz/teacher.html','utf8');
  assert.ok(html.includes('../student-report/quiz-history.js'));
  // Copy each function out of the page by matching its braces.
  const fn=name=>{const start=html.indexOf('function '+name+'(');let depth=0,i=html.indexOf('{',start);for(;i<html.length;i++){if(html[i]==='{')depth++;else if(html[i]==='}'&&--depth===0)break;}return html.slice(start,i+1);};
  const source=['studentResultsQuizzes','launchQuestions','classForStudent'].map(fn).join('\n');
  const qs=title=>({title,questions:[{q:title+' 1',choices:['a','b'],correctIndex:1},{q:title+' 2',choices:['a','b'],correctIndex:1}]});
  const ctx={
    B3QuizHistory:require('../student-report/quiz-history.js'),WeeklyQuizAssignments:WQA,
    CLASS_SPACE:false,WQ_CLASS:'',CLASS_ROSTERS:{et:{students:['levi']}},
    asArray:v=>Array.isArray(v)?v:Object.values(v||{}),
    window:{B3QuizHistory:require('../student-report/quiz-history.js')},
    document:{getElementById:id=>({resultsClassFilter:{value:'all'},resultsQuizSearch:{value:''}})[id]||null},
    allLaunches:{
      morning:{classId:'et',quizId:'q1',createdAt:100,startedAt:100,quizSnapshot:qs('Cheshvan')},
      afternoon:{classId:'et',quizId:'q1',createdAt:200,startedAt:200,quizSnapshot:qs('Cheshvan')},
      // Regenerated with no saved-quiz id: same name and same questions still match.
      sh1:{classId:'et',createdAt:300,startedAt:300,quizSnapshot:qs('Shoroshim')},
      sh2:{classId:'et',createdAt:400,startedAt:400,quizSnapshot:qs('Shoroshim')},
      other:{classId:'et',createdAt:500,startedAt:500,quizSnapshot:qs('Different quiz')}
    },
    allResponses:{morning:{levi:{0:{correct:true},1:{correct:true}}},sh1:{levi:{0:{correct:false}}},sh2:{levi:{0:{correct:true}}}},
    completions:{morning:{levi:{completedAt:150}}}
  };
  vm.runInNewContext(source+';this.rows=studentResultsQuizzes("levi");',ctx);
  const rows=Object.fromEntries(ctx.rows.map(q=>[q.title,q]));
  assert.deepEqual(Object.keys(rows).sort(),['Cheshvan','Different quiz','Shoroshim']);
  assert.equal(rows.Cheshvan.attempts.length,2);
  assert.equal(rows.Cheshvan.counted.launchId,'morning','his finished 100% counts, the unopened repeat does not');
  assert.equal(rows.Cheshvan.pct,100);
  assert.equal(rows.Shoroshim.counted,null);
  assert.equal(rows.Shoroshim.partial.launchId,'sh2','newest started try is shown');
  assert.equal(rows['Different quiz'].status,'not_started','a quiz he really has not done still shows');
});
