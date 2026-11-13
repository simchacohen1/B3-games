'use strict';
// Saved work (issue #770): saved-work.js against a fake Firebase and a tiny fake page.
// Who may save, where files go, what is said when rules refuse, and the Save / My files windows.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Core=require('../class-pointer-prototype/saved-work-core.js');
const source=fs.readFileSync(path.resolve(__dirname,'../class-pointer-prototype/saved-work.js'),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
// Objects made inside the test page belong to another JavaScript world; compare their contents.
const plain=value=>JSON.parse(JSON.stringify(value));
const STUDENT={b3StudentRole:'student',b3StudentId:'stu1',b3ClassId:'et'};
const DENIED={code:'storage/unauthorized',message:'Firebase Storage: User does not have permission to access this object.'};

class El{
  constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attrs={};this.textContent='';this.className='';this.hidden=false;this.value=''}
  append(...nodes){this.children.push(...nodes)}
  appendChild(node){this.children.push(node);if(node.tag==='script')queueMicrotask(()=>node.onload?.())}
  before(...nodes){this.placedBefore=nodes}
  replaceChildren(...nodes){this.children=nodes}
  addEventListener(type,handler){this.listeners[type]=handler}
  setAttribute(name,value){this.attrs[name]=value}
  querySelector(){return this.found||null}
  querySelectorAll(){return[]}
  showModal(){this.open=true}
  close(){this.open=false;this.listeners.close?.()}
  remove(){}
  focus(){}
  click(){return this.listeners.click?.({target:this})}
}
const walk=node=>[node,...(node.children||[]).flatMap(walk)];
const texts=node=>walk(node).map(item=>item.textContent).filter(Boolean);
const buttonNamed=(node,text)=>walk(node).find(item=>item.tag==='button'&&item.textContent.startsWith(text));

function harness({claims=STUDENT,signedIn=true,tabStudent='stu1',teacher=false,deny=false,existing={},folders=null,board=true,answers={}}={}){
  const objects=new Map(Object.entries(existing)),puts=[],deleted=[],metaUpdates=[],dbWrites=[],fetches=[];
  const user=signedIn?{uid:teacher?'teacherA':'student-uid',getIdToken:async()=>'ID-TOKEN',getIdTokenResult:async()=>({claims:teacher?{}:claims})}:null;
  const ref=full=>({
    name:full.split('/').pop(),fullPath:full,bucket:'bucket',
    child:name=>ref(full+name),
    put(blob,metadata){
      if(!deny){puts.push({path:full,blob,metadata});objects.set(full,metadata)}
      const done=deny?Promise.reject(DENIED):Promise.resolve();done.catch(()=>{});
      return Object.assign(done,{on(_,next,reject,resolve){if(deny)reject(DENIED);else{next({bytesTransferred:5,totalBytes:10});resolve()}}});
    },
    async listAll(){if(deny)throw DENIED;return{items:[...objects.keys()].filter(key=>key.startsWith(full)).map(ref)}},
    async getMetadata(){return{name:full.split('/').pop(),size:10,customMetadata:objects.get(full)?.customMetadata}},
    async updateMetadata(metadata){metaUpdates.push({path:full,metadata})},
    async delete(){if(!objects.has(full))throw{code:'storage/object-not-found'};deleted.push(full);objects.delete(full)}
  });
  const firebase={apps:[{}],
    auth:()=>({currentUser:user,onAuthStateChanged(callback){queueMicrotask(()=>callback(user));return()=>{}}}),
    storage:()=>({ref}),
    database:()=>({ref:dbPath=>({once:async()=>({val:()=>folders}),async update(changes){if(deny)throw{code:'PERMISSION_DENIED',message:'PERMISSION_DENIED: Permission denied'};dbWrites.push({path:dbPath,changes})}})})};
  const body=new El('body'),head=new El('head'),bar=new El('div'),spacer=new El('span');bar.found=spacer;
  const document={body,head,currentScript:{src:'https://site.example/class-pointer-prototype/saved-work.js'},createElement:tag=>new El(tag),
    querySelector:selector=>selector==='#myBoard .boards-bar'&&!teacher?bar:null};
  const imported=[];
  const boardApi=board?{exportBoard:()=>({version:1,kind:'student-board',strokes:[{id:'s1'}]}),importBoard(data){imported.push(data);return true},exportPng:async()=>new Blob(['png'],{type:'image/png'})}:undefined;
  const lessonApi={exportWhiteboard:async()=>({version:1,kind:'lesson-whiteboard',pictures:[]}),importWhiteboard:async data=>{imported.push(data);return true},exportPng:async()=>new Blob(['png'],{type:'image/png'})};
  const window={FTTSavedWorkCore:Core,firebase,B3_FIREBASE_CONFIG:{},ClassPointerBoards:teacher?undefined:boardApi,ClassPointerPdf:teacher?lessonApi:undefined,
    ClassPointerDashboard:teacher?{ready:Promise.resolve({user:{uid:'teacherA'}})}:undefined,open(url){window.opened=url}};
  const responses=[];
  const context={window,document,firebase,URL,Blob,Date,Promise,Object,JSON,Error,String,queueMicrotask,setTimeout,
    location:{href:'https://site.example/class-pointer-prototype/classroom.html?'+(teacher?'dashboard=teacher&class=et':'dashboard=student&room=class-pointer-x')},
    sessionStorage:{getItem:key=>key==='b3Games_studentId'?tabStudent:null},
    Option:class{constructor(text,value){this.textContent=text;this.value=value}},
    prompt:(question)=>{const key=Object.keys(answers).find(start=>question.startsWith(start));return key?answers[key]:null},confirm:()=>true,
    fetch:async(url,options)=>{fetches.push({url,options});return responses.shift()||{ok:true,status:200,blob:async()=>new Blob(['{}'])}}};
  vm.runInNewContext(source,context);
  return{api:window.FTTSavedWork,window,body,bar,spacer,puts,deleted,metaUpdates,dbWrites,fetches,responses,imported,objects};
}
const fails=async promise=>{try{await promise}catch(error){return Core.errorText(error)}assert.fail('should have been refused')};

test('a student saves a whiteboard into their own class folder in Storage, with a small picture',async()=>{
  const h=harness();
  const id=await h.api.store.saveBoard({name:'Chumash notes',folderId:'f1',data:{version:1,kind:'student-board'},picture:new Blob(['png'])});
  assert.ok(Core.validId(id));
  assert.deepEqual(h.puts.map(put=>put.path),['studentFiles/et/stu1/'+id+'.json','studentFiles/et/stu1/'+id+'.png']);
  assert.equal(h.puts[0].metadata.contentType,'application/json');
  assert.equal(h.puts[0].metadata.customMetadata.displayName,'Chumash notes');
  assert.equal(h.puts[0].metadata.customMetadata.kind,'whiteboard');
  assert.equal(h.puts[0].metadata.customMetadata.folderId,'f1');
  assert.equal(h.puts[1].metadata.contentType,'image/png');
  // Saving again with the same id replaces that file instead of making another.
  await h.api.store.saveBoard({id,name:'Chumash notes',data:{version:1,kind:'student-board'}});
  assert.equal(h.puts[2].path,'studentFiles/et/stu1/'+id+'.json');
});

test('no student sign-in means a plain message and nothing is written',async()=>{
  const board={name:'x',data:{version:1,kind:'student-board'}};
  for(const options of [{signedIn:false},{claims:{}},{claims:{...STUDENT,b3StudentRole:'teacher'}},{claims:{...STUDENT,b3ClassId:''}},{tabStudent:'someone-else'}]){
    const h=harness(options);
    assert.match(await fails(h.api.store.saveBoard(board)),/sign in on the Fun Torah home page/);
    assert.match(await fails(h.api.store.list()),/sign in on the Fun Torah home page/);
    assert.equal(h.puts.length,0);
  }
});

test('when the rules are not published yet, saving says so plainly',async()=>{
  const h=harness({deny:true});
  assert.equal(await fails(h.api.store.saveBoard({name:'x',data:{version:1,kind:'student-board'}})),'Saving is not turned on yet. Ask your teacher.');
  assert.equal(await fails(h.api.store.list()),'Saving is not turned on yet. Ask your teacher.');
  assert.equal(await fails(h.api.store.savePdf({name:'a.pdf',type:'application/pdf',size:100},{name:'A'})),'Saving is not turned on yet. Ask your teacher.');
  h.responses.push({ok:false,status:403});
  assert.equal(await fails(h.api.store.readPdf({id:'abc'})),'Saving is not turned on yet. Ask your teacher.');
});

test('a student may keep 50 files: a new one is refused, saving over an old one still works',async()=>{
  const existing={};
  for(let i=0;i<50;i++)existing['studentFiles/et/stu1/f'+i+'.json']={customMetadata:{displayName:'Board '+i}};
  existing['studentFiles/et/stu1/f0.png']={};
  const h=harness({existing});
  assert.match(await fails(h.api.store.saveBoard({name:'One more',data:{version:1,kind:'student-board'}})),/already have 50 saved files/);
  assert.match(await fails(h.api.store.savePdf({name:'a.pdf',type:'application/pdf',size:100},{name:'A'})),/already have 50 saved files/);
  await h.api.store.saveBoard({id:'f3',name:'Board 3',data:{version:1,kind:'student-board'}});
  assert.equal(h.puts.length,1);
  const files=await h.api.store.list();
  assert.equal(files.length,50,'pictures are not listed as files');
});

test('PDF upload: PDFs only, 25 MB at most, progress is reported',async()=>{
  const h=harness(),steps=[];
  assert.match(await fails(h.api.store.savePdf({name:'photo.jpg',type:'image/jpeg',size:100},{name:'Photo'})),/choose a PDF/);
  assert.match(await fails(h.api.store.savePdf({name:'big.pdf',type:'application/pdf',size:25*1024*1024+1},{name:'Big'})),/25 MB/);
  const id=await h.api.store.savePdf({name:'sheet.pdf',type:'application/pdf',size:1000},{name:'Sheet',folderId:'f1'},percent=>steps.push(percent));
  assert.equal(h.puts[0].path,'studentFiles/et/stu1/'+id+'.pdf');
  assert.equal(h.puts[0].metadata.contentType,'application/pdf');
  assert.equal(h.puts[0].metadata.customMetadata.kind,'pdf');
  assert.deepEqual(steps,[50]);
});

test('files are downloaded with the sign-in token, never a public link, and checked before use',async()=>{
  const h=harness();
  h.responses.push({ok:true,status:200,blob:async()=>new Blob([JSON.stringify({version:1,kind:'student-board',strokes:[]})])});
  const data=await h.api.store.readBoard({id:'abc'},'student-board');
  assert.equal(data.kind,'student-board');
  assert.equal(h.fetches[0].options.headers.Authorization,'Firebase ID-TOKEN');
  assert.match(h.fetches[0].url,/studentFiles%2Fet%2Fstu1%2Fabc\.json\?alt=media$/);
  assert.ok(!h.fetches[0].url.includes('token='));
  h.responses.push({ok:true,status:200,blob:async()=>new Blob([JSON.stringify({version:1,kind:'lesson-whiteboard'})])});
  assert.match(await fails(h.api.store.readBoard({id:'abc'},'student-board')),/could not be opened/);
  h.responses.push({ok:true,status:200,blob:async()=>new Blob(['<script>alert(1)</script>'])});
  assert.match(await fails(h.api.store.readBoard({id:'abc'},'student-board')),/could not be opened/);
  h.responses.push({ok:false,status:404});
  assert.match(await fails(h.api.store.readPdf({id:'gone'})),/not there any more/);
  await assert.rejects(()=>h.api.store.readPdf({id:'../../other/abc'}),/Invalid file name/);
});

test('rename and delete change only that student\'s own file; delete also removes its picture',async()=>{
  const h=harness({existing:{'studentFiles/et/stu1/w1.json':{customMetadata:{displayName:'Old',folderId:'f1'}},'studentFiles/et/stu1/w1.png':{}}});
  const [file]=await h.api.store.list();
  await h.api.store.rename(file,' New name ');
  assert.deepEqual(plain(h.metaUpdates[0]),{path:'studentFiles/et/stu1/w1.json',metadata:{customMetadata:{displayName:'New name',folderId:'f1'}}});
  await h.api.store.remember({id:'p1',ext:'pdf'},{page:7,zoom:1.5,at:99});
  assert.deepEqual(plain(h.metaUpdates[1].metadata.customMetadata),{lastPage:'7',zoom:'1.5',placeAt:'99'});
  await h.api.store.remove(file);
  assert.deepEqual(h.deleted,['studentFiles/et/stu1/w1.json','studentFiles/et/stu1/w1.png']);
});

test('teacher: whiteboards go to the teacher\'s own folder; class folders are written to this class only',async()=>{
  const h=harness({teacher:true});
  const id=await h.api.store.saveBoard({name:'Lesson 1',data:{version:1,kind:'lesson-whiteboard'}});
  assert.equal(h.puts[0].path,'pointerWhiteboards/teacherA/'+id+'.json');
  await h.api.store.changeFolders({'folders/f1':{name:'Chumash',order:1,createdAt:1}});
  assert.deepEqual(plain(h.dbWrites),[{path:'b3Games/workspaces/b3-2026/classes/et/pointerFileFolders',changes:{'folders/f1':{name:'Chumash',order:1,createdAt:1}}}]);
  const denied=harness({teacher:true,deny:true});
  assert.match(await fails(denied.api.store.changeFolders({saveTarget:null})),/not turned on yet/);
  const student=harness();
  assert.match(await fails(student.api.store.changeFolders({saveTarget:null})),/Only a teacher/);
  assert.equal(student.dbWrites.length,0);
});

test('a teacher page whose sign-in changed cannot use saved files',async()=>{
  const h=harness({teacher:true});
  h.window.ClassPointerDashboard.ready=Promise.resolve({user:{uid:'another-teacher'}});
  assert.match(await fails(h.api.store.list()),/Sign in as the teacher/);
});

test('student whiteboard bar gets Save and My files; the teacher page gets none (its toolbar has them)',()=>{
  const h=harness();
  assert.deepEqual(h.spacer.placedBefore.map(node=>node.textContent),['💾 Save','📂 My files']);
  assert.equal(typeof h.api.saveCurrent,'function');assert.equal(typeof h.api.open,'function');
  assert.equal(harness({teacher:true}).spacer.placedBefore,undefined);
});

test('Save window: shows where the teacher asked students to save, preselects it, and saves there',async()=>{
  const folders={saveTarget:'p1',folders:{chumash:{name:'Chumash',order:1,createdAt:1},p1:{name:'Perek 1',parentId:'chumash',order:2,createdAt:2}}};
  const h=harness({folders});
  await h.api.saveCurrent();
  const dialog=h.body.children[0];
  assert.ok(texts(dialog).includes('Your teacher asked you to save in: Chumash › Perek 1'));
  assert.ok(texts(dialog).includes('Only you can see your saved files.'));
  const select=walk(dialog).find(node=>node.tag==='select'),name=walk(dialog).find(node=>node.tag==='input');
  assert.equal(select.value,'p1');
  assert.deepEqual(select.children.map(option=>option.textContent),['No folder','Chumash','Chumash › Perek 1']);
  await buttonNamed(dialog,'Save').click();
  assert.equal(h.puts.length,0,'a name is needed first');
  assert.ok(texts(dialog).includes('Type a name first.'));
  name.value='My notes';
  await buttonNamed(dialog,'Save').click();await tick();
  assert.equal(h.puts[0].metadata.customMetadata.folderId,'p1');
  assert.equal(h.puts[0].metadata.customMetadata.displayName,'My notes');
  assert.ok(texts(dialog).includes('Saved.'));
  // Saving again offers to save over the same file or to make a new one.
  await h.api.saveCurrent();
  const again=h.body.children[1];
  assert.ok(buttonNamed(again,'Save over "My notes"'));
  assert.ok(buttonNamed(again,'Save as new'));
  await buttonNamed(again,'Save over').click();await tick();
  assert.equal(h.puts.filter(put=>put.path.endsWith('.json')).length,2);
  assert.equal(h.puts.at(-2).path,h.puts[0].path,'same file is replaced');
});

test('Save window says so plainly when there is no whiteboard code, no sign-in, or the rules refuse',async()=>{
  const none=harness({board:false});await none.api.saveCurrent();
  assert.ok(texts(none.body.children[0]).includes('Saving is not ready on this page yet.'));
  const out=harness({signedIn:false});await out.api.saveCurrent();
  assert.ok(texts(out.body.children[0]).some(text=>/sign in on the Fun Torah home page/.test(text)));
  const denied=harness({deny:true});await denied.api.saveCurrent();
  const dialog=denied.body.children[0];
  walk(dialog).find(node=>node.tag==='input').value='Notes';
  await buttonNamed(dialog,'Save').click();await tick();
  assert.ok(texts(dialog).includes('Saving is not turned on yet. Ask your teacher.'));
});

test('My files: a student reopens a saved whiteboard onto the open board; names are shown as text',async()=>{
  const h=harness({existing:{'studentFiles/et/stu1/w1.json':{customMetadata:{displayName:'<img src=x onerror=alert(1)>',savedAt:'5'}},'studentFiles/et/stu1/p1.pdf':{customMetadata:{displayName:'Sheet',kind:'pdf'}}}});
  await h.api.open();
  const dialog=h.body.children[0],all=walk(dialog);
  assert.ok(all.some(node=>node.textContent==='📝 <img src=x onerror=alert(1)>'),'the name is plain text');
  assert.ok(all.every(node=>node.innerHTML===undefined),'innerHTML is never used');
  assert.ok(!texts(dialog).some(text=>text.includes('Sheet')),'PDFs are opened from the My files page');
  h.responses.push({ok:true,status:200,blob:async()=>new Blob([JSON.stringify({version:1,kind:'student-board',strokes:[]})])});
  await buttonNamed(dialog,'Open').click();await tick();
  assert.deepEqual(plain(h.imported),[{version:1,kind:'student-board',strokes:[]}]);
  buttonNamed(dialog,'📂 See all my files').click();
  assert.equal(h.window.opened,'https://site.example/class-pointer-prototype/my-files.html');
  assert.ok(!h.window.opened.includes('stu1'),'no student id in the address');
});

test('My files (teacher): Class folders tab makes a folder, points students to it, and deletes it safely',async()=>{
  const h=harness({teacher:true,answers:{'Name of the new folder (':'Chumash','New folder name':'Navi'}});
  await h.api.open();
  const dialog=h.body.children[0];
  await buttonNamed(dialog,'Class folders').click();await tick();
  assert.ok(texts(dialog).some(text=>/private to that student/.test(text)));
  await buttonNamed(dialog,'＋ New folder').click();await tick();
  const added=h.dbWrites[0].changes,key=Object.keys(added)[0];
  assert.match(key,/^folders\/[A-Za-z0-9_-]{1,64}$/);assert.equal(added[key].name,'Chumash');
  await buttonNamed(dialog,'Students save here').click();await tick();
  assert.deepEqual(plain(h.dbWrites[1].changes),{saveTarget:key.slice(8)});
  assert.ok(texts(dialog).includes('Students are asked to save in: Chumash'));
  await buttonNamed(dialog,'Delete').click();await tick();
  assert.deepEqual(plain(h.dbWrites[2].changes),{[key]:null,saveTarget:null});
  assert.equal(h.deleted.length,0,'no file is deleted with a folder');
});
