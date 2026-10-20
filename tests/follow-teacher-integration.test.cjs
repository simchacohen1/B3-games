'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const child=require('node:child_process');
const ROOT=path.join(__dirname,'..');
const C=require('../follow-teacher/core.js');

function harness(overrides={}) {
  const listeners=new Map(), timers=new Map();
  let nextTimer=0;
  const stored=new Map([['b3Games_studentId','boy1'],['b3Games_studentClass','et']]);
  const values={
    'b3Games/workspaces/b3-2026/classes/et/members/boy1':{active:true,toolAccess:{shorashim:true}},
    'b3Games/students/boy1/profile/active':true,
    'b3Games/workspaces/b3-2026/classes/et/toolGrants/shorashim':true,
    'b3Games/workspaces/b3-2026/classes/et/active':true,
    'b3Games/siteSettings':{},
    ...overrides.values
  };
  const snap=value=>({val:()=>value,exists:()=>value!=null,child:p=>snap(p.split('/').reduce((r,k)=>r?.[k],value))});
  const db={ref(key){return {
    on(event,fn){listeners.set(key,fn);},
    off(event,fn){if(listeners.get(key)===fn)listeners.delete(key)},
    once:async()=>{ if(overrides.onRead)await overrides.onRead(key); return snap(values[key]??null); }
  }}};
  const claims=overrides.claims??{b3StudentRole:'student',b3StudentId:'boy1',b3ClassId:'et'};
  const user={uid:'studentToken1',getIdTokenResult:async()=>({claims})};
  const navigations=[];
  const elements=[];
  const body={appendChild:node=>elements.push(node)};
  const document={body,querySelector:()=>overrides.busy?{className:'rec-panel'}:null,createElement:()=>({
    style:{},dataset:{},remove(){},setAttribute(){},textContent:''
  })};
  const storage={getItem:key=>stored.get(key)||null,setItem:(key,v)=>stored.set(key,v),removeItem:key=>stored.delete(key)};
  const location={href:'https://funtorahtools.com/chazara/index.html',
    origin:'https://funtorahtools.com', assign:url=>navigations.push(url)};
  const ctx={window:null,document,location,
    firebase:{auth:()=>({currentUser:user}),database:()=>db},
    FTTFollowTeacherCore:C,sessionStorage:storage,CustomEvent:class{constructor(type,p={}){this.type=type;this.cancelable=p.cancelable;}},
    setInterval:()=>++nextTimer,clearInterval:()=>{},
    setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},
    clearTimeout:id=>timers.delete(id),
    console:{warn(){}},URL,Date,
    addEventListener(){},dispatchEvent:()=>true
  };
  ctx.window=ctx;ctx.top=ctx;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'follow-teacher/student.js'),'utf8'),ctx);
  const state={
    workspaceId:'b3-2026',classId:'et',studentId:'boy1',teacherUid:'teacher1',
    mode:'locked',destination:'shorashim',targets:'all',revision:'rev1',
    issuedAt:Date.now()-5000,heartbeatAt:Date.now()-1000,expiresAt:Date.now()+50000
  };
  return {ctx,listeners,timers,navigations,state,stored};
}
async function settle(){for(let k=0;k<10;k++)await new Promise(resolve=>setImmediate(resolve));}
async function fire(h,state) {
  await h.ctx.FTTFollowStudent.start({workspaceId:'b3-2026',classId:'et',studentId:'boy1'});
  h.listeners.get('b3Games/workspaces/b3-2026/classes/et/access/followTeacher')?.({val:()=>state});
  await settle();
}
async function runTimers(h){
  for(const [id,fn] of [...h.timers]){h.timers.delete(id);await fn();}
  await settle();
}
test('student only listens after matching signed student claims',async()=>{
  const h=harness({claims:{b3StudentId:'boy2',b3ClassId:'et',b3StudentRole:'student'}});
  await fire(h,h.state);
  assert.equal(h.listeners.size,0);
  assert.equal(h.navigations.length,0);
});
test('locked same-class sends to allowlisted Shorashim after save grace',async()=>{
  const h=harness();
  await fire(h,h.state);
  assert.equal(h.navigations.length,0);
  assert.ok(h.timers.size>0);
  await runTimers(h);
  assert.deepEqual(h.navigations,['https://funtorahtools.com/shorashim/']);
});
test('teacher from another class never moves this student',async()=>{
  const h=harness();
  await fire(h,{...h.state,classId:'wt'});
  await runTimers(h);
  assert.equal(h.navigations.length,0);
});
test('student blocked from Shorashim never moves',async()=>{
  const h=harness({values:{'b3Games/workspaces/b3-2026/classes/et/members/boy1':{active:true,toolAccess:{shorashim:false}}}});
  await fire(h,h.state);await runTimers(h);
  assert.equal(h.navigations.length,0);
});
test('expired lock or absent teacher never moves student',async()=>{
  const h=harness();
  await fire(h,{...h.state,heartbeatAt:Date.now()-100000});
  await runTimers(h);
  assert.equal(h.navigations.length,0);
});
test('free mode records revision to avoid second navigation',async()=>{
  const h=harness();
  await fire(h,{...h.state,mode:'free'});
  await runTimers(h);
  assert.equal(h.navigations.length,1);
  assert.ok(h.stored.get('fttFollowTeacherLastApplied').includes('rev1'));
});
test('active Chazara recording blocks automatic redirect until saving finishes',async()=>{
  const h=harness({busy:true});
  await fire(h,h.state);await runTimers(h);
  assert.equal(h.navigations.length,0);
});
test('activity can veto a redirect to finish saving work',async()=>{
  const h=harness();h.ctx.dispatchEvent=()=>false;
  await fire(h,h.state);await runTimers(h);
  assert.equal(h.navigations.length,0);
});
test('homepage, activity gate and teacher interfaces include Follow Teacher',()=>{
  const homepage=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const gate=fs.readFileSync(path.join(ROOT,'game-gate.js'),'utf8');
  const teacherHome=fs.readFileSync(path.join(ROOT,'teacher-home.html'),'utf8');
  const teacher=fs.readFileSync(path.join(ROOT,'follow-teacher/teacher.js'),'utf8');
  const html=fs.readFileSync(path.join(ROOT,'follow-teacher/teacher.html'),'utf8');
  assert.match(homepage,/FTTFollowStudent\?\.start/);
  assert.match(homepage,/Follow the Teacher/);
  assert.match(gate,/startFollowTeacherListener\(studentClassId, studentId\)/);
  assert.match(teacherHome,/follow-teacher\/teacher\.html\?class=/);
  assert.match(teacher,/access\/followTeacher/);
  assert.match(teacher,/teacher\.user\.uid/);
  assert.match(teacher,/C\.propose/);
  assert.match(html,/Follow Teacher — Locked/);
  for(const file of ['game-gate.js','follow-teacher/student.js','follow-teacher/teacher.js']){
    child.execFileSync(process.execPath,['--check',path.join(ROOT,file)]);
  }
});

test('live ET shape (no class active flag, member stored as true, no toolGrants) still follows',async()=>{
  const h=harness({values:{
    'b3Games/workspaces/b3-2026/classes/et/members/boy1':true,
    'b3Games/workspaces/b3-2026/classes/et/active':null,
    'b3Games/workspaces/b3-2026/classes/et/toolGrants/shorashim':null,
    'b3Games/siteSettings':{games:{shorashim:true},classGames:{et:{shorashim:true}}}
  }});
  await fire(h,h.state);await runTimers(h);
  assert.deepEqual(h.navigations,['https://funtorahtools.com/shorashim/']);
});
test('class explicitly marked inactive never moves student',async()=>{
  const h=harness({values:{'b3Games/workspaces/b3-2026/classes/et/active':false}});
  await fire(h,h.state);await runTimers(h);
  assert.equal(h.navigations.length,0);
});


test('failed Chazara audio remains protected until student acknowledges downloading it',()=>{
  const source=fs.readFileSync(path.join(ROOT,'chazara/index.html'),'utf8');
  const begin=source.indexOf('function preserveRecording(');
  const end=source.indexOf('\nasync function finishRecording(',begin);
  assert.ok(begin>=0 && end>begin,'Chazara recovery function exists');
  const nodes=[], inserted=[];
  const document={createElement(tag){
    const node={tag,attributes:{},children:[],style:{},setAttribute(k,v){this.attributes[k]=v},
      removeAttribute(k){delete this.attributes[k]},append(...parts){this.children.push(...parts)}};
    nodes.push(node);return node;
  }};
  const context={document,URL:{createObjectURL:()=> 'blob:test'},
    extFor:()=> 'webm',
    $:()=>({parentElement:{insertBefore(node){inserted.push(node)}}})};
  vm.runInNewContext(source.slice(begin,end),context);
  context.preserveRecording({type:'audio/webm'},'18_5',new Error('Save failed'),false);
  assert.equal(inserted.length,1);
  const recovery=inserted[0];
  assert.equal(recovery.attributes['data-ftt-unsaved'],'true');
  const acknowledgment=recovery.children.find(node=>node.tag==='button');
  assert.ok(acknowledgment,'Recovery must offer an explicit acknowledgment');
  assert.match(acknowledgment.textContent,/downloaded/i);
  acknowledgment.onclick();
  assert.equal(recovery.attributes['data-ftt-unsaved'],undefined);
  assert.equal(acknowledgment.disabled,true);
  const listener=fs.readFileSync(path.join(ROOT,'follow-teacher/student.js'),'utf8');
  assert.ok(listener.includes('[data-ftt-unsaved="true"]'),'Follow Teacher checks unsaved work marker');
});

for(const destination of Object.keys(C.DESTINATIONS)) {
  test(`listener checks the actual ${destination} student grant`,async()=>{
    const h=harness({values:{
      'b3Games/workspaces/b3-2026/classes/et/members/boy1':{active:true,toolAccess:{[destination]:false}}
    }});
    await fire(h,{...h.state,destination});await runTimers(h);
    assert.equal(h.navigations.length,0);
  });
}
test('unlock cancels a pending redirect, even with unchanged revision',async()=>{
  const h=harness();await fire(h,h.state);
  await fire(h,{...h.state,mode:'independent'});await runTimers(h);
  assert.equal(h.navigations.length,0);
});
test('locked-site capability permits only the current authenticated destination and expires',async()=>{
  const h=harness();h.ctx.location.href='https://funtorahtools.com/shorashim/';
  await fire(h,h.state);
  assert.equal(await h.ctx.FTTFollowStudent.allowsLockedActivity('shorashim'),true);
  assert.equal(await h.ctx.FTTFollowStudent.allowsLockedActivity('halacha'),false);
  await fire(h,{...h.state,mode:'independent'});
  assert.equal(await h.ctx.FTTFollowStudent.allowsLockedActivity('shorashim'),false);
  await fire(h,{...h.state,heartbeatAt:Date.now()-100000});
  assert.equal(await h.ctx.FTTFollowStudent.allowsLockedActivity('shorashim'),false);
});
test('Follow Once keeps only its permitted destination available through reloads while the command is fresh',async()=>{
  const h=harness();await fire(h,{...h.state,mode:'free'});await runTimers(h);
  const applied=h.stored.get('fttFollowTeacherLastApplied');
  h.ctx.location.href='https://funtorahtools.com/shorashim/';
  assert.equal(await h.ctx.FTTFollowStudent.allowsLockedActivity('shorashim'),true);
  h.ctx.FTTFollowStudent.stop();
  await fire(h,{...h.state,mode:'free'});
  assert.equal(h.stored.get('fttFollowTeacherLastApplied'),applied);
  assert.equal(await h.ctx.FTTFollowStudent.allowsLockedActivity('shorashim'),true);
  assert.equal(await h.ctx.FTTFollowStudent.allowsLockedActivity('halacha'),false);
});
test('every destination loads the shared student gate, never a teacher route',()=>{
  for(const [tool,entry] of Object.entries(C.DESTINATIONS)) {
    const filename=entry.path.endsWith('/')?entry.path+'index.html':entry.path;
    const html=fs.readFileSync(path.join(ROOT,filename),'utf8');
    assert.ok(html.includes('game-gate.js'),tool);
    assert.ok(html.includes('data-game-id="'+tool+'"'),tool);
    assert.ok(!filename.includes('teacher'),tool);
  }
});

function workGuard(file, variables) {
  const source=fs.readFileSync(path.join(ROOT,file),'utf8');
  const begin=source.indexOf("window.addEventListener('ftt:before-follow-navigation'");
  assert.ok(begin>=0,file+' has a work guard');
  const end=source.indexOf('});',begin)+3;
  let guard;const context={...variables,window:{addEventListener(_event,fn){guard=fn;}}};
  vm.runInNewContext(source.slice(begin,end),context);
  let held=false;guard({preventDefault(){held=true;}});return held;
}
test('Posuk work guard protects active microphone, unsaved captured audio, redo scoring and upload evidence',()=>{
  const ready={mediaRecorder:null,translationRecorder:null,chunkFixRecorder:null,wordFixRecorder:null,
    translationSessionActive:false,translationPillPhase:'idle',currentAudio:{},attemptSaved:{},
    translationSegments:{},translationGradedResults:{},comprehensionQResults:{},
    document:{querySelectorAll:()=>[],querySelector:()=>null}};
  const file='record_pesukim/student.html';
  assert.equal(workGuard(file,ready),false);
  assert.equal(workGuard(file,{...ready,mediaRecorder:{state:'recording'}}),true);
  assert.equal(workGuard(file,{...ready,currentAudio:{hebrew:{}}}),true);
  assert.equal(workGuard(file,{...ready,currentAudio:{hebrew:{}},attemptSaved:{hebrew:true}}),false);
  assert.equal(workGuard(file,{...ready,document:{querySelectorAll:()=>[],querySelector:()=>({})}}),true);
  assert.equal(workGuard(file,{...ready,translationSegments:{0:{blob:{}}},translationGradedResults:{0:{audioStoragePath:'uploaded'}}}),true);
  assert.equal(workGuard(file,{...ready,translationSegments:{0:{blob:{}}},translationGradedResults:{0:{evidenceSaved:true}}}),false);
});
test('scrapbook and coloring stay put through pending or failed account saves',()=>{
  assert.equal(workGuard('halacha/index.html',{halachaDirty:true,halachaCloudLoading:false,document:{querySelector:()=>null}}),true);
  assert.equal(workGuard('halacha/index.html',{halachaDirty:false,halachaCloudLoading:false,document:{querySelector:()=>null}}),false);
  assert.equal(workGuard('sefer-hamitzvos/index.html',{followPaintPending:true,paintLoading:false,active:null}),true);
  assert.equal(workGuard('sefer-hamitzvos/index.html',{followPaintPending:false,paintLoading:false,active:{}}),true);
  assert.equal(workGuard('sefer-hamitzvos/index.html',{followPaintPending:false,paintLoading:false,active:null}),false);
});
test('unsubmitted quiz choices and in-flight reward requests veto following',()=>{
  assert.equal(workGuard('weekly-quiz/index.html',{markingComplete:false,selectedChoice:0,responseFor:()=>null,displayedQuestion:0}),true);
  assert.equal(workGuard('weekly-quiz/index.html',{markingComplete:false,selectedChoice:0,responseFor:()=>({saved:true}),displayedQuestion:0}),false);
  assert.equal(workGuard('student-rewards/student.js',{state:{busy:true}}),true);
  assert.equal(workGuard('student-rewards/student.js',{state:{busy:false}}),false);
});

test('new follow command is rechecked after an earlier permission check is in flight',async()=>{
  let release; let paused=false;
  const hold=new Promise(resolve=>{release=resolve});
  const h=harness({onRead:async key=>{
    if(!paused && key.endsWith('/members/boy1')){paused=true;await hold;}
  }});
  await h.ctx.FTTFollowStudent.start({workspaceId:'b3-2026',classId:'et',studentId:'boy1'});
  const send=h.listeners.get('b3Games/workspaces/b3-2026/classes/et/access/followTeacher');
  send({val:()=>({...h.state,revision:'old',mode:'locked'})});
  await settle();
  send({val:()=>({...h.state,revision:'new',destination:'shorashim'})});
  release();
  await settle();
  await runTimers(h);
  assert.deepEqual(h.navigations,['https://funtorahtools.com/shorashim/']);
});

test('subsection policy is available only after permission, to the selected class and student',async()=>{
  const h=harness();
  await fire(h,{...h.state,subdestination:'review'});
  assert.equal(h.ctx.FTTFollowStudent.activityPolicy('shorashim').subdestination,'review');
  assert.equal(h.ctx.FTTFollowStudent.activityPolicy('chazara'),null);
  for(const change of [{classId:'wt'},{workspaceId:'other'},{targets:['boy2']},{mode:'free'},{subdestination:'constructor'}]) {
    await fire(h,{...h.state,subdestination:'review',...change});
    assert.equal(h.ctx.FTTFollowStudent.activityPolicy('shorashim'),null);
  }
});
test('same-page subsection navigation uses the activity adapter after save protection',async()=>{
  const h=harness();let section='games',moves=[];
  h.ctx.location.href='https://funtorahtools.com/shorashim/?section=review';
  h.ctx.FTTFollowActivities={shorashim:{currentSection:()=>section,applySection:s=>{moves.push(s);section=s;return true}}};
  await fire(h,{...h.state,subdestination:'review'});await runTimers(h);
  assert.deepEqual(moves,['review']);assert.equal(h.navigations.length,0);
  assert.equal(await h.ctx.FTTFollowStudent.allowsLockedActivity('shorashim'),true);
  section='games';assert.equal(await h.ctx.FTTFollowStudent.allowsLockedActivity('shorashim'),false);
});
test('subsection change still respects unfinished student work',async()=>{
  const h=harness({busy:true});let moves=0;
  h.ctx.location.href='https://funtorahtools.com/shorashim/';
  h.ctx.FTTFollowActivities={shorashim:{currentSection:()=>'',applySection:()=>{moves++;return true}}};
  await fire(h,{...h.state,subdestination:'review'});await runTimers(h);
  assert.equal(moves,0);assert.equal(h.navigations.length,0);
});
test('unlock and identity changes immediately remove subsection enforcement',async()=>{
  const h=harness();await fire(h,{...h.state,subdestination:'review'});
  h.stored.set('b3Games_studentId','boy2');
  assert.equal(h.ctx.FTTFollowStudent.activityPolicy('shorashim'),null);
  h.stored.set('b3Games_studentId','boy1');
  await fire(h,{...h.state,mode:'independent'});
  assert.equal(h.ctx.FTTFollowStudent.activityPolicy('shorashim'),null);
});
test('permission revocation clears a previously validated subsection policy',async()=>{
  const values={'b3Games/workspaces/b3-2026/classes/et/members/boy1':{active:true}};
  const h=harness({values});await fire(h,{...h.state,subdestination:'review'});
  assert.ok(h.ctx.FTTFollowStudent.activityPolicy('shorashim'));
  values['b3Games/workspaces/b3-2026/classes/et/members/boy1'].toolAccess={shorashim:false};
  await fire(h,{...h.state,subdestination:'review'});
  assert.equal(h.ctx.FTTFollowStudent.activityPolicy('shorashim'),null);
});
