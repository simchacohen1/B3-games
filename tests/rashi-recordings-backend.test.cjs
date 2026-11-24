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
// Everything is practice-only until the teacher opens it, so these tests open everything for both classes
// (submissionOpen.all) except where a test is about the closed default.
function seed(open=true){
  const cls=(name,members)=>({active:true,name,toolGrants:{'rashi-letters':true,chazara:true},members,...(open?{submissionOpen:{all:true}}:{})});
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
  assert.equal(balance(b,'rs1'),8,'sending costs 2 points');
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
  assert.equal(balance(b,'rs1'),10);
  const third=await b.teacher('owner','rashi-approve',{requestId:id});assert.equal(third.body.alreadyHandled,true);assert.equal(balance(b,'rs1'),10);
  const item=b.db.getAt('studentRewards/pointRequests/'+id);assert.equal(item.status,'approved');assert.equal(item.actualAmount,2);assert.equal(item.reviewedBy,'et.teacher@test.example');
  assert.equal(b.db.getAt('rashiLetters/recordings/kid1/zayin').status,'approved');
  const audit=b.db.getAt('rashiLetters/recordingAudit/'+id);
  assert.equal(audit.result,'approved');assert.equal(audit.points,2);assert.equal(audit.balanceAfter,10);assert.equal(audit.reviewedBy,'et.teacher@test.example');
  const st=(await b.status('kid1')).body.sections;assert.equal(st.zayin.status,'approved');assert.equal(st.zayin.points,2);
  const re=await b.submit('kid1','zayin');assert.equal(re.body.status,'approved');assert.equal(pendingRequests(b).length,1,'no new request after approval');assert.equal(balance(b,'rs1'),10);
});
test('rejection gives 0 points and lets the student record again; the new one can earn 2',async()=>{
  const b=makeBackend(seed());await b.submit('kid1','shin');
  const first=pendingRequests(b)[0][0];
  const rej=await b.teacher('teacherEt','rashi-reject',{classId:'et',requestId:first});assert.equal(rej.body.status,'rejected');
  assert.equal(balance(b,'rs1'),8);
  assert.equal((await b.status('kid1')).body.sections.shin.status,'rejected');
  assert.equal(b.db.getAt('rashiLetters/recordingAudit/'+first).points,0);
  const again=await b.submit('kid1','shin');assert.equal(again.body.status,'pending');assert.equal(again.body.attempt,2);
  assert.equal(pendingRequests(b).length,2);
  assert.ok(b.db.getAt('rashiLetters/recordingHistory/kid1/shin/'+Object.keys(b.db.getAt('rashiLetters/recordingHistory/kid1/shin'))[0]),'old attempt kept for audit');
  const second=pendingRequests(b).find(([id,r])=>r.status==='pending')[0];
  await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:second});
  assert.equal(balance(b,'rs1'),8);
  // the rejected request can never be approved later
  const late=await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:first});assert.equal(late.body.alreadyHandled,true);assert.equal(balance(b,'rs1'),8);
});
test('each section pays on its own',async()=>{
  const b=makeBackend(seed());
  for(const s of ['zayin','bet','words3'])await b.submit('kid1',s);
  for(const [id] of pendingRequests(b))await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:id});
  assert.equal(balance(b,'rs1'),10);
});
test('students cannot approve, reject or list; teachers cannot touch other classes',async()=>{
  const b=makeBackend(seed());await b.submit('kid1','zayin');
  const id=pendingRequests(b)[0][0];
  assert.equal((await b.teacher('kid1','rashi-approve',{requestId:id})).code,401);
  assert.equal((await b.teacher('kid1','rashi-reject',{requestId:id})).code,401);
  assert.equal((await b.teacher('kid1','rashi-list-pending')).code,401);
  assert.equal((await b.teacher('teacherWt','rashi-approve',{classId:'wt',requestId:id})).code,403,'WT teacher cannot approve an ET recording');
  assert.equal((await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:'../x'})).code,403);
  assert.equal(balance(b,'rs1'),8);assert.equal(b.db.getAt('studentRewards/pointRequests/'+id).status,'pending');
});
test('a request with a changed point value is refused',async()=>{
  const b=makeBackend(seed());await b.submit('kid1','zayin');
  const id=pendingRequests(b)[0][0];b.db.ref('studentRewards/pointRequests/'+id+'/amount').set(500);
  const r=await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:id});
  assert.equal(r.code,409);assert.equal(balance(b,'rs1'),8);
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

test('Vayeira passage uses full canonical Hebrew and allows only its assigned teacher to grade',async()=>{
  const passage=require('../backend/functions/vayeira-rashi.json').passages[0];
  const b=makeBackend(seed());
  const send=await b.submit('kid1',passage.id,{query:{words:'not real Hebrew'}});
  assert.equal(send.code,200,JSON.stringify(send.body));
  const record=b.db.getAt('rashiLetters/recordings/kid1/'+passage.id);
  assert.deepEqual(record.words,[passage.text]);
  const et=await b.teacher('teacherEt','rashi-list-pending',{classId:'et'});
  assert.equal(et.body.requests[0].sectionId,passage.id);
  assert.deepEqual(et.body.requests[0].words,[passage.text]);
  const id=pendingRequests(b)[0][0];
  assert.equal((await b.teacher('teacherWt','rashi-approve',{classId:'wt',requestId:id,grade:95})).code,403);
  assert.equal((await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:id})).code,400,'numeric grade required');
  assert.equal((await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:id,grade:'',feedback:'Good'})).code,400);
  const yes=await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:id,grade:95,feedback:'Well read!'});
  assert.equal(yes.code,200,JSON.stringify(yes.body));
  assert.equal(balance(b,'rs1'),10);
  const state=(await b.status('kid1')).body.sections[passage.id];
  assert.equal(state.status,'approved');assert.equal(state.grade,95);assert.equal(state.feedback,'Well read!');
  assert.equal((await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:id,grade:95})).body.alreadyHandled,true);
  assert.equal(balance(b,'rs1'),10);
});
test('daily quota is shared across all legacy and Vayeira readings, including rejected attempts',async()=>{
  const b=makeBackend(seed()),p=require('../backend/functions/vayeira-rashi.json').passages;
  for(const id of ['zayin','bet',p[0].id]){
    const r=await b.submit('kid1',id);assert.equal(r.code,200,JSON.stringify(r.body));
  }
  const fourth=await b.submit('kid1',p[1].id);
  assert.equal(fourth.code,429);
  assert.equal(fourth.body.dailyLimit,3);
  assert.equal(b.db.getAt('rashiLetters/dailySubmissions/kid1/'+(()=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return parts.year+'-'+parts.month+'-'+parts.day;})())?.count,3);
  assert.equal(Object.keys(b.files).length,3,'blocked upload must never be saved');
  const first=pendingRequests(b).find(([,r])=>r.sectionId==='zayin')[0];
  await b.teacher('teacherEt','rashi-reject',{classId:'et',requestId:first});
  assert.equal((await b.submit('kid1','zayin')).code,429,'teacher rejection does not refund daily quota');
  assert.equal((await b.submit('kid2',p[0].id)).code,200,'different student gets an independent allowance');
});
test('four simultaneous Rashi section submissions accept at most three',async()=>{
  const b=makeBackend(seed());
  const out=await Promise.all(['zayin','bet','tsadi','alef'].map(id=>b.submit('kid1',id)));
  assert.equal(out.filter(r=>r.code===200).length,3);
  assert.equal(out.filter(r=>r.code===429).length,1);
  assert.equal(Object.keys(b.files).length,3);
  assert.equal(pendingRequests(b).length,3);
});

// ---------- Letter marks (2026-11-22): sending costs 2, 5 parts x 1 point, per-letter scores ----------
const LM=require('../backend/functions/rashi-letter-marks-core.cjs');
const marks=(b,token,id,missed,extra={})=>b.teacher(token,'rashi-letter-marks',{classId:token==='teacherWt'?'wt':'et',requestId:id,missed,...extra});
// 20 letters: 4 per part. Letters are numbered 0-19 in reading order.
const TEXT20='אבגד הוזח טיכל מנסע עפצק';
const sendText=(b,token,section,text=TEXT20)=>b.submit(token,section,{query:{words:text.split(' ').join('|')}});

test('core: letters keep their vowels, finals count as their own letters, 5 equal parts, 27 letter keys',()=>{
  assert.equal(LM.LETTER_KEYS.length,27);assert.equal(new Set(LM.LETTER_KEYS).size,27);
  const tk=LM.tokenize('שָׁלוֹם: בְּרֵאשִׁית');
  assert.equal(tk.total,10);assert.equal(tk.words[0][0].text,'שָׁ');assert.equal(tk.words[0][3].key,'ם');assert.equal(tk.words[0][4].letter,false);
  assert.equal(tk.words[1][0].key,'ב');
  assert.equal(JSON.stringify(LM.partBounds(20)),'[[0,4],[4,8],[8,12],[12,16],[16,20]]');
  assert.equal(JSON.stringify(LM.partBounds(18)),'[[0,3],[3,7],[7,10],[10,14],[14,18]]');
  const perfect=LM.score(TEXT20,[]);assert.equal(perfect.points,5);assert.equal(perfect.pct,100);
  const two=LM.score(TEXT20,[0,19]);assert.equal(two.points,3);assert.equal(JSON.stringify(two.partsClean),'[false,true,true,true,false]');
  assert.equal(LM.score(TEXT20,[0,1,2,3]).points,4,'many misses in one part still cost one point');
  assert.equal(LM.score(TEXT20,Array.from({length:20},(_,i)=>i)).points,0);
  assert.equal(LM.score('אב',[]).points,5,'a very short text can still be perfect');
  assert.equal(LM.score('אב',[1]).points,1,'empty parts earn nothing when something was missed');
  assert.throws(()=>LM.score(TEXT20,[20]),/not in this reading/);assert.throws(()=>LM.score(TEXT20,[1.5]));assert.throws(()=>LM.score('123',[]),/no Hebrew letters/);
  assert.equal(LM.score(TEXT20,[0]).letters['א'].missed,1);assert.equal(LM.score(TEXT20,[0]).letters['א'].seen,1);
});
test('client and both server copies of the letter core are identical',()=>{
  const fs=require('node:fs'),a=fs.readFileSync('rashi-letters/rashi-letter-marks-core.js','utf8');
  assert.equal(fs.readFileSync('backend/functions/rashi-letter-marks-core.cjs','utf8'),a);
  assert.equal(fs.readFileSync('backend/functions-staging/rashi-letter-marks-core.cjs','utf8'),a);
});
test('sending a recording costs 2 points once; a double send never charges twice',async()=>{
  const b=makeBackend(seed());
  const [x,y]=await Promise.all([sendText(b,'kid1','zayin'),sendText(b,'kid1','zayin')]);
  assert.ok([x,y].every(r=>r.code===200));
  assert.equal(balance(b,'rs1'),8);
  await sendText(b,'kid1','zayin');assert.equal(balance(b,'rs1'),8);
  const rec=b.db.getAt('rashiLetters/recordings/kid1/zayin');assert.equal(rec.v2,true);assert.equal(rec.submitCharged,true);
  const charge=Object.values(b.db.getAt('studentRewards/pointRequests')).find(r=>r.source==='rashi-letters-submit');
  assert.equal(charge.amount,-2);assert.equal(charge.status,'approved');
  await sendText(b,'kid2','zayin');assert.equal(balance(b,'rs2'),-2,'like Posuk Practice, the charge may go below zero');
});
test('marking letters: each clean part earns 1 point (5 = perfect), net of the 2 paid to send',async()=>{
  const b=makeBackend(seed());await sendText(b,'kid1','zayin');
  const id=pendingRequests(b)[0][0];
  const r=await marks(b,'teacherEt',id,[0,19]);
  assert.equal(r.code,200,JSON.stringify(r.body));assert.equal(r.body.paidTotal,3);assert.equal(r.body.points,3);assert.equal(balance(b,'rs1'),11);
  const rec=b.db.getAt('rashiLetters/recordings/kid1/zayin');
  assert.equal(rec.status,'approved');assert.equal(rec.pointsPaid,3);assert.equal(rec.letterReview.total,20);assert.equal(JSON.stringify(rec.letterReview.missed),'[0,19]');
  const st=(await b.status('kid1')).body.sections.zayin;assert.equal(st.status,'approved');assert.equal(st.points,3);assert.equal(st.letterMode,true);
  const item=b.db.getAt('studentRewards/pointRequests/'+id);assert.equal(item.status,'approved');assert.equal(item.pointsPaid,3);
});
test('student sees the teacher marks (missed letters, parts, points) and his own letter scores; a later change shows the new marks',async()=>{
  const b=makeBackend(seed());await sendText(b,'kid1','zayin');
  const id=pendingRequests(b)[0][0];
  assert.equal((await b.status('kid1')).body.sections.zayin.review,null,'nothing to show before grading');
  await marks(b,'teacherEt',id,[0,19]);
  const st=(await b.status('kid1')).body.sections.zayin;
  assert.equal(st.review.total,20);assert.equal(JSON.stringify(st.review.missed),'[0,19]');assert.equal(st.review.points,3);
  assert.equal(st.review.partsClean.length,5);assert.equal(st.review.partsClean.filter(Boolean).length,3);assert.ok(st.review.words.length>0);
  const mine=await b.call({headers:{authorization:'Bearer kid1'},body:{action:'rashi-student-letters'}});
  assert.equal(mine.code,200);assert.equal(mine.body.readings,1);
  const seen=Object.values(mine.body.letters).reduce((n,r)=>n+r.seen,0),missed=Object.values(mine.body.letters).reduce((n,r)=>n+r.missed,0);
  assert.equal(seen,20);assert.equal(missed,2);
  const other=await b.call({headers:{authorization:'Bearer kid2'},body:{action:'rashi-student-letters'}});
  assert.equal(other.body.readings,0,'another boy never sees these scores');
  const noAuth=await b.call({headers:{},body:{action:'rashi-student-letters'}});assert.ok(noAuth.code>=400);
  await marks(b,'teacherEt',id,[5]);
  const after=(await b.status('kid1')).body.sections.zayin;assert.equal(JSON.stringify(after.review.missed),'[5]');
  assert.equal((await b.call({headers:{authorization:'Bearer kid1'},body:{action:'rashi-student-letters'}})).body.readings,1);
});
test('a perfect reading needs no taps: saving with nothing marked pays 5',async()=>{
  const b=makeBackend(seed());await sendText(b,'kid1','bet');
  const id=pendingRequests(b)[0][0];
  const r=await marks(b,'teacherEt',id,[]);assert.equal(r.body.paidTotal,5);assert.equal(balance(b,'rs1'),13);
});
test('changing the marks adjusts the points and never pays twice',async()=>{
  const b=makeBackend(seed());await sendText(b,'kid1','alef');
  const id=pendingRequests(b)[0][0];
  await marks(b,'teacherEt',id,[]);assert.equal(balance(b,'rs1'),13);
  const down=await marks(b,'teacherEt',id,[0,5,10]);assert.equal(down.body.points,-3);assert.equal(balance(b,'rs1'),10);
  const same=await marks(b,'teacherEt',id,[0,5,10]);assert.equal(same.body.points,0);assert.equal(balance(b,'rs1'),10);
  const back=await marks(b,'teacherEt',id,[]);assert.equal(back.body.points,3);assert.equal(balance(b,'rs1'),13);
  const par=await Promise.all([marks(b,'teacherEt',id,[0]),marks(b,'teacherEt',id,[0,5,10,15])]);
  assert.ok(par.every(x=>[200,409].includes(x.code)));
  const paid=b.db.getAt('rashiLetters/recordings/kid1/alef').pointsPaid;
  assert.equal(balance(b,'rs1'),8+paid,'balance always equals the saved points');
  assert.equal(b.db.getAt('studentRewards/pointRequests/'+id).pointsPaid,paid);
});
test('marks are checked: whole letter numbers inside the text, own class only, teachers only',async()=>{
  const b=makeBackend(seed());await sendText(b,'kid1','bet');
  const id=pendingRequests(b)[0][0];
  for(const bad of [[20],[-1],[1.5],['a'],'0',{}])assert.equal((await marks(b,'teacherEt',id,bad)).code,400,JSON.stringify(bad));
  assert.equal((await marks(b,'teacherWt',id,[])).code,403);
  assert.equal((await b.teacher('kid1','rashi-letter-marks',{requestId:id,missed:[]})).code,401);
  assert.equal(balance(b,'rs1'),8);assert.equal(b.db.getAt('rashiLetters/recordings/kid1/bet').status,'pending');
});
test('an old recording cannot be marked once a newer one exists (rejected then re-sent)',async()=>{
  const b=makeBackend(seed());await sendText(b,'kid1','samech');
  const first=pendingRequests(b)[0][0];
  await b.teacher('teacherEt','rashi-reject',{classId:'et',requestId:first});
  await sendText(b,'kid1','samech');
  const stale=await marks(b,'teacherEt',first,[]);assert.equal(stale.code,409);
  const second=pendingRequests(b).find(([id])=>id!==first)[0];
  assert.equal((await marks(b,'teacherEt',second,[])).body.paidTotal,5);
});
test('recent list keeps graded readings with their marks; legacy bulk approve still works and gives +2 with no letter data',async()=>{
  const b=makeBackend(seed());await sendText(b,'kid1','zayin');await sendText(b,'kid1','bet');
  const [[a],[c]]=[pendingRequests(b)[0],pendingRequests(b)[1]];
  await marks(b,'teacherEt',a,[3]);
  const listed=await b.teacher('teacherEt','rashi-list-pending',{classId:'et'});
  assert.equal(listed.body.requests.length,1);assert.equal(listed.body.requests[0].id,c);assert.equal(listed.body.requests[0].v2,true);
  assert.equal(listed.body.recent.length,1);assert.equal(listed.body.recent[0].id,a);assert.equal(JSON.stringify(listed.body.recent[0].letterReview.missed),'[3]');
  const before=balance(b,'rs1');
  const legacy=await b.teacher('teacherEt','rashi-approve',{classId:'et',requestId:c});assert.equal(legacy.body.status,'approved');assert.equal(balance(b,'rs1'),before+2);
  assert.equal((await b.teacher('teacherEt','rashi-list-pending',{classId:'et'})).body.recent.length,1,'no letter data, so not in the recent list');
});
test('each boy gets running letter scores over all his graded readings, per class scope',async()=>{
  const b=makeBackend(seed());
  await sendText(b,'kid1','zayin');await sendText(b,'kid1','bet','אבגד הוזח טיכל מנסע');
  const ids=pendingRequests(b).map(([id])=>id);
  await marks(b,'teacherEt',ids[0],[0,1]);await marks(b,'teacherEt',ids[1],[0]);   // alef missed twice out of two, bet missed once of two
  const out=await b.teacher('teacherEt','rashi-letter-stats',{classId:'et',studentIds:['kid1','kid2']});
  assert.equal(out.code,200,JSON.stringify(out.body));
  const k1=out.body.students.kid1;assert.equal(k1.readings,2);
  assert.equal(k1.letters['א'].seen,2);assert.equal(k1.letters['א'].missed,2);assert.equal(k1.letters['ב'].seen,2);assert.equal(k1.letters['ב'].missed,1);assert.equal(k1.letters['ג'].missed,0);
  assert.equal(out.body.students.kid2,undefined,'another class is not shown');
  await marks(b,'teacherEt',ids[0],[]);   // changing the marks changes the totals (no double counting)
  const again=(await b.teacher('teacherEt','rashi-letter-stats',{classId:'et',studentIds:['kid1']})).body.students.kid1;
  assert.equal(again.letters['א'].missed,1);assert.equal(again.letters['ב'].missed,0);
  assert.equal((await b.teacher('kid1','rashi-letter-stats',{studentIds:['kid1']})).code,401);
});
test('weekly Nigri Rashi mark = letters read correctly out of all letters read that week; older grades still count',async()=>{
  const b=makeBackend(seed());await sendText(b,'kid1','zayin');await sendText(b,'kid1','bet','אבגד הוזח');   // 20 letters and 8 letters
  const ids=pendingRequests(b).map(([id])=>id);
  await marks(b,'teacherEt',ids[0],[0,1,2,3,4]);   // 15/20 correct = 75
  await marks(b,'teacherEt',ids[1],[]);           // 8/8 = 100
  const out=await b.teacher('teacherEt','rashi-week-grades',{classId:'et',studentIds:['kid1'],from:Date.now()-3*864e5,to:Date.now()+864e5});
  assert.equal(out.code,200,JSON.stringify(out.body));
  const g=out.body.students.kid1.graded.map(x=>[x.grade,x.weight]).sort((x,y)=>x[1]-y[1]);
  assert.equal(JSON.stringify(g),'[[100,8],[75,20]]');
  const weekly=require('../shared/weekly-practice-marks-core.js');
  const range=weekly.weekRange(weekly.nyDateIso(Date.now()));
  const mark=weekly.collectStudent({rashi:out.body.students.kid1.graded.map(x=>({...x,gradedAt:range.from+1}))},range).rashi;
  assert.equal(mark.mark,Math.round((15+8)/28*100),'pooled over letters, not an average of two readings');assert.equal(mark.n,2);
  // an older reading graded 0-100 with no weight counts as one reading
  const old=weekly.collectStudent({rashi:[{grade:80,gradedAt:range.from+1}]},range).rashi;assert.equal(old.mark,80);
});
test('grading later never moves a reading into another Nigri week',async()=>{
  const b=makeBackend(seed());await sendText(b,'kid1','zayin');
  const id=pendingRequests(b)[0][0];await marks(b,'teacherEt',id,[]);
  const first=b.db.getAt('rashiLetters/recordings/kid1/zayin').gradedAt;
  await new Promise(r=>setTimeout(r,5));await marks(b,'teacherEt',id,[1]);
  assert.equal(b.db.getAt('rashiLetters/recordings/kid1/zayin').gradedAt,first);
});

// ---------- Record again below 5, and teacher Delete (2026-11-22) ----------
const requestsFor=(b,section)=>pendingRequests(b).filter(([,r])=>r.sectionId===section).map(([id])=>id);
test('a reading that earned less than 5 can be recorded again (costs 2 again); earned points are never paid twice',async()=>{
  const b=makeBackend(seed());await sendText(b,'kid1','zayin');
  const first=requestsFor(b,'zayin')[0];
  await marks(b,'teacherEt',first,[0,19]);                         // 3 of 5
  assert.equal(balance(b,'rs1'),8+3);
  let st=(await b.status('kid1')).body.sections.zayin;assert.equal(st.status,'approved');assert.equal(st.points,3);assert.equal(st.canRerecord,true);
  const again=await sendText(b,'kid1','zayin');
  assert.equal(again.code,200,JSON.stringify(again.body));assert.equal(again.body.status,'pending');assert.equal(again.body.attempt,2);
  assert.equal(balance(b,'rs1'),9,'sending again costs 2 again');
  assert.equal(b.db.getAt('rashiLetters/recordings/kid1/zayin').priorPoints,3);
  assert.ok(b.db.getAt('rashiLetters/recordingHistory/kid1/zayin'),'the first attempt is kept for the record');
  const second=requestsFor(b,'zayin').find(id=>id!==first);
  assert.equal((await marks(b,'teacherEt',first,[])).code,409,'the first attempt can no longer be changed');
  const r2=await marks(b,'teacherEt',second,[0]);                  // 4 parts clean now, already had 3: pays 1 more
  assert.equal(r2.body.parts,4);assert.equal(r2.body.paidTotal,1);assert.equal(balance(b,'rs1'),10);
  st=(await b.status('kid1')).body.sections.zayin;assert.equal(st.points,4);assert.equal(st.canRerecord,true);
  await sendText(b,'kid1','zayin');
  const third=requestsFor(b,'zayin').find(id=>id!==first&&id!==second);
  assert.equal((await marks(b,'teacherEt',third,[])).body.paidTotal,1,'a perfect third send adds only the missing point');
  assert.equal(balance(b,'rs1'),10-2+1);
  st=(await b.status('kid1')).body.sections.zayin;assert.equal(st.points,5);assert.equal(st.canRerecord,false);
  const blocked=await sendText(b,'kid1','zayin');assert.equal(blocked.body.alreadySubmitted,true);assert.equal(balance(b,'rs1'),9,'a perfect 5 is final');
});
test('a worse second send never takes points away from the best one', async()=>{
  const b=makeBackend(seed());await sendText(b,'kid1','bet');
  const first=requestsFor(b,'bet')[0];await marks(b,'teacherEt',first,[0,5,10,15]);   // 1 of 5
  await sendText(b,'kid1','bet');const second=requestsFor(b,'bet').find(id=>id!==first);
  const r=await marks(b,'teacherEt',second,[0,5,10,15,19]);assert.equal(r.body.paidTotal,0);
  assert.equal(b.db.getAt('rashiLetters/recordings/kid1/bet').bestPoints,1);
  assert.equal(balance(b,'rs1'),10-2-2+1);
});
test('Delete refunds the 2 points, takes back earned points, removes it from letter scores and lets him send again',async()=>{
  const b=makeBackend(seed());await sendText(b,'kid1','alef');
  const id=requestsFor(b,'alef')[0];
  await marks(b,'teacherEt',id,[0,19]);assert.equal(balance(b,'rs1'),11);
  const del=await b.teacher('teacherEt','rashi-delete',{classId:'et',requestId:id});
  assert.equal(del.code,200,JSON.stringify(del.body));assert.equal(del.body.refunded,2);assert.equal(del.body.takenBack,3);
  assert.equal(balance(b,'rs1'),10,'back to where he started');
  const rec=b.db.getAt('rashiLetters/recordings/kid1/alef');assert.equal(rec.status,'deleted');assert.ok(!rec.letterReview);
  const refund=Object.values(b.db.getAt('studentRewards/pointRequests')).find(r=>r.source==='rashi-letters-submit'&&r.amount===2);assert.ok(refund);
  const again=await b.teacher('teacherEt','rashi-delete',{classId:'et',requestId:id});assert.equal(again.body.alreadyDeleted,true);assert.equal(balance(b,'rs1'),10,'pressing Delete twice refunds once');
  const listed=(await b.teacher('teacherEt','rashi-list-pending',{classId:'et'})).body;assert.equal(listed.requests.length,0);assert.equal(listed.recent.length,0);
  assert.equal(Object.keys((await b.teacher('teacherEt','rashi-letter-stats',{classId:'et',studentIds:['kid1']})).body.students.kid1.letters).length,0);
  const week=(await b.teacher('teacherEt','rashi-week-grades',{classId:'et',studentIds:['kid1'],from:Date.now()-3*864e5,to:Date.now()+864e5})).body.students.kid1;
  assert.equal(week.graded.length,0);assert.equal(week.pending,0);
  assert.equal((await b.status('kid1')).body.sections.alef.status,'none');
  const resend=await sendText(b,'kid1','alef');assert.equal(resend.code,200,JSON.stringify(resend.body));assert.equal(resend.body.status,'pending');
  assert.equal(balance(b,'rs1'),8);
});
test('Delete of a waiting recording refunds 2; delete is for teachers of that class only; an old attempt cannot be deleted',async()=>{
  const b=makeBackend(seed());await sendText(b,'kid1','samech');await sendText(b,'kid2','samech');
  const kid1Id=pendingRequests(b).find(([,r])=>r.practiceStudentId==='kid1')[0];
  assert.equal((await b.teacher('teacherWt','rashi-delete',{classId:'wt',requestId:kid1Id})).code,403);
  assert.equal((await b.teacher('kid1','rashi-delete',{requestId:kid1Id})).code,401);
  assert.equal(balance(b,'rs1'),8);
  const del=await b.teacher('teacherEt','rashi-delete',{classId:'et',requestId:kid1Id});assert.equal(del.body.refunded,2);assert.equal(balance(b,'rs1'),10);
  assert.equal(b.db.getAt('studentRewards/pointRequests/'+kid1Id).status,'rejected');
  await sendText(b,'kid1','samech');                                    // a new attempt exists
  assert.equal((await b.teacher('teacherEt','rashi-delete',{classId:'et',requestId:kid1Id})).code,409,'an old attempt can no longer be deleted once a newer one exists');
  assert.equal(balance(b,'rs1'),8);
});
test('deleting a re-sent attempt keeps the points earned before it',async()=>{
  const b=makeBackend(seed());await sendText(b,'kid1','shin');
  const first=requestsFor(b,'shin')[0];await marks(b,'teacherEt',first,[0,19]);      // earned 3
  await sendText(b,'kid1','shin');const second=requestsFor(b,'shin').find(id=>id!==first);
  const bal=balance(b,'rs1');                                                       // 10 - 2 + 3 - 2 = 9
  await b.teacher('teacherEt','rashi-delete',{classId:'et',requestId:second});
  assert.equal(balance(b,'rs1'),bal+2,'only the second 2-point charge is refunded');
  await sendText(b,'kid1','shin');const third=requestsFor(b,'shin').find(id=>id!==first&&id!==second);
  assert.equal(b.db.getAt('rashiLetters/recordings/kid1/shin').priorPoints,3,'the 3 earned on the first send are still remembered');
  assert.equal((await marks(b,'teacherEt',third,[])).body.paidTotal,2);
});
test('Delete gives back the reading slot of the day (3 per day), so a bad recording does not use one up',async()=>{
  const b=makeBackend(seed());
  for(const sec of ['zayin','bet','alef'])await sendText(b,'kid1',sec);
  assert.equal((await sendText(b,'kid1','tsadi')).code,429,'the 4th reading today is refused');
  const id=requestsFor(b,'bet')[0];await b.teacher('teacherEt','rashi-delete',{classId:'et',requestId:id});
  const ok=await sendText(b,'kid1','tsadi');assert.equal(ok.code,200,JSON.stringify(ok.body));
});

test('closed by default: a boy cannot send a Rashi reading, nothing is saved or charged',async()=>{
  const b=makeBackend(seed(false)),r=await b.submit('kid1','zayin');
  assert.equal(r.code,403,JSON.stringify(r.body));assert.equal(r.body.closed,true);
  assert.equal(pendingRequests(b).length,0);assert.equal(Object.keys(b.files).length,0);assert.equal(balance(b,'rs1'),10);
  const status=await b.status('kid1');assert.equal(status.body.open.zayin,false);assert.equal(status.body.open['vayeira-18-1'],false);
});
test('open for the class or for one boy only, and a Vayeira perek opens its passages',async()=>{
  const seedWith=submissionOpen=>{const d=seed(false);d.b3Games.workspaces['b3-2026'].classes.et.submissionOpen=submissionOpen;return d;};
  const one=makeBackend(seedWith({students:{kid1:{items:{'r:zayin':true}}}}));
  assert.equal((await one.submit('kid1','zayin')).code,200);
  assert.equal((await one.submit('kid1','bet')).code,403,'only the opened item');
  const other=makeBackend(seedWith({students:{somebodyElse:{items:{'r:zayin':true}}}}));
  assert.equal((await other.submit('kid1','zayin')).code,403,'open for another boy is not open for him');
  const cls=makeBackend(seedWith({items:{'r:bet':true,'r:vayeira-18':true}}));
  assert.equal((await cls.submit('kid1','bet')).code,200);
  const st=await cls.status('kid1');assert.equal(st.body.open.bet,true);assert.equal(st.body.open['vayeira-18-1'],true);assert.equal(st.body.open['vayeira-19-1'],false);assert.equal(st.body.open.zayin,false);
  const wt=makeBackend(seedWith({items:{'r:bet':true}}));
  assert.equal((await wt.submit('kid2','bet')).code,403,'the other class stays closed');
});
test('Posuk: sending is refused unless the posuk is open; the status call names what is open',async()=>{
  const posuk=(b,token,selectionKey)=>b.call({headers:{authorization:'Bearer '+token},body:{action:'posuk-submit',selectionKey,attemptId:'a1',hebrewText:'x',sefer:'Bereishis'}});
  const status=(b,token,selectionKey)=>b.call({headers:{authorization:'Bearer '+token},body:{action:'submission-open-status',kind:'posuk',selectionKey}});
  const closed=makeBackend(seed(false));
  const refused=await posuk(closed,'kid1','Vayeira_18_1');
  assert.equal(refused.code,403,JSON.stringify(refused.body));assert.equal(refused.body.closed,true);
  const d=seed(false);d.b3Games.workspaces['b3-2026'].classes.et.submissionOpen={items:{'p:Vayeira_18_1-3':true}};
  const b=makeBackend(d);
  assert.notEqual((await posuk(b,'kid1','Vayeira_18_2')).code,403,'open: gets past the check (then fails only because no recording was uploaded)');
  assert.equal((await posuk(b,'kid1','Vayeira_18_2-4')).code,403,'a range must be fully open');
  assert.equal((await posuk(b,'kid1','Vayeira_19_1')).code,403);
  const ok=await status(b,'kid1','Vayeira_18_3');assert.equal(ok.body.selectionOpen,true);assert.equal(ok.body.rules[0].label,'Vayeira · Perek 18 · Posuk 1–3');
  assert.equal((await status(b,'kid1','Vayeira_18_9')).body.selectionOpen,false);
  assert.equal((await status(b,'kid2','Vayeira_18_2')).body.selectionOpen,false,'WT is still closed');
  assert.equal((await b.call({headers:{},body:{action:'submission-open-status',kind:'posuk'}})).code,401);
});
test('the teacher list says which waiting readings are for open items; sent ones stay listed',async()=>{
  const d=seed(true);const b=makeBackend(d);
  assert.equal((await b.submit('kid1','zayin')).code,200);
  b.db.root.b3Games.workspaces['b3-2026'].classes.et.submissionOpen={items:{'r:bet':true}}; // zayin closed again after it was sent
  const rows=(await b.teacher('teacherEt','rashi-list-pending')).body.requests;
  assert.equal(rows.length,1);assert.equal(rows[0].sendOpen,false);
  b.db.root.b3Games.workspaces['b3-2026'].classes.et.submissionOpen={items:{'r:zayin':true}};
  assert.equal((await b.teacher('teacherEt','rashi-list-pending')).body.requests[0].sendOpen,true);
});
