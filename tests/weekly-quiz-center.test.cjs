const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../weekly-quiz/index.html'),'utf8');
function fn(name){const start=html.indexOf('function '+name+'(');let end=html.indexOf('\n',start);while(end>0){const s=(html.slice(start-6,start)==='async '?'async ':'')+html.slice(start,end);try{new vm.Script('('+s+')');return s;}catch{}end=html.indexOf('\n',end+1);}throw Error(name);}
function fixture(extra={}){const els={};const context={document:{getElementById:id=>els[id]||(els[id]={innerHTML:'',classList:{add(){},remove(){}}})},myStudentId:'synthetic',myClassId:'et',teacherPreview:false,forcedLaunchId:'',personalLaunchId:'',classLaunchId:'',assignedInfo:{},allLaunches:{},allCompletions:{},assignmentsLoaded:true,activeLaunchId:'',myResponses:{},historyState:'ready',classLabel:x=>x,fmtDate:x=>String(x),...extra};vm.createContext(context);for(const name of ['esc','asArray','assignedIds','isLaunchCompleted','renderAssigned','completedLaunchRows','renderPastQuizzes','launchAssignedTo'])vm.runInContext(fn(name),context);return {c:context,els,run:code=>vm.runInContext(code,context)};}
const launch=(extra={})=>({classId:'et',started:true,quizSnapshot:{title:'Same title',questions:[{},{}]},...extra});
test('page scripts parse and student practice link is removed',()=>{for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);assert.match(html,/<h1>My Quiz Center/);assert.doesNotMatch(html,/href="practice.html"/);assert.doesNotMatch(html,/slice\(0,HISTORY_LAUNCH_LIMIT\)/);});
test('one assigned quiz has question count and Start Quiz',()=>{const f=fixture({personalLaunchId:'one',assignedInfo:{one:{launch:launch(),responses:{}}}});f.run('renderAssigned()');assert.match(f.els.assignedList.innerHTML,/2 questions/);assert.match(f.els.assignedList.innerHTML,/Start Quiz/);});
test('no current quiz has a clear empty state',()=>{const f=fixture();f.run('renderAssigned()');assert.match(f.els.assignedList.innerHTML,/No quiz right now\./);});
test('same launch from three pointers appears once',()=>{const f=fixture({personalLaunchId:'one',classLaunchId:'one',forcedLaunchId:'one',assignedInfo:{one:{launch:launch()}}});f.run('renderAssigned()');assert.equal((f.els.assignedList.innerHTML.match(/assigned-row/g)||[]).length,1);});
test('distinct same-title assignments and retakes remain separate',()=>{const f=fixture({personalLaunchId:'one',classLaunchId:'two',assignedInfo:{one:{launch:launch()},two:{launch:launch({retakeOf:'one',attemptNumber:2})}}});f.run('renderAssigned()');assert.equal((f.els.assignedList.innerHTML.match(/assigned-row/g)||[]).length,2);assert.match(f.els.assignedList.innerHTML,/Retake 2/);});
test('saved partial answers offer Continue Quiz',()=>{const f=fixture({personalLaunchId:'one',assignedInfo:{one:{launch:launch(),responses:{0:{choiceIndex:1}}}}});f.run('renderAssigned()');assert.match(f.els.assignedList.innerHTML,/Continue Quiz/);});
test('completed and ended quizzes leave current assignments; completion enters history',()=>{const f=fixture({personalLaunchId:'one',classLaunchId:'two',assignedInfo:{one:{launch:launch()},two:{launch:launch({endedAt:123})}},allCompletions:{one:{synthetic:{completedAt:123,correct:2,total:2,pct:100}}}});f.run('renderAssigned();renderPastQuizzes()');assert.match(f.els.assignedList.innerHTML,/No quiz right now/);assert.match(f.els.pastQuizList.innerHTML,/Same title/);assert.match(f.els.pastQuizList.innerHTML,/123/);assert.doesNotMatch(f.els.pastQuizList.innerHTML,/100%/);});
test('released history displays score and keeps same-title attempts',()=>{const f=fixture({allLaunches:{one:launch({showScore:true}),two:launch({retakeOf:'one',attemptNumber:2})},allCompletions:{one:{synthetic:{completedAt:1,correct:2,total:2,pct:100}},two:{synthetic:{completedAt:2}}}});f.run('renderPastQuizzes()');assert.match(f.els.pastQuizList.innerHTML,/100%/);assert.match(f.els.pastQuizList.innerHTML,/Retake 2/);assert.equal((f.els.pastQuizList.innerHTML.match(/class="past-row"/g)||[]).length,2);});
test('ET/WT and individual makeup isolation use existing authorization',()=>{const f=fixture();assert.equal(f.c.launchAssignedTo(launch(),'synthetic','wt'),false);assert.equal(f.c.launchAssignedTo(launch({targetStudents:{other:true}}),'synthetic','et'),false);assert.equal(f.c.launchAssignedTo(launch({deliveryType:'makeup',targetStudents:{synthetic:true}}),'synthetic','et'),true);});



// Execute the actual page data-access functions against memory-only dependencies.
// No Firebase connection, live token, account creation or production writes occur.
function dataFixture(extra={}) {
  const values={},writes=[];
  const database={ref:path=>({
    once:async()=>({val:()=>values[path]??null}),
    transaction:async update=>{const next=update(values[path]??null);if(next===undefined)return {committed:false,snapshot:{val:()=>values[path]}};values[path]=next;writes.push(path);return {committed:true,snapshot:{val:()=>next}};}
  })};
  const databaseFactory=()=>database;databaseFactory.ServerValue={TIMESTAMP:123};
  const c={myStudentId:'synthetic_et',myClassId:'et',myName:'Synthetic ET',QROOT:'b3Quiz',teacherPreview:false,
    firebaseConfig:{databaseURL:'https://fixture.invalid'},firebase:{auth:()=>({currentUser:{getIdToken:async()=>'synthetic-token'}}),database:databaseFactory},
    db:database,STUDENT_WEEKLY_QUIZ_URL:'https://fixture.invalid/quiz',fetch:async()=>{throw Error('Unexpected request');},...extra};
  vm.createContext(c);
  vm.runInContext(html.slice(html.indexOf('function waitForStudentAuth(){'),html.indexOf('const CLASS_ROSTERS=')),c);
  for(const name of ['asArray'])vm.runInContext(fn(name),c);
  return {c,values,writes,run:code=>vm.runInContext(code,c)};
}
test('403 authorization rejection never falls back to database',async()=>{
  const f=dataFixture({fetch:async()=>({ok:false,status:403,json:async()=>({error:'Not assigned'})})});
  f.c.db.ref=()=>{throw Error('Unauthorized fallback');};
  await assert.rejects(f.run("callStudentQuiz('launch',{launchId:'one'})"),{status:403});
});
test('successful function mode cannot later silently downgrade',async()=>{
  let count=0;const f=dataFixture({fetch:async()=>{if(count++)throw Error('offline');return {ok:true,status:200,json:async()=>({launch:launch()})};}});
  await f.run("callStudentQuiz('launch',{launchId:'one'})");
  f.c.db.ref=()=>{throw Error('Unexpected fallback');};
  await assert.rejects(f.run("callStudentQuiz('launch',{launchId:'one'})"),/unreachable/);
});
test('unavailable function falls back to assigned launch with saved answers',async()=>{
  const f=dataFixture();f.values['b3Quiz/launches/one']=launch();f.values['b3Quiz/responses/one/synthetic_et']={0:{choiceIndex:1}};
  const r=await f.run("callStudentQuiz('launch',{launchId:'one'})");
  assert.equal(r.responses[0].choiceIndex,1);assert.equal(f.writes.length,0);
});
test('database fallback isolates ET/WT and individual makeups',async()=>{
  const f=dataFixture();f.values['b3Quiz/launches/wt']=launch({classId:'wt'});f.values['b3Quiz/launches/private']=launch({targetStudents:{other:true}});
  for(const id of ['wt','private'])await assert.rejects(f.c.directStudentQuiz('launch',{launchId:id}),{status:403});
  f.c.myClassId='wt';f.c.myStudentId='synthetic_wt';
  assert.equal((await f.c.directStudentQuiz('launch',{launchId:'wt'})).launch.classId,'wt');
  f.values['b3Quiz/launches/makeup']=launch({classId:'wt',deliveryType:'makeup',targetStudents:{synthetic_wt:true}});
  assert.equal((await f.c.directStudentQuiz('launch',{launchId:'makeup'})).launch.deliveryType,'makeup');assert.equal(f.writes.length,0);
});
test('synthetic answer, completion, review and retake preserve original attempt',async()=>{
  const f=dataFixture();const l=launch();l.mode='test';l.quizSnapshot.questions=[{q:'One?',choices:['A','B'],correctIndex:1}];
  f.values['b3Quiz/launches/one']=l;
  await assert.rejects(f.c.directStudentQuiz('review',{launchId:'one'}),{status:403});
  await assert.rejects(f.c.directStudentQuiz('complete',{launchId:'one'}),{status:409});
  await f.c.directStudentQuiz('answer',{launchId:'one',questionIndex:0,choiceIndex:1});
  const saved=f.values['b3Quiz/responses/one/synthetic_et/0'];
  await assert.rejects(f.c.directStudentQuiz('answer',{launchId:'one',questionIndex:0,choiceIndex:0}),{status:409});
  f.values['b3Quiz/responses/one/synthetic_et']={0:saved};
  const r=await f.c.directStudentQuiz('complete',{launchId:'one'});assert.equal(r.completion.pct,100);
  assert.equal((await f.c.directStudentQuiz('complete',{launchId:'one'})).alreadyCompleted,true);
  await assert.rejects(f.c.directStudentQuiz('answer',{launchId:'one',questionIndex:0,choiceIndex:0}),{status:409});
  assert.equal((await f.c.directStudentQuiz('review',{launchId:'one'})).responses[0].choiceIndex,1);
  f.values['b3Quiz/launches/retake']={...l,retakeOf:'one',attemptNumber:2};
  assert.equal((await f.c.directStudentQuiz('launch',{launchId:'retake'})).completion,null);
  assert.equal(f.values['b3Quiz/completions/one/synthetic_et'].pct,100);
});
test('paced quiz waits for teacher and retains catch-up navigation',()=>{
  const f=fixture({launchData:{activeQuestion:2,questionStates:{0:{reveal:true},1:{},2:{}}},myResponses:{}});
  for(const name of ['questionState','responseFor','studentEffectiveQuestionState','studentCanVisitQuestion'])vm.runInContext(fn(name),f.c);
  assert.equal(f.c.studentCanVisitQuestion(2,'paced'),false);
  assert.equal(f.c.studentCanVisitQuestion(1,'paced'),true);
  assert.equal(f.c.studentEffectiveQuestionState(0,'paced').reveal,false);
  assert.equal(f.c.studentCanVisitQuestion(2,'test'),true);
});
test('center waits for Start; direct link opens its exact launch',()=>{
  const chosen=[];const f=fixture({quizOpened:false,userPickedLaunchId:'',chooseActiveLaunch:id=>chosen.push(id),render:()=>{}});
  vm.runInContext(fn('pickActiveLaunch'),f.c);f.c.pickActiveLaunch();assert.equal(chosen.pop(),'');
  f.c.forcedLaunchId='exact_retake';f.c.pickActiveLaunch();assert.equal(chosen.pop(),'exact_retake');
  f.c.forcedLaunchId='';f.c.personalLaunchId='makeup';f.c.userPickedLaunchId='makeup';f.c.quizOpened=true;f.c.pickActiveLaunch();assert.equal(chosen.pop(),'makeup');
});
test('history includes results older than 60 launches without writing records',async()=>{
  const f=dataFixture();const ids={};for(let i=1;i<=65;i++)ids[String(i)+'_quiz']=true;
  f.c.fetch=async()=>({ok:true,json:async()=>ids});
  f.values['b3Quiz/completions/1_quiz/synthetic_et']={completedAt:1};f.values['b3Quiz/launches/1_quiz']=launch();
  f.values['b3Quiz/completions/65_quiz/synthetic_et']={completedAt:65};f.values['b3Quiz/launches/65_quiz']=launch();
  const r=await f.c.directStudentQuiz('history');assert.equal(Object.keys(r.completions).length,2);assert.ok(r.completions['1_quiz']);assert.equal(f.writes.length,0);
});
test('assignment loading error is shown with retry; completed launch never has Start',()=>{
  const f=fixture({personalLaunchId:'one',assignedInfo:{one:{error:'offline',status:0}}});f.run('renderAssigned()');assert.match(f.els.assignedList.innerHTML,/Try again/);
  f.c.assignedInfo.one={launch:launch()};f.c.allCompletions.one={synthetic:{completedAt:1}};f.run('renderAssigned()');assert.doesNotMatch(f.els.assignedList.innerHTML,/Start Quiz/);
});
test('actual review hides unreleased correctness and displays released answers',async()=>{
  const l=launch({showScore:false});l.quizSnapshot.questions=[{q:'Question?',choices:['A','B'],correctIndex:1}];
  const f=fixture({callStudentQuiz:async()=>({launch:l,responses:{0:{choiceIndex:1,correct:true}},completion:{completedAt:123}}),renderAudioAwareText:(el,text)=>{el.textContent=text;}});
  f.c.document.querySelectorAll=()=>[];
  const get=f.c.document.getElementById;f.c.document.getElementById=id=>{const el=get(id);el.scrollIntoView=()=>{};return el;};
  for(const name of ['scoreFromResponses','openPastQuiz'])vm.runInContext(fn(name),f.c);
  await f.c.openPastQuiz('one');
  assert.equal(f.els.reviewScore.textContent,'');assert.match(f.els.reviewNotice.textContent,/not released/);assert.doesNotMatch(f.els.reviewQuestions.innerHTML,/Correct answer:|✓ Correct/);
  l.showScore=true;await f.c.openPastQuiz('one');
  assert.match(f.els.reviewScore.textContent,/100%/);assert.match(f.els.reviewQuestions.innerHTML,/Correct answer:/);assert.equal(f.els.ra_0.textContent,'B');
});
