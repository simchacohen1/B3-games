'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const base=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(base,'class-pointer-prototype/pdf-library.js'),'utf8');

function harness({teacher=true,authorized=true,uid='teacherA'}={}){
  const elements={};
  class E{
    constructor(tag='div'){this.tag=tag;this.children=[];this.textContent='';this.style={};this.disabled=false;}
    after(value){this.afterElement=value;}
    append(...xs){this.children.push(...xs)}
    replaceChildren(...xs){this.children=[...xs]}
    addEventListener(){}
    showModal(){this.open=true}
    close(){this.open=false}
    querySelector(q){return elements[q]||(elements[q]=new E('button'))}
  }
  const openPdf=new E('button'),panel=new E('section'),body=new E('body'),head=new E('head');
  let listed=0,fetches=[],loaded=[],page=[];
  const pdf={name:'Private worksheet.pdf',bucket:'test-bucket',fullPath:'pointerPdfLibrary/teacherA/abc.pdf',
    getDownloadURL(){throw Error('Public download token must never be requested')},
    async getMetadata(){return {name:'abc.pdf',updated:'2026-10-15',customMetadata:{displayName:'Private worksheet',lastPage:'4'}}},
    async updateMetadata(){return {}},
    async delete(){return {}}
  };
  const storage={ref(p){return {
    async listAll(){listed++;return {items:[pdf]}},
    child(id){return {...pdf,name:id,async put(){return {}}}}
  }}};
  const auth={currentUser:{uid,async getIdToken(){return 'signed-in-ID-token'}}};
  const w={ClassPointerBridge:{isTeacher:teacher},ClassPointerDashboard:{ready:authorized?Promise.resolve({user:{uid}}):Promise.reject(Error('Teacher class access denied'))},
    firebase:{auth:()=>auth,storage:()=>storage},
    ClassPointerPdf:{async openFile(file){loaded.push(file);return true},goToPage(i){page.push(i)},currentPage(){return 3}}};
  const doc={getElementById:(id)=>id==='teacherPanel'?panel:id==='openPdf'?openPdf:null,
    createElement:(tag)=>new E(tag),body,head};
  const context={window:w,document:doc,location:{href:'https://site.example/class-pointer-prototype/classroom.html?dashboard='+ (teacher?'teacher':'student')+'&class=et'},
    URL,File,Blob,crypto:{randomUUID(){return 'test-id'}},prompt:()=>null,confirm:()=>true,clearTimeout,setTimeout,
    fetch:async(url,opts)=>{fetches.push({url,opts});return {ok:true,status:200,headers:{get:()=>String(100)},blob:async()=>new Blob(['%PDF-1.7\n'])}}};
  vm.runInNewContext(source,context);
  return {w,doc,openPdf,elements,get listed(){return listed},get fetches(){return fetches},loaded,page};
}

test('student page does not initialize the private library',()=>{
  const h=harness({teacher:false});
  assert.equal(h.openPdf.afterElement,undefined);
  assert.equal(h.w.PointerPdfLibrary,undefined);
});
test('unauthorized teacher URL cannot list stored PDFs',async()=>{
  const h=harness({authorized:false});
  h.openPdf.afterElement.onclick();
  await new Promise(setImmediate);
  assert.equal(h.listed,0);
  assert.match(h.elements['#pointerLibraryStatus'].textContent,/Teacher class access denied/);
});
test('authorized teacher lists and reopens using Firebase ID token, never a public URL',async()=>{
  const h=harness();
  h.openPdf.afterElement.onclick();
  await new Promise(setImmediate);
  assert.equal(h.listed,1);
  const row=h.elements['#pointerLibraryItems'].children[0];
  assert.equal(row.children[0].textContent,'Private worksheet');
  await row.children[1].onclick();
  assert.equal(h.fetches.length,1);
  assert.equal(h.fetches[0].opts.headers.Authorization,'Firebase signed-in-ID-token');
  assert.ok(!h.fetches[0].url.includes('token='));
  assert.match(h.fetches[0].url,/pointerPdfLibrary%2FteacherA%2Fabc.pdf/);
  assert.equal(h.loaded.length,1);
  assert.equal(h.page[0],3);
});
test('Storage rules are an unmerged fragment; unrelated production Storage is not overwritten',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(base,'firebase.json'),'utf8'));
  assert.equal(config.storage,undefined);
  assert.equal(fs.existsSync(path.join(base,'storage.rules')),false);
  const fragment=fs.readFileSync(path.join(base,'security/pointer-pdf-library.rules.example'),'utf8');
  assert.match(fragment,/request.auth.uid == teacherUid/);
  assert.match(fragment,/request.resource.size <= 50 \* 1024 \* 1024/);
  assert.match(fragment,/allow get, list, delete/);
  assert.ok(!/getDownloadURL\s*\(/.test(source));
});


test('proposed merged Storage rules preserve user-confirmed existing paths and narrow the PDF path',()=>{
  const candidate=fs.readFileSync(path.join(base,'security/pointer-pdf-library-merged-storage.rules'),'utf8');
  for(const route of [
    '/posukPractice/{studentId}/{fileName}',
    '/classGallery/{postId}/{fileName}',
    '/shorashim-recordings/{studentId}/{date}/{fileName}'
  ]){
    const at=candidate.indexOf('match '+route);
    assert.ok(at>=0,route+' is missing');
    assert.match(candidate.slice(at,candidate.indexOf('\n    }',at)+6),/allow read, write: if true;/);
  }
  const at=candidate.indexOf('match /pointerPdfLibrary/{teacherUid}/{fileId}');
  assert.ok(at>=0,'Private PDF path is missing');
  const pdf=candidate.slice(at);
  assert.match(pdf,/allow get, list, delete: if request.auth != null\s*&& request.auth.uid == teacherUid;/);
  assert.match(pdf,/allow create: if request.auth != null\s*&& request.auth.uid == teacherUid/);
  assert.match(pdf,/allow update: if request.auth != null\s*&& request.auth.uid == teacherUid/);
  assert.match(pdf,/request.resource.size <= 50 \* 1024 \* 1024/);
  assert.match(pdf,/request.resource.contentType == 'application\/pdf'/);
  assert.match(pdf,/resource.md5Hash == request.resource.md5Hash/);
  assert.ok(!pdf.includes('if true'),'New private PDF rule must never allow public access');
  assert.equal((candidate.match(/match \/pointerPdfLibrary/g)||[]).length,1);
  assert.ok(!candidate.includes('{allPaths=**}'),'No public recursive wildcard should cover saved PDFs');
});
