'use strict';
// Issue #770 item 6: every PDF reopens where it was left (page, layout, zoom and scroll place),
// including PDFs opened straight from the computer, and even when the tab is closed right after a page turn.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Core=require('../class-pointer-prototype/saved-work-core.js');
const source=fs.readFileSync(path.resolve(__dirname,'../class-pointer-prototype/pdf-library.js'),'utf8');
const wait=()=>new Promise(resolve=>setTimeout(resolve,5));
function memory(){const data={};return{getItem:key=>key in data?data[key]:null,setItem(key,value){data[key]=String(value)},data}}

// One teacher page. "storage" is the browser's localStorage and outlives the page, like the real one.
function page(storage,{saved={lastPage:'4'}}={}){
  const elements={},events={},updates=[],goes=[],views=[],layouts=[];
  class E{
    constructor(){this.children=[];this.textContent='';this.style={}}
    after(node){this.afterElement=node} append(...nodes){this.children.push(...nodes)} replaceChildren(...nodes){this.children=nodes}
    addEventListener(){} setAttribute(){} closest(){return null} querySelectorAll(){return[]}
    showModal(){} close(){}
    querySelector(query){return elements[query]||(elements[query]=new E())}
  }
  const panel=new E();
  const pdf={name:'abc.pdf',bucket:'b',fullPath:'pointerPdfLibrary/teacherA/abc.pdf',
    async getMetadata(){return{name:'abc.pdf',updated:'2026-10-15',customMetadata:{displayName:'Chumash',...saved}}},
    async updateMetadata(metadata){updates.push(metadata)}};
  let current=0,layout={spread:false,rtl:true,shift:false},view={zoom:1,top:0,left:0};
  const w={ClassPointerBridge:{isTeacher:true},ClassPointerDashboard:{ready:Promise.resolve({user:{uid:'teacherA'}})},FTTSavedWorkCore:Core,
    addEventListener(type,handler){events[type]=handler},
    firebase:{auth:()=>({currentUser:{uid:'teacherA',getIdToken:async()=>'t'}}),storage:()=>({ref:()=>({listAll:async()=>({items:[pdf]}),child:()=>pdf})})},
    ClassPointerPdf:{
      // Like the real viewer: opening tells the library, then shows page 1.
      async openFile(file){w.PointerPdfLibrary.onOpened(file);current=0;view={zoom:1,top:0,left:0};return true},
      goToPage(index){current=index;goes.push(index);w.PointerPdfLibrary.onPageChanged(index+1)},
      currentPage:()=>current,getLayout:()=>({...layout}),
      setLayout(next){layout={...layout,...next};layouts.push(next);current=0;w.PointerPdfLibrary.onPageChanged(1);w.PointerPdfLibrary.onLayoutChanged()},
      getView:()=>({...view}),
      setView(next){view={zoom:next.zoom,top:next.top,left:next.left};views.push(view);w.PointerPdfLibrary.onViewChanged()}}};
  const context={window:w,document:{getElementById:id=>id==='teacherPanel'?panel:null,createElement:()=>new E(),body:new E(),head:new E(),visibilityState:'visible'},
    location:{href:'https://site.example/class-pointer-prototype/classroom.html?dashboard=teacher&class=et'},
    URL,File,Blob,Date,localStorage:storage,crypto:{randomUUID:()=>'id'},prompt:()=>null,confirm:()=>true,setTimeout,clearTimeout,
    fetch:async()=>({ok:true,status:200,headers:{get:()=>'10'},blob:async()=>new Blob(['%PDF'])})};
  vm.runInNewContext(source,context);
  // The teacher moves around: pdf-mode.js reports the page and the view.
  const teach=(pageNumber,nextView)=>{current=pageNumber-1;view={...view,...nextView};w.PointerPdfLibrary.onPageChanged(pageNumber);w.PointerPdfLibrary.onViewChanged()};
  // Opens the library window and presses Open on its one saved PDF.
  const openSaved=async()=>{
    elements['.session-controls'].afterElement.onclick();await wait();
    await elements['#pointerLibraryItems'].children[0].children[1].onclick();
  };
  return{w,events,updates,goes,views,layouts,teach,openSaved};
}
const places=storage=>JSON.parse(storage.data.fttPdfPositions||'{}');
const file=(size=5000)=>({name:'Chumash Vayeira.pdf',size,lastModified:1700000000000});

test('a PDF opened from the computer reopens on its page, zoom and scroll place',async()=>{
  const storage=memory();
  const first=page(storage);
  first.w.PointerPdfLibrary.onOpened(file());await wait();
  first.teach(12,{zoom:1.5,top:0.31,left:0.1});
  first.events.pagehide();                       // the tab is closed straight away
  const kept=places(storage)['file:Chumash Vayeira.pdf|5000|1700000000000'];
  assert.equal(kept.page,12);assert.equal(kept.zoom,1.5);assert.equal(kept.top,0.31);
  const second=page(storage);                    // next lesson: the same file is chosen again
  second.w.PointerPdfLibrary.onOpened(file());await wait();
  assert.deepEqual(second.goes,[11]);
  assert.deepEqual(second.views,[{zoom:1.5,top:0.31,left:0.1}]);
});

test('opening a PDF never saves "page 1" over the remembered place, and other PDFs are not mixed up',async()=>{
  const storage=memory();
  const first=page(storage);
  first.w.PointerPdfLibrary.onOpened(file());await wait();
  first.teach(8,{zoom:2,top:0.5});first.events.pagehide();
  const second=page(storage);
  second.w.PointerPdfLibrary.onOpened(file());
  second.w.PointerPdfLibrary.onPageChanged(1);second.w.PointerPdfLibrary.onViewChanged();   // the viewer shows page 1 first
  second.events.pagehide();
  assert.equal(places(storage)['file:Chumash Vayeira.pdf|5000|1700000000000'].page,8);
  const other=page(storage);
  other.w.PointerPdfLibrary.onOpened(file(5001));await wait();   // same name, different file
  assert.deepEqual(other.goes,[]);
  other.teach(3,{});other.events.pagehide();
  assert.equal(places(storage)['file:Chumash Vayeira.pdf|5000|1700000000000'].page,8);
  assert.equal(places(storage)['file:Chumash Vayeira.pdf|5001|1700000000000'].page,3);
});

test('a two-page layout is put back for a PDF from the computer too',async()=>{
  const storage=memory();
  Core.savePosition(storage,Core.fingerprint(file()),{page:6,zoom:1,top:0.2,left:0,layout:{spread:true,rtl:true,shift:true},at:10});
  const next=page(storage);
  next.w.PointerPdfLibrary.onOpened(file());await wait();
  assert.equal(next.layouts.length,1);assert.equal(next.layouts[0].spread,true);
  assert.deepEqual(next.goes,[5]);
  next.events.pagehide();
  assert.equal(places(storage)[Core.fingerprint(file())].at,10,'restoring is not itself remembered as a move');
});

test('library PDF: zoom and scroll place are saved with the PDF and put back on open',async()=>{
  const storage=memory();
  const p=page(storage,{saved:{lastPage:'4',view:JSON.stringify({zoom:1.75,top:0.42,left:0.05}),placeAt:'100'}});
  await p.openSaved();
  assert.deepEqual(p.goes,[3]);
  assert.deepEqual(p.views,[{zoom:1.75,top:0.42,left:0.05}]);
  p.teach(9,{zoom:2,top:0.8,left:0});
  p.w.PointerPdfLibrary.onClosed();await wait();
  const written=p.updates.at(-1).customMetadata;
  assert.equal(written.lastPage,'9');
  assert.deepEqual(JSON.parse(written.view),{zoom:2,top:0.8,left:0});
  assert.ok(Number(written.placeAt)>100);
  assert.equal(written.displayName,'Chumash','other details are kept');
});

test('library PDF: the place kept in this browser wins when it is newer (tab closed before the save)',async()=>{
  const storage=memory();
  Core.savePosition(storage,'lib:abc.pdf',{page:9,zoom:2,top:0.8,left:0,at:200});
  const newer=page(storage,{saved:{lastPage:'4',placeAt:'100'}});
  await newer.openSaved();
  assert.deepEqual(newer.goes,[8]);assert.deepEqual(newer.views,[{zoom:2,top:0.8,left:0}]);
  const older=page(storage,{saved:{lastPage:'4',placeAt:'300'}});
  await older.openSaved();
  assert.deepEqual(older.goes,[3],'the place saved with the PDF is newer, so it is used');
});

test('hiding the tab also keeps the place of a library PDF at once',async()=>{
  const storage=memory();
  const p=page(storage);
  await p.openSaved();
  p.teach(7,{zoom:1.25,top:0.33});
  p.events.pagehide();
  assert.equal(places(storage)['lib:abc.pdf'].page,7);
  await wait();
  assert.equal(p.updates.at(-1).customMetadata.lastPage,'7');
});
