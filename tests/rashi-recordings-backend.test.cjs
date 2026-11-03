'use strict';
// Rashi Letters recordings (2026-10-23): runs the real studentRewardsAutoAward
// handler against an in-memory database and storage. Only made-up students.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../backend/functions/rashi-recording-core.cjs');
const scopeApi=require('../backend/functions/teacher-class-scope');

function makeDb(seed){
  const root=JSON.parse(JSON.stringify(seed));
  const parts=p=>String(p).split('/').filter(Boolean);
  const getAt=p=>parts(p).reduce((o,k)=>(o&&typeof o==='object'&&k in o?o[k]:undefined),root);
  const setAt=(p,v)=>{
    const ks=parts(p),last=ks.pop();let o=root;
    for(const k of ks){if(!o[k]||typeof o[k]!=='object')o[k]={};o=o[k];}
    if(v===null||v===undefined)delete o[last];else o[last]=JSON.parse(JSON.stringify(v));
  };
  const snap=v=>{const c=v===undefined?null:JSON.parse(JSON.stringify(v));return {val:()=>c,exists:()=>c!==null,forEach:f=>{if(c&&typeof c==='object')Object.keys(c).forEach(k=>f({key:k,val:()=>c[k]}));}};};
  const ref=path=>({
    get:async()=>snap(getAt(path)),
    set:async v=>setAt(path,v),
    update:async v=>{for(const [k,x] of Object.entries(v))setAt(path+'/'+k,x);},
    transaction:async fn=>{
      const cur=getAt(path),out=fn(cur===undefined?null:JSON.parse(JSON.stringify(cur)));
      if(out===undefined)return {committed:false,snapshot:snap(cur)};
      setAt(path,out);return {committed:true,snapshot:snap(getAt(path))};
    }
  });
  return {root,getAt,ref};
}
function makeBackend(seed){
  const db=makeDb(seed),files={};
  const tokens={
    kid1:{b3StudentId:'kid1',b3ClassId:'et',b3StudentRole:'student'},
    kid2:{b3StudentId:'kid2',b3ClassId:'wt',b3StudentRole:'student'},
    teacherEt:{uid:'tEt',email:'et.teacher@test.example',email_verified:true},
    teacherWt:{uid:'tWt',email:'wt.teacher@test.example',email_verified:true},
    owner:{uid:'own',email:'simcha5770@gmail.com',email_verified:true}
  };
  const admin={apps:[{}],database:()=>({ref:db.ref}),
    auth:()=>({verifyIdToken:async t=>{if(!tokens[t])throw new Error('bad token');return tokens[t];}}),
    storage:()=>({bucket:()=>({file:path=>({
      save:async(buf,opts)=>{files[path]={size:buf.length,type:opts.contentType};},
      delete:async()=>{delete files[path];},
      getSignedUrl:async()=>['https://signed.example/'+path]
    })})})};
  const ctx={exports:{},require:n=>n==='firebase-admin'?admin:n==='firebase-functions/v2/https'?{onRequest:(o,fn)=>fn}:n==='./teacher-class-scope'?scopeApi
    :n.startsWith('./')?require('../backend/functions/'+n.slice(2)):require(n),console:{log(){},warn(){},error(){}},Buffer,Intl,Date,setTimeout,Promise};
  vm.runInNewContext(fs.readFileSync('backend/functions/student-rewards-auto-award.js','utf8'),ctx);
  const call=async(req)=>{const res={set(){},status(c){this.code=c;return this;},json(v){this.body=v;return this;},send(){return this;}};
    await ctx.exports.studentRewardsAutoAward({method:'POST',headers:{},query:{},body:{},...req},res);return res;};
  const audio=n=>Buffer.alloc(n||5000,7);
  return {db,files,call,
    submit:(token,section,extra={})=>call({headers:{authorization:'Bearer '+token,'content-type':'audio/webm;codecs=opus'},
      query:{rashi:'submit',section,durationMs:'8000',words:'זֶה|זָר',...(extra.query||{})},rawBody:extra.rawBody||audio(),body:extra.rawBody||audio()}),
    status:token=>call({headers:{authorization:'Bearer '+token},body:{action:'rashi-student-status'}}),
    teacher:(token,action,body={})=>call({headers:{authorization:'Bearer '+token},body:{action,...body}})};
}
function seed(){
  const cls=(name,members)=>({active:true,name,toolGrants:{'rashi-letters':true,chazara:true},members});
  const stud=(id,classId)=>({['b3Games/students/'+id+'/profile']:{name:id,classId,active:true}});
  return {
    b3Games:{
      workspaces:{'b3-2026':{
        classes:{et:cls('B3 ET',{kid1:{name:'Test Kid One',active:true}}),wt:cls('B3 WT',{kid2:{name:'Test Kid Two',active:true}})},
        teachers:{tEt:{active:true,classIds:{et:true}},tWt:{active:true,classIds:{wt:true}}}
      }},
      students:{
        kid1:{profile:{name:'Test Kid One',classId:'et',active:true},memberships:{m:{active:true,workspaceId:'b3-2026',classId:'et'}}},
        kid2:{profile:{name:'Test Kid Two',classId:'wt',active:true},memberships:{m:{active:true,workspaceId:'b3-2026',classId:'wt'}}}
      }
    },
    studentRewards:{students:{
      rs1:{name:'Test Kid One',b3StudentId:'kid1',classId:'class-b3-et',rewardBalance:10},
      rs2:{name:'Test Kid Two',b3StudentId:'kid2',classId:'class-b3-wt',rewardBalance:0}
    }}
  };
}
const pendingRequests=b=>Object.entries(b.db.getAt('studentRewards/pointRequests')||{}).filter(([,r])=>r.source==='rashi-recording');
const balance=(b,id)=>b.db.getAt('studentRewards/students/'+id+'/rewardBalance');

test('a signed-in student sends a recording: one pending 2-point request, audio stored privately',async()=>{
  const b=makeBackend(seed()),r=await b.submit('kid1','zayin');
  assert.equal(r.code,200,JSON.stringify(r.body));assert.equal(r.body.status,'pending');
  const reqs=pendingRequests(b);assert.equal(reqs.length,1);
  const [id,item]=reqs[0];
  assert.equal(item.amount,2);assert.equal(item.status,'pending');assert.equal(item.practiceStudentId,'kid1');assert.equal(item.workspaceClassId,'et');assert.equal(item.sectionId,'zayin');
  assert.deepEqual(Object.keys(b.files).map(p=>p.split('/').slice(0,4).join('/')),['rashi-recordings/et/kid1/zayin']);
  assert.equal(balance(b,'rs1'),10,'submitting gives no points');
  assert.equal(b.db.getAt('rashiLetters/recordings/kid1/zayin').status,'pending');
  assert.ok(id.startsWith('rashi_kid1_zayin_'));
});
test('submit needs the real student sign-in, a known section and real audio',async()=>{
  const b=makeBackend(seed());
  assert.equal((await b.submit('nobody','zayin')).code,401);
  assert.equal((await b.submit('teacherEt','zayin')).code,401,'a teacher token is not a student');
  assert.equal((await b.submit('kid1','../hack')).code,400);
  assert.equal((await b.submit('kid1','zayin',{rawBody:Buffer.alloc(10)})).code,400);
  assert.equal((await b.submit('kid1','zayin',{query:{durationMs:'200'}})).code,400);
  assert.equal(pendingRequests(b).length,0);assert.equal(Object.keys(b.files).length,0);
});
test('double submit, retry and parallel taps never create a second recording or request',async()=>{
  const b=makeBackend(seed());
  const [a,c]=await Promise.all([b.submit('kid1','bet'),b.submit('kid1','bet')]);
  assert.ok([a,c].every(x=>x.code===200));
  assert.equal(pendingRequests(b).length,1);
  assert.equal(Object.keys(b.files).length,1,'the losing upload is removed');
  const again=await b.submit('kid1','bet');
  assert.equal(again.body.alreadySubmitted,true);assert.equal(pendingRequests(b).length,1);assert.equal(Object.keys(b.files).length,1);
});
test('teacher sees the pending item (class, section, audio) only for their own class',async()=>{
  const b=makeBackend(seed());await b.submit('kid1','alef');await b.submit('kid2','alef');
  const et=await b.teacher('teacherEt','rashi-list-pending',{classId:'et'});
  assert.equal(et.body.requests.length,1);const row=et.body.requests[0];
  assert.equal(row.studentId,'kid1');assert.equal(row.className,'B3 ET');assert.match(row.sectionLabel,/Mission 4/);assert.match(row.audioUrl,/^https:\/\/signed\.example\/rashi-recordings\/et\/kid1\/alef\//);
  const wt=await b.teacher('teacherWt','rashi-list-pending',{classId:'wt'});assert.equal(wt.body.requests.length,1);assert.equal(wt.body.requests[0].studentId,'kid2');
  assert.equal((await b.teacher('teacherEt','rashi-list-pending',{classId:'wt'})).code,401,'cannot ask for another class');
  assert.equal((await b.teacher('owner','rashi-list-pending')).body.requests.length,2,'owner sees both classes');
});
test('approval gives exactly 2 points; repeated and parallel approvals add nothing',async()=>{
  const b=makeBackend(seed());await b.submit('kid1','zayin');
  const id=pendingRequests(b)[0][0];
  const [x,y]=await Promise.all([b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:id}),b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:id})]);
  assert.ok(x.body.ok&&y.body.ok);
  assert.equal(balance(b,'rs1'),12);
  const third=await b.teacher('owner','rashi-approve',{requestId:id});assert.equal(third.body.alreadyHandled,true);assert.equal(balance(b,'rs1'),12);
  const item=b.db.getAt('studentRewards/pointRequests/'+id);assert.equal(item.status,'approved');assert.equal(item.actualAmount,2);assert.equal(item.reviewedBy,'et.teacher@test.example');
  assert.equal(b.db.getAt('rashiLetters/recordings/kid1/zayin').status,'approved');
  const audit=b.db.getAt('rashiLetters/recordingAudit/'+id);
  assert.equal(audit.result,'approved');assert.equal(audit.points,2);assert.equal(audit.balanceAfter,12);assert.equal(audit.reviewedBy,'et.teacher@test.example');
  const st=(await b.status('kid1')).body.sections;assert.equal(st.zayin.status,'approved');assert.equal(st.zayin.points,2);
  const re=await b.submit('kid1','zayin');assert.equal(re.body.status,'approved');assert.equal(pendingRequests(b).length,1,'no new request after approval');assert.equal(balance(b,'rs1'),12);
});
test('rejection gives 0 points and lets the student record again; the new one can earn 2',async()=>{
  const b=makeBackend(seed());await b.submit('kid1','shin');
  const first=pendingRequests(b)[0][0];
  const rej=await b.teacher('teacherEt','rashi-reject',{classId:'et',requestId:first});assert.equal(rej.body.status,'rejected');
  assert.equal(balance(b,'rs1'),10);
  assert.equal((await b.status('kid1')).body.sections.shin.status,'rejected');
  assert.equal(b.db.getAt('rashiLetters/recordingAudit/'+first).points,0);
  const again=await b.submit('kid1','shin');assert.equal(again.body.status,'pending');assert.equal(again.body.attempt,2);
  assert.equal(pendingRequests(b).length,2);
  assert.ok(b.db.getAt('rashiLetters/recordingHistory/kid1/shin/'+Object.keys(b.db.getAt('rashiLetters/recordingHistory/kid1/shin'))[0]),'old attempt kept for audit');
  const second=pendingRequests(b).find(([id,r])=>r.status==='pending')[0];
  await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:second});
  assert.equal(balance(b,'rs1'),12);
  // the rejected request can never be approved later
  const late=await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:first});assert.equal(late.body.alreadyHandled,true);assert.equal(balance(b,'rs1'),12);
});
test('each section pays on its own',async()=>{
  const b=makeBackend(seed());
  for(const s of ['zayin','bet','words3'])await b.submit('kid1',s);
  for(const [id] of pendingRequests(b))await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:id});
  assert.equal(balance(b,'rs1'),16);
});
test('students cannot approve, reject or list; teachers cannot touch other classes',async()=>{
  const b=makeBackend(seed());await b.submit('kid1','zayin');
  const id=pendingRequests(b)[0][0];
  assert.equal((await b.teacher('kid1','rashi-approve',{requestId:id})).code,401);
  assert.equal((await b.teacher('kid1','rashi-reject',{requestId:id})).code,401);
  assert.equal((await b.teacher('kid1','rashi-list-pending')).code,401);
  assert.equal((await b.teacher('teacherWt','rashi-approve',{classId:'wt',requestId:id})).code,403,'WT teacher cannot approve an ET recording');
  assert.equal((await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:'../x'})).code,403);
  assert.equal(balance(b,'rs1'),10);assert.equal(b.db.getAt('studentRewards/pointRequests/'+id).status,'pending');
});
test('a request with a changed point value is refused',async()=>{
  const b=makeBackend(seed());await b.submit('kid1','zayin');
  const id=pendingRequests(b)[0][0];b.db.ref('studentRewards/pointRequests/'+id+'/amount').set(500);
  const r=await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:id});
  assert.equal(r.code,409);assert.equal(balance(b,'rs1'),10);
});
test('ET and WT stay separate in status and storage',async()=>{
  const b=makeBackend(seed());await b.submit('kid1','zayin');await b.submit('kid2','zayin');
  assert.deepEqual(Object.keys((await b.status('kid1')).body.sections),['zayin']);
  assert.ok(Object.keys(b.files).some(p=>p.startsWith('rashi-recordings/et/kid1/')));assert.ok(Object.keys(b.files).some(p=>p.startsWith('rashi-recordings/wt/kid2/')));
  assert.equal(pendingRequests(b).filter(([,r])=>r.workspaceClassId==='wt').length,1);
});
test('status survives refresh: a lost approval is picked up from the request',async()=>{
  const b=makeBackend(seed());await b.submit('kid1','zayin');
  const id=pendingRequests(b)[0][0];
  b.db.ref('studentRewards/pointRequests/'+id).update({status:'approved',actualAmount:2});   // approved by another screen
  assert.equal((await b.status('kid1')).body.sections.zayin.status,'approved');
  assert.equal(b.db.getAt('rashiLetters/recordings/kid1/zayin').status,'approved');
});
test('other approval categories are unchanged: Rashi is not in the Chazara or generic queues',async()=>{
  const Q=require('../approval-queue.js');
  const map={r:{status:'pending',source:'rashi-recording',classId:'class-b3-et',createdAt:5},c:{status:'pending',source:'chazara',classId:'et',createdAt:3}};
  assert.deepEqual(Q.manualQueue(map).map(x=>x.id),['c']);
  assert.deepEqual(Q.rashiQueue(map).map(x=>x.id),['r']);
  assert.equal(Q.needsManualApproval(map.r),false);
  assert.deepEqual(Q.countByClass(Q.rashiQueue(map).map(x=>x.item)),{'class-b3-et':1});
});
test('core rules: sections, words and claim',()=>{
  assert.equal(Object.keys(core.SECTIONS).length,12);
  assert.ok(core.isSection('zayin')&&core.isSection('words4')&&!core.isSection('__proto__')&&!core.isSection('constructor'));
  assert.deepEqual(core.cleanWords('זֶה|<b>x</b>|זָר'),['זֶה','bx','זָר'].map(w=>w.replace(/[^֐-׿ ]/g,'')).filter(Boolean));
  assert.equal(core.claim({status:'pending'},{}).block,'pending');
  assert.equal(core.claim({status:'approved'},{}).block,'approved');
  assert.equal(core.claim({status:'rejected',attempt:1,attemptId:'a'},{x:1}).write.attempt,2);
  assert.equal(require('../backend/functions/student-practice-auth.cjs').toolForSource('rashi-recording'),'rashi-letters');
});
