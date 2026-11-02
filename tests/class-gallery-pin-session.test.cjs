'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Run the real in-gallery form handler against fictional identities and an
// in-memory Firebase ref. No live accounts, network or production data.
const html=fs.readFileSync(path.join(__dirname,'..','class-gallery','index.html'),'utf8');
const begin=html.indexOf('/* ---------- submission modal ---------- */');
const end=html.indexOf('/* ---------- review ---------- */',begin);
assert.ok(begin>=0&&end>begin,'submission handler must remain extractable');
const section=html.slice(begin,end);

function fixture({studentId='synthetic-et',classId='et',verifiedClass='et',blocked=false,photo=false}={}){
  const values=new Map([
    ['b3Games_studentId',studentId],
    ['b3Games_studentName','Synthetic Student'],
    ['b3Games_studentClass',classId],
  ]);
  const sessionStorage={getItem:key=>values.get(key)||null,setItem:(key,v)=>values.set(key,v)};
  const writes=[],alerts=[],errors=[];
  let pushes=0,submitHandler,resizeResolve=null;
  const elements={};
  const element=id=>elements[id]??(elements[id]={
    id,value:'',style:{},disabled:false,files:[],textContent:'',innerHTML:'',
    classList:{add(){this.shown=true},remove(){this.shown=false},shown:false},
    addEventListener(type,fn){if(id==='projectForm'&&type==='submit')submitHandler=fn},
    replaceChildren(){},reset(){},
  });
  element('classSelect').value='B3 ET';
  element('studentName').value='Synthetic Student';
  element('title').value='Fictional project';
  element('category').value='art';
  element('galleryRoom').value='hallway';
  if(photo)element('photo').files=[{name:'fake.png'}];
  const dbRef={push(){pushes++;return{key:'synthetic-post-1',async set(post){writes.push(post)}}}};
  const window={B3Guest:null};
  const ctx={document:{getElementById:element},sessionStorage,window,dbRef,
    Option:class{constructor(label,value){this.label=label;this.value=value}},
    alert:msg=>alerts.push(msg),console:{error:e=>errors.push(e)},
    setTimeout:()=>0,Date,
    resizeImage:()=>new Promise(resolve=>{resizeResolve=resolve}),
    galleryImageToStorage:async image=>image,
    uploadToStorage:async()=>null,
    escapeHtml:s=>s};
  vm.runInNewContext(
    'const ROSTERS={};const isGuestGallery=false;let isTeacher=false;'+
    'const galleryClassId="et",galleryWorkspaceId="b3-2026",presenceStudentId="synthetic-et";'+
    'const storedPresenceName="Synthetic Student";'+
    'let galleryVerifiedClass='+JSON.stringify(verifiedClass)+
    ',galleryAccessBlocked='+JSON.stringify(blocked)+';\n'+section+
    '\nwindow.__test={setVerified:v=>galleryVerifiedClass=v,setBlocked:v=>galleryAccessBlocked=v};',
    ctx,{filename:'class-gallery/index.html#submission'});
  return {values,writes,alerts,errors,element,window,
    open:()=>element('openModalBtn').onclick(),
    submit:()=>submitHandler({preventDefault(){}}),
    get pushes(){return pushes},
    resolveResize:value=>resizeResolve(value)};
}

test('in-gallery Pin Work saves a fictional same-class post for approval',async()=>{
  const f=fixture();
  await f.submit();
  assert.equal(f.pushes,1);
  assert.equal(f.writes.length,1);
  assert.equal(f.writes[0].studentId,'synthetic-et');
  assert.equal(f.writes[0].classId,'et');
  assert.equal(f.writes[0].status,'pending');
});

test('switching students before opening the form is rejected',()=>{
  const f=fixture();
  f.values.set('b3Games_studentId','synthetic-other');
  f.open();
  assert.match(f.alerts[0],/Student or class changed/);
  assert.equal(f.element('overlay').classList.shown,false);
});

test('switching students before submission makes zero database writes',async()=>{
  const f=fixture();
  f.values.set('b3Games_studentId','synthetic-other');
  await f.submit();
  assert.equal(f.pushes,0);
  assert.equal(f.writes.length,0);
  assert.match(f.element('statusMsg').textContent,/Save failed: Student or class changed/);
});

test('switching students while a picture is resizing prevents stale post',async()=>{
  const f=fixture({photo:true});
  const pending=f.submit();
  assert.equal(f.pushes,0);
  f.values.set('b3Games_studentId','synthetic-other');
  f.resolveResize('data:image/jpeg;base64,ZmFrZQ==');
  await pending;
  assert.equal(f.writes.length,0);
  assert.match(f.element('statusMsg').textContent,/Student or class changed/);
});

test('switching class and revoked gallery access both fail closed',async()=>{
  const f=fixture();
  f.values.set('b3Games_studentClass','wt');
  await f.submit();
  assert.equal(f.pushes,0);
  const g=fixture({blocked:true});
  await g.submit();
  assert.equal(g.pushes,0);
  const h=fixture({verifiedClass:'wt'});
  await h.submit();
  assert.equal(h.pushes,0);
});

test('gallery does not accidentally create posts for teacher-preview identity',async()=>{
  const f=fixture({studentId:'teacher_preview'});
  await f.submit();
  assert.equal(f.pushes,0);
  assert.equal(f.writes.length,0);
});
