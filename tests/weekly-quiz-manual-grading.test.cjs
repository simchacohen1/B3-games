'use strict';
// Focused checks for teacher manual grading in weekly-quiz/teacher.html:
// unanswered / correct / incorrect / already-adjusted answers, class separation, audit trail.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','weekly-quiz','teacher.html'),'utf8');
const start=html.indexOf('// Keeps the student');
const startReview=html.indexOf('function launchById(id)');
const end=html.indexOf('// ---------- Results / history ----------');
assert.ok(start>0&&startReview>0&&end>start,'teacher.html sections found');
const adjustSrc=html.slice(start,end);
const reviewSrc=html.slice(startReview,start);
const launchQuestionsSrc=html.match(/function launchQuestions\(l\)\{[^\n]*\}/)[0];

function makeDb(initial){
  const data=structuredClone(initial||{});let n=0;
  const get=p=>p.split('/').reduce((o,k)=>o&&o[k],data);
  const set=(p,v)=>{const parts=p.split('/'),k=parts.pop();let o=data;for(const x of parts)o=o[x]||(o[x]={});if(v===null||v===undefined)delete o[k];else o[k]=structuredClone(v);};
  const resolve=v=>JSON.parse(JSON.stringify(v,(k,x)=>x&&x['.sv']?1234:x));
  const ref=p=>({
    async once(){const v=get(p);return{val:()=>v===undefined?null:structuredClone(v),exists:()=>v!==undefined};},
    async set(v){set(p,resolve(v));},
    async update(v){const cur=get(p)||{};set(p,{...cur,...resolve(v)});},
    async remove(){set(p,null);},
    async transaction(fn){const cur=get(p),r=fn(cur===undefined?null:cur);if(r===undefined)return{committed:false};set(p,resolve(r));return{committed:true};},
    push(){return ref(p+'/k'+(++n));}
  });
  return{data,ref};
}

function setup(data,QROOT){
  const db=makeDb(data),alerts=[];
  const ctx={db,QROOT,alerts,note:'',firebase:{database:{ServerValue:{TIMESTAMP:{'.sv':'timestamp'}}}},
    roster:{s1:{name:'Student One'}},
    allLaunches:{L1:{classId:'et',quizSnapshot:{questions:[{q:'Q1',choices:['A','B'],correctIndex:1},{q:'Q2',choices:['A','B'],correctIndex:0},{q:'Q3',choices:['A','B'],correctIndex:0}]}}},
    allResponses:{},liveResponses:{},activeLaunchId:'L1',liveLaunch:null,resultsLaunchId:'L1',modalContext:null,
    asArray:v=>Array.isArray(v)?v:(v&&typeof v==='object'?Object.values(v):[]),esc:s=>String(s),
    confirm:()=>true,alert:m=>alerts.push(m),console};
  ctx.document={getElementById:()=>({get value(){return ctx.note;},set value(v){},innerHTML:'',classList:{add(){},remove(){},toggle(){}}})};
  vm.createContext(ctx);
  vm.runInContext(launchQuestionsSrc+'\nfunction responseFor(sid,i,rs){const r=(rs||liveResponses)[sid]||{};return r[i]||r[String(i)]||null;}\n'+reviewSrc+'\n'+adjustSrc,ctx);
  return ctx;
}
const root=ctx=>ctx.QROOT.split('/').reduce((o,k)=>o&&o[k],ctx.db.data);
const open=(ctx,sid,i)=>{ctx.allResponses.L1=(root(ctx)||{}).responses?.L1||{};vm.runInContext(`openAnswerModal('${sid}',${i},'results','L1')`,ctx);};
const resp=(ctx,i)=>(root(ctx)||{}).responses?.L1?.s1?.[i];
const run=(ctx,code)=>vm.runInContext(code,ctx);

test('unanswered cell opens the review window and can be marked Correct (full credit)',async()=>{
  const ctx=setup({},'b3Quiz');open(ctx,'s1',0);
  assert.ok(ctx.modalContext,'modal opens for an unanswered cell');
  ctx.note='Answered out loud';await run(ctx,'adjustCurrentAnswer(true)');
  const r=resp(ctx,0);assert.equal(r.correct,true);assert.equal(r.adjusted,true);assert.equal(r.noAnswer,true);assert.equal(r.adjustmentNote,'Answered out loud');
  const audit=Object.values(ctx.db.data.b3Quiz.audit.L1.s1);assert.equal(audit.length,1);assert.equal(audit[0].wasUnanswered,true);assert.equal(audit[0].after,true);assert.equal(audit[0].questionIndex,0);
});
test('unanswered cell can be marked Incorrect (zero credit, recorded)',async()=>{
  const ctx=setup({},'b3Quiz');open(ctx,'s1',1);await run(ctx,'adjustCurrentAnswer(false)');
  assert.equal(resp(ctx,1).correct,false);assert.equal(resp(ctx,1).adjusted,true);
});
test('does not overwrite a real answer that arrived while the window was open',async()=>{
  const ctx=setup({},'b3Quiz');open(ctx,'s1',0);
  ctx.db.data.b3Quiz={responses:{L1:{s1:{0:{choiceIndex:0,correct:false,adjusted:false}}}}};
  await run(ctx,'adjustCurrentAnswer(true)');
  assert.equal(resp(ctx,0).choiceIndex,0);assert.equal(resp(ctx,0).correct,false);assert.equal(ctx.alerts.length,1);assert.equal(ctx.db.data.b3Quiz.audit,undefined);
});
test('adjusting an answer changes only that answer; already-adjusted answers can be re-adjusted',async()=>{
  const ctx=setup({b3Quiz:{responses:{L1:{s1:{0:{choiceIndex:0,correct:false,originalCorrect:false,adjusted:false},1:{choiceIndex:0,correct:true,adjusted:false}}}}}},'b3Quiz');
  open(ctx,'s1',0);await run(ctx,'adjustCurrentAnswer(true)');
  assert.equal(resp(ctx,0).correct,true);assert.equal(resp(ctx,0).choiceIndex,0);assert.equal(resp(ctx,0).originalCorrect,false);
  assert.deepEqual(resp(ctx,1),{choiceIndex:0,correct:true,adjusted:false});
  open(ctx,'s1',0);await run(ctx,'adjustCurrentAnswer(false)');
  assert.equal(resp(ctx,0).correct,false);assert.equal(resp(ctx,0).originalCorrect,false);
  assert.equal(Object.keys(ctx.db.data.b3Quiz.audit.L1.s1).length,2);
});
test('Clear for retry reopens a finished quiz for that student; it does nothing on an unanswered cell',async()=>{
  const ctx=setup({b3Quiz:{responses:{L1:{s1:{0:{choiceIndex:0,correct:false},1:{choiceIndex:1,correct:false},2:{choiceIndex:0,correct:true}}}},completions:{L1:{s1:{correct:1,total:3,pct:33}}}}},'b3Quiz');
  open(ctx,'s1',0);await run(ctx,'clearCurrentAnswer()');
  assert.equal(resp(ctx,0),undefined);assert.ok(resp(ctx,1));assert.equal(ctx.db.data.b3Quiz.completions.L1.s1,undefined);
  const audit=Object.values(ctx.db.data.b3Quiz.audit.L1.s1);assert.equal(audit[0].type,'answer_cleared');assert.equal(audit[0].clearedResponse.choiceIndex,0);
  open(ctx,'s1',0);await run(ctx,'clearCurrentAnswer()');assert.equal(Object.keys(ctx.db.data.b3Quiz.audit.L1.s1).length,1);
});
test('after the student finished, a manual grade updates the saved completion score',async()=>{
  const ctx=setup({b3Quiz:{responses:{L1:{s1:{0:{choiceIndex:0,correct:false},1:{choiceIndex:0,correct:true},2:{choiceIndex:1,correct:false}}}},completions:{L1:{s1:{name:'Student One',correct:1,answered:3,total:3,pct:33}}}}},'b3Quiz');
  open(ctx,'s1',0);await run(ctx,'adjustCurrentAnswer(true)');
  const c=ctx.db.data.b3Quiz.completions.L1.s1;assert.equal(c.correct,2);assert.equal(c.pct,67);assert.equal(c.name,'Student One');
});
test('ET/WT and class spaces stay separate (writes only under the page root)',async()=>{
  const ctx=setup({b3Quiz:{responses:{L1:{s1:{0:{choiceIndex:0,correct:true}}}}}},'b3Quiz/classes/alpha');open(ctx,'s1',2);
  await run(ctx,'adjustCurrentAnswer(true)');
  assert.equal(ctx.db.data.b3Quiz.classes.alpha.responses.L1.s1[2].correct,true);
  assert.deepEqual(ctx.db.data.b3Quiz.responses.L1.s1,{0:{choiceIndex:0,correct:true}});assert.equal(ctx.db.data.b3Quiz.audit,undefined);
});
test('page wiring: blank cells clickable in live grid and results; clear button hidden for blanks',()=>{
  assert.match(html,/class="cell blank" onclick="event\.stopPropagation\(\);openAnswerModal/);
  assert.match(html,/class="cell '\+cls\+'" onclick="openAnswerModal\(/);
  assert.match(html,/id="modalClearBtn"/);
});
