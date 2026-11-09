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
 const ctx={q:el,fetch,WS:'b3-2026',classData:tree.b3Games.workspaces['b3-2026'].classes,
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
 return {tree,store,el,calls,
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
