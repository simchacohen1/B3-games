'use strict';
// PDF worksheets (HIGH RISK: a server function copies one teacher file and hands students a short link).
// Mostly checks who is refused. Storage rules must stay unchanged.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../backend/functions/class-worksheets-core.cjs');
const Saved=require('../class-pointer-prototype/saved-work-core.js');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const WS='b3Games/workspaces/b3-2026/';

function db(extra={}){
  const data={
    [WS+'teachers/tA']:{active:true,classIds:{c1:true}},
    [WS+'teachers/tB']:{active:true,classIds:{c2:true}},
    [WS+'classes/c1/active']:true,[WS+'classes/c2/active']:true,[WS+'classes/c3/active']:false,
    [WS+'classes/c1/members/s1']:{name:'One'},[WS+'classes/c1/members/s2']:{name:'Two',active:false},
    [WS+'classes/c2/members/s9']:{name:'Nine'},[WS+'classes/c3/members/s7']:{name:'Seven'},
    ...extra
  };
  return async p=>(p in data?data[p]:null);
}
function makeBucket(objects){
  const store=new Map(Object.entries(objects));
  const bucket={
    store,
    async getFiles({prefix}){return[[...store.entries()].filter(([name])=>name.startsWith(prefix)).map(([name,o])=>({name,metadata:{size:String(o.size||1),updated:'2026-11-16T00:00:00Z',metadata:o.custom||{}}}))]},
    file(name){return{
      async exists(){return[store.has(name)]},
      async getMetadata(){const o=store.get(name);return[{contentType:o.type,size:String(o.size),metadata:o.custom||{}}]},
      async getSignedUrl(opt){return['https://signed.example/'+name+'?exp='+opt.expires+'&a='+opt.action]},
      async copy(dest){store.set(dest.name,{...store.get(name),custom:{...store.get(name).custom}})},
      async setMetadata(m){const o=store.get(name);o.type=m.contentType||o.type;o.custom={...o.custom,...m.metadata}},
      async delete(){store.delete(name)},
      name
    }}
  };
  return bucket;
}
const library=()=>({
  'pointerPdfLibrary/tA/lib1.pdf':{type:'application/pdf',size:2e6,custom:{displayName:'Chumash words'}},
  'pointerPdfLibrary/tA/big.pdf':{type:'application/pdf',size:30*1024*1024},
  'pointerPdfLibrary/tA/notpdf.pdf':{type:'text/plain',size:100},
  'pointerPdfLibrary/tB/other.pdf':{type:'application/pdf',size:1000,custom:{displayName:'Not yours'}}
});
const teacher=(uid)=>({uid,firebase:{sign_in_provider:'google.com'}});
const student=(id,classId)=>({uid:'u-'+id,b3StudentRole:'student',b3StudentId:id,b3ClassId:classId,firebase:{sign_in_provider:'custom'}});
const run=(body,identity,bucket,extra)=>core.handle({body,identity,get:db(extra),bucket,ownerEmail:'',stagingPassword:false,now:()=>1000});
const refused=async(promise,code)=>assert.rejects(()=>promise,error=>{assert.equal(error.code,code,error.message);return true});

test('a teacher sends a PDF from their own library; students of that class list it and get a short link',async()=>{
  const bucket=makeBucket(library());
  const sent=await run({action:'send',classId:'c1',pdfId:'lib1.pdf',name:'  Chumash   worksheet 1 '},teacher('tA'),bucket);
  assert.match(sent.id,/^[a-f0-9]{24}$/);assert.equal(sent.name,'Chumash worksheet 1');
  assert.ok(bucket.store.has('classWorksheets/c1/'+sent.id+'.pdf'));
  assert.equal(bucket.store.get('pointerPdfLibrary/tA/lib1.pdf').custom.displayName,'Chumash words','the library file is untouched');
  const list=(await run({action:'list'},student('s1','c1'),bucket)).worksheets;
  assert.deepEqual(list.map(w=>[w.id,w.name]),[[sent.id,'Chumash worksheet 1']]);
  const link=await run({action:'url',id:sent.id},student('s1','c1'),bucket);
  assert.match(link.url,new RegExp('classWorksheets/c1/'+sent.id+'\\.pdf.*exp=301000&a=read'));assert.equal(link.expiresInSeconds,300);
});

test('students cannot send or remove, and only ever see their own class (the class comes from the sign-in)',async()=>{
  const bucket=makeBucket(library());
  const sent=await run({action:'send',classId:'c1',pdfId:'lib1.pdf'},teacher('tA'),bucket);
  await refused(run({action:'send',classId:'c1',pdfId:'lib1.pdf'},student('s1','c1'),bucket),403);
  await refused(run({action:'remove',id:sent.id},student('s1','c1'),bucket),403);
  // A student of another class, asking for c1 in the request, still only gets their own class.
  const other=await run({action:'list',classId:'c1'},student('s9','c2'),bucket);
  assert.deepEqual(other.worksheets,[]);
  await refused(run({action:'url',classId:'c1',id:sent.id},student('s9','c2'),bucket),404);
  // Inactive member, member of an inactive class, a forged class claim without a membership row, no role.
  await refused(run({action:'list'},student('s2','c1'),bucket),403);
  await refused(run({action:'list'},student('s7','c3'),bucket),403);
  await refused(run({action:'list'},student('ghost','c1'),bucket),403);
  await refused(run({action:'list'},{uid:'x',firebase:{sign_in_provider:'google.com'}},bucket),400); // no class and no student role
  await refused(run({action:'list',classId:'c1'},{uid:'x',firebase:{sign_in_provider:'google.com'}},bucket),403); // a plain Google account
});

test('a teacher cannot use another teacher\'s class or library, or anything but a PDF in their own',async()=>{
  const bucket=makeBucket(library());
  await refused(run({action:'send',classId:'c2',pdfId:'lib1.pdf'},teacher('tA'),bucket),403);   // not their class
  await refused(run({action:'send',classId:'c1',pdfId:'other.pdf'},teacher('tA'),bucket),404);  // tB's file: not in tA's library
  await refused(run({action:'send',classId:'c1',pdfId:'../tB/other.pdf'},teacher('tA'),bucket),400);
  await refused(run({action:'send',classId:'c1',pdfId:'notpdf.pdf'},teacher('tA'),bucket),400);
  await refused(run({action:'send',classId:'c1',pdfId:'big.pdf'},teacher('tA'),bucket),400);
  await refused(run({action:'send',classId:'c1',pdfId:'missing.pdf'},teacher('tA'),bucket),404);
  await refused(run({action:'send',classId:'c1',pdfId:'lib1'},teacher('tA'),bucket),400);
  await refused(run({action:'send',classId:'c1',pdfId:'lib1.pdf'},{uid:'tA',firebase:{sign_in_provider:'password'}},bucket),403);
  assert.deepEqual([...bucket.store.keys()].filter(k=>k.startsWith('classWorksheets/')),[],'nothing was copied');
});

test('only the sending class\'s teacher can remove; ids are checked; the list is capped',async()=>{
  const bucket=makeBucket(library());
  const sent=await run({action:'send',classId:'c1',pdfId:'lib1.pdf'},teacher('tA'),bucket);
  await refused(run({action:'remove',classId:'c1',id:sent.id},teacher('tB'),bucket),403);
  await refused(run({action:'remove',classId:'c1',id:'../x'},teacher('tA'),bucket),400);
  await refused(run({action:'url',id:'a/b'},student('s1','c1'),bucket),400);
  assert.deepEqual(await run({action:'remove',classId:'c1',id:sent.id},teacher('tA'),bucket),{removed:true});
  assert.equal(bucket.store.size,Object.keys(library()).length);
  const full=makeBucket({...library(),...Object.fromEntries(Array.from({length:core.MAX_WORKSHEETS},(_,i)=>['classWorksheets/c1/w'+i+'.pdf',{type:'application/pdf',size:5}]))});
  await refused(run({action:'send',classId:'c1',pdfId:'lib1.pdf'},teacher('tA'),full),400);
  await refused(run({action:'nothing'},teacher('tA'),bucket),400);
});

test('the filled-in copy is an ordinary saved file with a picture per page; marks are checked when reopened',()=>{
  const meta=Saved.fileMetadata({name:'Chumash · יום ב׳',kind:'whiteboard',worksheet:true,pages:999,sheetId:'abc123',savedAt:5});
  assert.equal(meta.worksheet,'1');assert.equal(meta.pages,'60');assert.equal(meta.sheetId,'abc123');
  const file=Saved.fileFromMetadata({name:'w1.json',customMetadata:meta});
  assert.equal(file.worksheet,true);assert.equal(file.pages,60);assert.equal(file.sheetId,'abc123');
  const plain=Saved.fileFromMetadata({name:'w1.json',customMetadata:Saved.fileMetadata({name:'x',kind:'whiteboard'})});
  assert.equal(plain.worksheet,false);assert.equal(plain.pages,1);assert.equal(plain.sheetId,'');
  assert.equal(Saved.fileFromMetadata({name:'w1.json',customMetadata:{sheetId:'../x'}}).sheetId,'');
  assert.ok(Saved.parseBoard(JSON.stringify({version:1,kind:'worksheet',marks:{}}),'worksheet',1000));
  assert.equal(Saved.parseBoard(JSON.stringify({version:1,kind:'student-board'}),'worksheet',1000),null);
  assert.equal(Saved.parseBoard(JSON.stringify({version:1,kind:'worksheet'}),'student-board',1000),null,'a worksheet is never opened as a whiteboard');
  // Page pictures use names the student Storage rule already allows, and the list never shows them as files.
  assert.match('abc-p2.png',/^[-A-Za-z0-9_]{1,64}[.]png$/);
  assert.equal(Saved.fileFromMetadata({name:'abc-p2.png'}),null);
});

test('the pages: teacher button, student list, one-click save with a Hebrew-date name, teacher view of every page',()=>{
  const lib=read('class-pointer-prototype/pdf-library.js'),mine=read('class-pointer-prototype/my-files.js'),saved=read('class-pointer-prototype/saved-work.js');
  assert.match(lib,/send\.textContent='📤 Send to class'/);assert.match(lib,/api\.send\(meta\.name,name\.textContent\)/);
  assert.match(lib,/confirm\('Send "'/,'sending asks first');
  assert.match(mine,/Core\.autoName\(\{date:new Date\(\),lesson:fill\.sheetName/,'Hebrew-date name');
  assert.match(mine,/for\(let number=1;number<=pdf\.numPages;number\+=1\)pictures\.push/,'every page');
  assert.match(mine,/FA\.push\(sheetSurface\);FA\.setReason\('whiteboard',true\)/,'same drawing toolbar: pen, text, highlight');
  assert.match(mine,/cleanItem\(raw,\{idPrefix:'s',maxPoints:400\}\)/,'saved marks are checked before they are drawn again');
  assert.match(mine,/Leave without saving\?/);
  assert.match(saved,/fileId:number>1\?file\.id\+'-p'\+number:file\.id/,'the teacher sees every page');
  assert.match(saved,/const WORKSHEETS_URL='https:\/\/us-central1-b3-games\.cloudfunctions\.net\/classWorksheets'/);
  assert.match(read('class-pointer-prototype/my-files.html'),/annotation-toolbar\.js\?v=20261116-drawperm2/);
});

test('student activity pages load the worksheet-aware saved-work code; the small pop-up sends a worksheet to My files and deleting removes its pages',()=>{
  const share=read('class-pointer-prototype/activity-share.js');
  assert.match(share,/saved-work-core\.js\?v=20261116-drawperm1/);assert.match(share,/saved-work\.js\?v=20261116-drawperm1/);
  const pages=['chazara/index.html','chavrusa/index.html','gematria/index.html','halacha/index.html','shorashim/index.html'];
  for(const page of pages)assert.match(read(page),/activity-share\.js\?v=20261116-drawperm1/,page);
  const saved=read('class-pointer-prototype/saved-work.js');
  assert.match(saved,/file\.worksheet\n?\s*\?\[button\('Continue in My files'/);
  assert.match(saved,/if\(file\.worksheet\)\{[\s\S]*?startsWith\(file\.id\+'-p'\)[\s\S]*?\.delete\(\)/,'page pictures are removed with the worksheet');
});

test('staging gets the same private PDF library rule as live (staging only, so Send can be tested there)',()=>{
  const live=read('security/pointer-pdf-library-merged-storage.rules'),staging=read('staging/storage.rules');
  const block=raw=>{const text=raw.replace(/\r/g,'');const start=text.indexOf('match /pointerPdfLibrary/'),end=text.indexOf('}\n',text.indexOf("request.resource.contentType == 'application/pdf';",text.indexOf('allow update',start)));return text.slice(start,end).replace(/\r/g,'')};
  assert.equal(block(staging),block(live));
  assert.match(staging,/match \/pointerPdfLibrary\/\{teacherUid\}\/\{fileId\}/);
  assert.match(staging,/request\.auth\.uid == teacherUid/);
});

test('Storage and database rules are unchanged; the function is exported live and on staging with one shared core',()=>{
  for(const rules of ['staging/storage.rules','storage-rules.hardened.rules','security/pointer-pdf-library-merged-storage.rules'])
    assert.doesNotMatch(read(rules),/classWorksheets/,rules+' must not mention worksheets: the deny-all rule keeps browsers out');
  assert.match(read('staging/storage.rules'),/match \/\{file=\*\*\} \{ allow read, write: if false; \}/);
  assert.equal(read('backend/functions/class-worksheets-core.cjs'),read('backend/functions-staging/class-worksheets-core.cjs'));
  assert.equal(read('backend/functions/teacher-student-files-core.cjs'),read('backend/functions-staging/teacher-student-files-core.cjs'));
  assert.match(read('backend/functions/index.js'),/exports\.classWorksheets=require\('\.\/class-worksheets'\)\.classWorksheets/);
  assert.match(read('backend/functions-staging/index.js'),/exports\.classWorksheets = require\('\.\/class-worksheets'\)\.classWorksheets/);
  const live=read('backend/functions/class-worksheets.js');
  assert.doesNotMatch(live,/@/,'no email address in the live function');
  assert.match(live,/b3-games\.firebasestorage\.app/);
});
