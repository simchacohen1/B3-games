'use strict';
// Issue #835: the teacher sends the current or a saved whiteboard to every student (each gets their own copy).
// The picture goes through the existing "Send to every whiteboard?" preview in student-boards.js; nothing new is
// stored and no rules change. saved-work.js is run against a tiny fake page; the other files are checked as text.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Core=require('../class-pointer-prototype/saved-work-core.js');
const read=file=>fs.readFileSync(path.resolve(__dirname,'..',file),'utf8');
const saved=read('class-pointer-prototype/saved-work.js'),boardsSource=read('class-pointer-prototype/student-boards.js');
const annotate=read('class-pointer-prototype/classroom-annotate.js'),html=read('class-pointer-prototype/classroom.html');

class El{
  constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.textContent='';this.className=''}
  append(...nodes){this.children.push(...nodes)}
  appendChild(node){this.children.push(node)}
  replaceChildren(...nodes){this.children=nodes}
  addEventListener(type,handler){this.listeners[type]=handler}
  setAttribute(){}
  showModal(){}
  close(){}
  remove(){}
  focus(){}
}
const walk=node=>[node,...(node.children||[]).flatMap(walk)];
const shown=body=>walk(body).map(node=>node.textContent).filter(Boolean).join(' | ');

function page({teacher=true,pictureFails=false,boards=true,pdf=true}={}){
  const body=new El('body'),head=new El('head'),sent=[];
  const picture=new Blob(['png'],{type:'image/png'});
  const window={FTTSavedWorkCore:Core,
    ClassPointerBoards:boards?{async sendPictureToAll(blob,note){sent.push({blob,note});return true}}:undefined,
    ClassPointerPdf:pdf?{exportPng:async()=>{if(pictureFails)throw Error('The whiteboard is not open.');return picture}}:undefined,
    ClassPointerDashboard:teacher?{ready:Promise.resolve({user:{uid:'teacherA'}})}:undefined};
  const context={window,document:{body,head,currentScript:{src:'https://site.example/class-pointer-prototype/saved-work.js'},createElement:tag=>new El(tag),querySelector:()=>null},
    URL,Blob,Date,Promise,Object,JSON,Error,String,queueMicrotask,setTimeout,
    location:{href:'https://site.example/class-pointer-prototype/classroom.html?'+(teacher?'dashboard=teacher&class=et':'dashboard=student&room=x')},
    sessionStorage:{getItem:()=>null},Option:class{},prompt:()=>null,confirm:()=>true,fetch:async()=>({ok:false,status:404})};
  vm.runInNewContext(saved,context);
  return{api:window.FTTSavedWork,body,sent,picture};
}

test('Send whiteboard to students hands the current whiteboard picture to the "send to every whiteboard" preview',async()=>{
  const h=page();
  assert.equal(typeof h.api.sendCurrent,'function');
  assert.equal(await h.api.sendCurrent(),true);
  assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].blob,h.picture);
  assert.match(h.sent[0].note,/own copy to draw on/);
  assert.match(h.sent[0].note,/stays on their own board/);
});

test('with no whiteboard open nothing is sent and the teacher is told what to do',async()=>{
  const h=page({pictureFails:true});
  assert.equal(await h.api.sendCurrent(),false);
  assert.equal(h.sent.length,0);
  assert.match(shown(h.body),/Open the whiteboard on the lesson first/);
});

test('before the student whiteboards are ready the teacher is told to open the classroom, and nothing is sent',async()=>{
  for(const options of [{boards:false},{pdf:false}]){
    const h=page(options);
    assert.equal(await h.api.sendCurrent(),false);
    assert.equal(h.sent.length,0);
    assert.match(shown(h.body),/Open the classroom first/);
  }
});

test('students never get a send action: it only works on the teacher page',async()=>{
  const h=page({teacher:false});
  assert.equal(await h.api.sendCurrent(),false);
  assert.equal(h.sent.length,0);
  assert.equal(h.body.children.length,0);
  assert.match(saved,/file=>teacherPage\?teacherButtons\(file,ui,showFiles\):file\.worksheet/,'the teacher list gets its own buttons, students never do');
  assert.match(saved,/function teacherButtons\([^)]*\)\{\s*return\[[\s\S]*?Send to students/,'Send to students is in the teacher buttons');
});

test('a saved whiteboard is sent from the picture saved beside it; one without a picture says so',()=>{
  assert.match(saved,/const picture=await store\.picture\(file\);\s*if\(!picture\)throw Core\.plain\('This saved whiteboard has no picture to send\./);
  assert.match(saved,/boards\.sendPictureToAll\(picture,'Saved whiteboard: '\+file\.name\+/);
});

test('student-boards sends only after the teacher confirms, through the existing preview and limits',()=>{
  const start=boardsSource.indexOf('async sendPictureToAll(blob,note,options={})');
  assert.ok(start>0);
  const body=boardsSource.slice(start,boardsSource.indexOf('navigateWorkspace(destination)',start));
  assert.match(body,/if\(!B\.started\(\)\)\{B\.fail\(/);
  assert.match(body,/\/\^image\\\/\(png\|jpeg\|webp\)\$\/\.test\(blob\.type/,'only a picture');
  assert.match(body,/sendEveryone\('boards'\)/,'opens the student whiteboards first');
  assert.match(body,/showPaste\(\{kind:'image',file:blob,subject:options\.subject\|\|'',note:/,'asks first');
  assert.doesNotMatch(body,/sendActivity\(|sendImageFile\(|commitPaste\(/,'sends nothing by itself');
  // The preview's own button is what sends, and it keeps the size and type checks and the erase confirmation.
  assert.match(boardsSource,/const confirmPaste=button\('✓ Send to all boards'[^\n]*commitPaste\(\)/);
  assert.match(boardsSource,/if\(item\.kind==='image'\)await sendImageFile\(item\.file,\{subject:item\.subject,important,confirmed:true\}\)/);
  assert.match(boardsSource,/hasWork&&opts\.confirmed!==true&&!confirm\('This will erase the students\\' current marks and start a new activity\. Continue\?'\)/);
});

test('the toolbar Send menu offers This whiteboard (and a PDF); More no longer carries Send; the classroom loads the new scripts',()=>{
  assert.match(annotate,/\{icon:'📝',label:'This whiteboard',disabled:!window\.FTTSavedWork\?\.sendCurrent,onClick:\(\)=>window\.FTTSavedWork\?\.sendCurrent\?\.\(\)\}/);
  assert.match(html,/student-boards[.]js[?]v=20261125-wb2/);
  assert.match(html,/classroom-annotate[.]js[?]v=20261125-wb1/);
  assert.match(html,/saved-work[.]js[?]v=20261124-groups1/);
});

test('no rules, storage or function files are touched by this feature',()=>{
  assert.doesNotMatch(saved,/classShares|pointerShares|firebase\.storage\(\)\.ref\('classShares/);
});

test('the student copy is saved with a small picture so My files shows a thumbnail',()=>{
  const s=fs.readFileSync(path.join(__dirname,'..','class-pointer-prototype/saved-work.js'),'utf8');
  assert.match(s,/async function copyPicture\(dataUrl\)/);
  assert.match(s,/data,picture:await copyPicture\(activity\.data\),/);
});
