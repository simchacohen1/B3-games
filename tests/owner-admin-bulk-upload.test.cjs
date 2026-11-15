'use strict';
// Owner Admin bulk CSV upload (Issue #706): runs the real script block from
// owner-admin.html, wired to the real funTorahManageStudents core over an
// in-memory database. Synthetic data only.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {manageStudents}=require('../backend/functions/student-management-core.cjs');
const {studentAuth}=require('../backend/functions/student-auth-core.cjs');
const R=require('../bulk-roster.js');
const {legacyCreate}=require('./helpers/legacy-create.cjs');

const html=fs.readFileSync('owner-admin.html','utf8');
const block=html.slice(html.indexOf('// ---- Bulk upload '),html.indexOf('// ---- End bulk upload '));
const OWNER={uid:'owner_uid',email:'simcha5770@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};

function harness(){
 const tree={b3Games:{students:{},workspaces:{'b3-2026':{classes:{
  b2_et_morning:{name:'B2 ET · Morning',active:true},b2_et_afternoon:{name:'B2 ET · Afternoon',active:true}
 }}}},b3Private:{passcodes:{}}};
 const parts=p=>p.split('/').filter(Boolean);
 const store={get:async p=>{const v=parts(p).reduce((o,k)=>o?.[k],tree);return v===undefined?null:structuredClone(v)},
  update:async u=>{for(const [p,v] of Object.entries(u)){const k=parts(p),last=k.pop();let o=tree;for(const x of k)o=o[x]??={};if(v===null)delete o[last];else o[last]=structuredClone(v);}},
  tx:async(p,f)=>{const v=f(await store.get(p));if(v!==undefined)await store.update({[p]:v});return {committed:true}}};
 const calls=[];
 const fetch=async(url,opts)=>{
  const body=JSON.parse(opts.body);calls.push({url,action:body.action,auth:opts.headers.Authorization});
  try{const r=await manageStudents(store,OWNER,body);return {ok:true,json:async()=>r};}
  catch(e){return {ok:false,json:async()=>({error:e.message})};}
 };
 const els={};
 const el=id=>els[id]??={id,style:{},value:'',textContent:'',innerHTML:'',disabled:false,files:[],scrollTop:0,scrollHeight:0,querySelectorAll:()=>[],insertAdjacentHTML(){} ,remove(){}};
 const downloads=[];
 const scope={current:null}; // the school that is open in Owner Admin; null = no school scoping
 const ctx={q:el,fetch,WS:'b3-2026',schoolScope:()=>scope.current,classData:tree.b3Games.workspaces['b3-2026'].classes,
  auth:{currentUser:{getIdToken:async()=>'owner-token'}},
  firebase:{app:()=>({options:{projectId:'b3-games'}}),database:{ServerValue:{TIMESTAMP:{'.sv':'timestamp'}}}},
  safe:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
  load:async()=>{},confirm:()=>true,FTTBulkRoster:R,
  AbortSignal:{timeout:()=>undefined},
  FileReader:class{readAsText(f){Promise.resolve().then(()=>this.onload({target:{result:f.text}}));}},
  document:{createElement:()=>({click(){downloads.push(1)}})},
  URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}},Blob:class{},
  console,setTimeout,Date,JSON,Object,Promise,Math,Set};
 vm.createContext(ctx);vm.runInContext(block,ctx);
 const settle=()=>new Promise(r=>setTimeout(r,20));
 return {tree,store,el,calls,ctx,scope,
  check:async(text,name='roster.csv')=>{el('bulkFile').files=[{text,name}];el('bulkPreview').onclick();await settle();},
  importNow:async()=>{await el('bulkImport').onclick();await settle();}};
}
const csv=rows=>['Type,Name,Email,Passcode,Classes',...rows].join('\n');
const named=(h,n)=>Object.values(h.tree.b3Games.students).filter(s=>s.profile?.name===n);

test('owner-admin inline scripts parse and load bulk-roster.js',()=>{
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
 assert.match(html,/<script src="bulk-roster\.js\?v=[^"]+"><\/script>/);
 assert.ok(block.length>1000,'bulk upload block must exist');
});
test('template download is the new one-row-per-person format',()=>{
 assert.equal(R.TEMPLATE_ROWS[0],'Type,Name,Email,Passcode,Classes,Student ID');
 assert.ok(R.TEMPLATE_ROWS.some(r=>/^Student,.*;/.test(r)),'a student row with several classes');
});
test('the Moshe case: one row with two classes makes ONE account that can sign in',async()=>{
 const h=harness();
 await h.check(csv(['Student,Moshe Fict,,482731,B2 ET Morning; B2 ET Afternoon']));
 assert.equal(h.el('bulkImport').disabled,false,h.el('bulkSummary').innerHTML);
 assert.match(h.el('bulkSummary').innerHTML,/1 new student/);
 await h.importNow();
 assert.match(h.el('bulkProgress').textContent,/Done! 1 student\(s\) created/);
 const s=named(h,'Moshe Fict');assert.equal(s.length,1);assert.equal(Object.keys(s[0].memberships).length,2);
 const r=await studentAuth(h.store,{action:'login',name:'Moshe Fict',pin:'482731'},'1.1.1.1',Date.now());
 assert.equal(r.ok,true);
 assert.ok(h.calls.every(c=>c.auth==='Bearer owner-token'));
 assert.deepEqual(h.calls.map(c=>c.action),['importPreview','importApply']);
});
test('old-format file (one row per class) also makes one account per child',async()=>{
 const h=harness();
 await h.check('type,name,email,passcode,class\nstudent,Old Format,,654321,B2 ET Morning\nstudent,Old Format,,654321,B2 ET Afternoon');
 await h.importNow();
 assert.equal(named(h,'Old Format').length,1);
});
test('passcodes are never shown on screen',async()=>{
 const h=harness();
 await h.check(csv(['Student,Secret Kid,,909192,B2 ET Morning']));
 assert.equal((h.el('bulkSummary').innerHTML+h.el('bulkTable').innerHTML).includes('909192'),false);
});
test('a file with problems cannot be imported and nothing is sent to the server',async()=>{
 const h=harness();
 await h.check(csv(['Student,Bad Kid,,12,B2 ET Morning']));
 assert.equal(h.el('bulkImport').disabled,true);assert.match(h.el('bulkSummary').innerHTML,/6 digits/);
 assert.equal(h.calls.length,0);
});
test('importing the same file twice adds nothing',async()=>{
 const h=harness(),text=csv(['Student,Twice Kid,,121314,B2 ET Morning; B2 ET Afternoon']);
 await h.check(text);await h.importNow();
 await h.check(text);
 assert.match(h.el('bulkSummary').innerHTML,/0 new student/);
 assert.match(h.el('bulkSummary').innerHTML,/1 already done/);
 await h.importNow();
 assert.equal(named(h,'Twice Kid').length,1);
});

// ---- Undo CSV Import card -------------------------------------------------------
test('Undo CSV Import: tick both import runs, review, one confirmation; earlier students and saved work stay; can be put back',async()=>{
 const h=harness(),ws=h.tree.b3Games.workspaces['b3-2026'];
 // On the site before any import: same name as an imported child, with saved work.
 h.tree.b3Games.students.old_moshe={profile:{id:'old_moshe',name:'Moshe Fict',active:true,createdAt:1},memberships:{'b3-2026_b2_et_morning':{workspaceId:'b3-2026',classId:'b2_et_morning',active:true}},halacha:{done:4}};
 ws.classes.b2_et_morning.members={old_moshe:{studentId:'old_moshe',name:'Moshe Fict',active:true}};
 ws.classes.b2_et_morning.managementAudit={a0:{action:'add',studentId:'old_moshe',teacherUid:'owner_uid',at:5}};
 h.tree.b3Private.passcodes.old_moshe={passcode:'482731'};
 const before=JSON.stringify(h.tree.b3Games.students.old_moshe);
 // Two runs of the OLD importer (one account per class row), hours apart.
 const t1=Date.parse('2026-11-09T02:18:37Z'),t2=Date.parse('2026-11-09T17:49:11Z');
 for(let i=0;i<12;i++)await legacyCreate(h.store,OWNER,{classId:i%2?'b2_et_morning':'b2_et_afternoon',name:i<2?'Moshe Fict':'Run One '+(i>>1),passcode:String(400000+(i>>1))},t1+i*100);
 for(let i=0;i<11;i++)await manageStudents(h.store,OWNER,{action:'create',classId:'b2_et_afternoon',name:'Run Two '+i,passcode:String(500000+i)},t2+i*100);
 // One imported child already did some work: must be kept.
 const worked=named(h,'Run Two 3')[0].profile.id;
 h.tree.b3Quiz={scores:{[worked]:{w1:9}}};
 assert.equal(Object.keys(h.tree.b3Games.students).length,24);

 await h.ctx.undoLoad();
 const ids=[...h.el('undoBatches').innerHTML.matchAll(/data-undo-batch="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids.length,2,'both import runs are listed');
 assert.match(h.el('undoBatches').innerHTML,/12 accounts in 2 class/);
 await h.ctx.undoReview();
 assert.match(h.el('status').textContent,/Tick the import/);
 ids.forEach(id=>h.ctx.undoToggle(id,true));
 await h.ctx.undoReview();
 const review=h.el('rbArea').innerHTML;
 assert.match(review,/<b>22<\/b> account\(s\) made by the import will be removed/);
 assert.match(review,/<b>1<\/b> kept for you to review/);
 assert.match(review,/<b>1<\/b> other student account\(s\) are not touched/);
 assert.match(review,/Had students before\. They stay\./);
 assert.match(review,/Classes \(2\): none are deleted/);
 assert.match(review,/b2_et_afternoon\)<\/small><\/td><td[^>]*>17<\/td><td[^>]*>16<\/td><td[^>]*>1<\/td><td><small>Had no students before the import/,'one class row for both runs');
 assert.ok(!/482731|400000|500000/.test(review),'no passcodes on screen');
 assert.ok(!review.includes('old_moshe'),'the earlier student is not in the undo list');

 // Nothing happens without the backup or with the wrong words.
 await h.el('rbRun').onclick();
 assert.match(h.el('status').textContent,/Download the backup first/);
 await h.el('rbBackup').onclick();
 h.el('rbConfirm').value='UNDO 21';await h.el('rbRun').onclick();
 assert.match(h.el('status').textContent,/Type UNDO 22/);
 assert.equal(Object.keys(h.tree.b3Games.students).length,24,'nothing removed yet');
 assert.ok(!h.calls.some(c=>c.action==='rollbackExecute'));

 h.el('rbConfirm').value='undo 22';await h.el('rbRun').onclick();
 assert.match(h.el('rbArea').innerHTML,/Done\.<\/b> 22 account\(s\) removed, 0 put back as before, 1 kept for review/);
 assert.equal(h.calls.filter(c=>c.action==='rollbackExecute').length,2);
 assert.equal((h.el('undoBatches').innerHTML.match(/already undone/g)||[]).length,2,'undone imports are marked');
 assert.equal(h.el('status').textContent,'');
 assert.deepEqual(Object.keys(h.tree.b3Games.students).sort(),['old_moshe',worked].sort());
 assert.equal(JSON.stringify(h.tree.b3Games.students.old_moshe),before,'earlier student identical');
 assert.equal(h.tree.b3Private.passcodes.old_moshe.passcode,'482731');
 assert.deepEqual(Object.keys(ws.classes.b2_et_morning.members),['old_moshe']);
 assert.ok(ws.classes.b2_et_afternoon,'classes are never deleted');
 assert.equal(h.tree.b3Quiz.scores[worked].w1,9,'student work untouched');
 const runs=Object.values(h.tree.b3Private.importRollbacks);
 assert.equal(runs.reduce((n,r)=>n+Object.keys(r.backup).length,0),22,'every removed account is backed up first');
 assert.equal(Object.values(h.tree.b3Private.studentAudit).filter(e=>e.action==='rollback').length,2,'audit log');

 // Recovery: put everything back.
 for(const id of Object.keys(h.tree.b3Private.importRollbacks))await h.ctx.undoPutBack(id);
 assert.equal(Object.keys(h.tree.b3Games.students).length,24);
 assert.equal(named(h,'Moshe Fict').length,3);
 assert.ok(!h.el('undoBatches').innerHTML.includes('already undone'),'after putting back, the imports can be undone again');
});
test('Undo CSV Import: if anything changes after the review, nothing is removed',async()=>{
 const h=harness(),t=Date.parse('2026-11-09T17:49:11Z');
 for(let i=0;i<10;i++)await manageStudents(h.store,OWNER,{action:'create',classId:'b2_et_morning',name:'Late Kid '+i,passcode:String(600000+i)},t+i*100);
 await h.ctx.undoLoad();
 h.ctx.undoToggle(h.el('undoBatches').innerHTML.match(/data-undo-batch="([^"]+)"/)[1],true);
 await h.ctx.undoReview();await h.el('rbBackup').onclick();
 const id=named(h,'Late Kid 4')[0].profile.id;
 h.tree.b3Games.students[id].halacha={done:1};   // the child used the site meanwhile
 h.el('rbConfirm').value='UNDO 10';await h.el('rbRun').onclick();
 assert.match(h.el('status').textContent,/changed since the preview/);
 assert.equal(Object.keys(h.tree.b3Games.students).length,10);
});

// ---- School scope (issue #722): the bulk tools only touch the school that is open ----
// The same object owner-admin.html's schoolScope() builds, over this harness's classes.
function scopeFor(h,id,name,{students={},staff={}}={}){
 const classes=h.tree.b3Games.workspaces['b3-2026'].classes,adopted=[];
 const placed=c=>!!classes[c]&&!!classes[c].schoolId;
 h.scope.current={id,name,adopted,
  hasClass:c=>!!classes[c]&&classes[c].schoolId===id,classPlaced:placed,classOk:c=>!placed(c)||classes[c].schoolId===id,
  hasStudent:s=>students[s]===id,studentOk:s=>!students[s]||students[s]===id,staffOk:i=>!staff[i]||staff[i]===id,
  adopt:async what=>{adopted.push(what);}};
 return h.scope.current;
}
test('school scope: a class that belongs to another school stops the upload',async()=>{
 const h=harness(),classes=h.tree.b3Games.workspaces['b3-2026'].classes;
 classes.b2_et_morning.schoolId='north';classes.b2_et_afternoon.schoolId='south';
 scopeFor(h,'north','North School');
 await h.check(csv(['Student,Scoped Kid,,313233,B2 ET Morning; B2 ET Afternoon']));
 assert.equal(h.el('bulkImport').disabled,true);
 assert.match(h.el('bulkSummary').innerHTML,/Class "B2 ET · Afternoon" belongs to another school, not North School/);
 assert.doesNotMatch(h.el('bulkSummary').innerHTML,/"B2 ET · Morning" belongs/);
 await h.importNow();
 assert.ok(!h.calls.some(c=>c.action==='importApply'),'nothing is imported');
 assert.equal(named(h,'Scoped Kid').length,0);
});
test('school scope: a student whose account is in another school stops the upload',async()=>{
 const h=harness(),classes=h.tree.b3Games.workspaces['b3-2026'].classes;
 classes.b2_et_morning.schoolId='north';
 const text=csv(['Student,Moved Kid,,414243,B2 ET Morning']);
 await h.check(text);await h.importNow();
 const id=named(h,'Moved Kid')[0].profile.id;
 scopeFor(h,'north','North School',{students:{[id]:'south'}});
 await h.check(text); // the same file again: the server recognises the child
 assert.equal(h.el('bulkImport').disabled,true,h.el('bulkSummary').innerHTML);
 assert.match(h.el('bulkSummary').innerHTML,/Moved Kid already has an account in another school/);
});
test('school scope: what an upload makes is handed to the open school',async()=>{
 const h=harness(),classes=h.tree.b3Games.workspaces['b3-2026'].classes;
 classes.b2_et_morning.schoolId='north';
 const sc=scopeFor(h,'north','North School');
 await h.check(csv(['Class,New Room,,,','Teacher,New Teacher,new.teacher@example.test,,New Room','Student,Fresh Kid,,515253,B2 ET Morning; New Room']));
 assert.equal(h.el('bulkImport').disabled,false,h.el('bulkSummary').innerHTML);
 await h.importNow();
 assert.match(h.el('bulkProgress').textContent,/Done! 1 student\(s\) created/);
 assert.equal(sc.adopted.length,1);
 const newClass=Object.keys(classes).find(c=>classes[c].name==='New Room');
 assert.deepEqual([...sc.adopted[0].classIds].sort(),['b2_et_morning',newClass].sort());
 assert.deepEqual([...sc.adopted[0].inviteIds],['new_teacher_example_test']);
 assert.deepEqual([...sc.adopted[0].studentIds],[named(h,'Fresh Kid')[0].profile.id]);
});
test('school scope: Bulk Manage and Undo Import list only the open school',async()=>{
 const h=harness(),classes=h.tree.b3Games.workspaces['b3-2026'].classes,t=Date.parse('2026-11-09T17:49:11Z');
 classes.b2_et_morning.schoolId='north';classes.b2_et_afternoon.schoolId='south';
 for(let i=0;i<10;i++)await manageStudents(h.store,OWNER,{action:'create',classId:'b2_et_morning',name:'North Kid '+i,passcode:String(700000+i)},t+i*100);
 for(let i=0;i<10;i++)await manageStudents(h.store,OWNER,{action:'create',classId:'b2_et_afternoon',name:'South Kid '+i,passcode:String(800000+i)},t+86400000+i*100);
 scopeFor(h,'north','North School');
 await h.el('bmLoad').onclick();
 assert.match(h.el('bmList').innerHTML,/North Kid 3/);
 assert.doesNotMatch(h.el('bmList').innerHTML,/South Kid/);
 assert.match(h.el('bmClass').innerHTML,/b2_et_morning/);assert.doesNotMatch(h.el('bmClass').innerHTML,/b2_et_afternoon/);
 assert.equal([...h.el('undoBatches').innerHTML.matchAll(/data-undo-batch=/g)].length,1,'only the import into this school');
 h.scope.current=null;
 await h.ctx.undoLoad();
 assert.equal([...h.el('undoBatches').innerHTML.matchAll(/data-undo-batch=/g)].length,2);
});
