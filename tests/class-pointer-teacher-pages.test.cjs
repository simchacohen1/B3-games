'use strict';
// The teacher's whiteboard pages (pdf-mode.js): add, copy, delete, move and jump between pages; what is drawn on a page
// stays on that page; saving writes one page the old way (version 1) and several pages as version 2.
// Runs the real page code (cut out of pdf-mode.js) against small fakes, like class-pointer-board-presentation.test.cjs.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Pages=require('../class-pointer-prototype/board-pages-core.js');
const source=fs.readFileSync(path.join(__dirname,'../class-pointer-prototype/pdf-mode.js'),'utf8');

function harness(){
  const state={marks:[],restored:[],published:[],status:[],fails:[]};
  const element=()=>{const node={children:[],hidden:false,className:'',style:{},dataset:{},disabled:false,
    append(...n){node.children.push(...n)},appendChild(n){node.children.push(n);return n},replaceChildren(...n){node.children=n},
    setAttribute(){},addEventListener(){},getContext(){return new Proxy({},{get:(t,k)=>k in t?t[k]:()=>{},set:(t,k,v)=>{t[k]=v;return true}})},
    toDataURL(){return 'data:image/jpeg;base64,AAAA'},toBlob(fn){fn({size:1,type:'image/png'})}};return node};
  const context={
    Pages,state,
    B:{highlights:()=>state.marks,restoreMarks:list=>{state.restored.push(JSON.parse(JSON.stringify(list)));state.marks=JSON.parse(JSON.stringify(list))},status:t=>state.status.push(t),fail:t=>state.fails.push(String(t))},
    el:element,stage:element(),document:{createElement:element},
    isTeacher:true,boardPictures:[],pictureEdits:[],strokes:[],boardSize:{w:1600,h:900},boardPresentation:null,boardBackground:null,selectedId:null,
    pagesBar:null,pagesPanel:null,pagesPanelOpen:false,pagesSig:'',pagesTimer:0,wbPages:null,wbAt:0,wbSwitching:false,
    Z:null,zones:[],syncZones(){},
    isBoardOpen:()=>true,finishInline(){},finishPictureEdit(){},updateControls(){},composeBoard:()=>'data:image/jpeg;base64,AAAA',
    publishBoard:async()=>{state.published.push(context.boardPictures.map(p=>p.id));},
    paintInk(){},whenPictures:async()=>[],exportPng:async()=>({size:1,type:'image/png'}),
    confirm:()=>true,setInterval:()=>0,clearInterval(){},Promise,JSON,Image:class{},
  };
  vm.createContext(context);
  const start=source.indexOf('  // ---------- Whiteboard pages (slides) ----------');
  const end=source.indexOf('  function syncPagesBar(){renderPages(false)}');
  assert.ok(start>0&&end>start,'the page code is in pdf-mode.js');
  vm.runInContext(source.slice(start,end)+'  function syncPagesBar(){renderPages(false)}\nglobalThis.api={addPage,showPage,deletePage,movePage,exportPagePngs,pagesInfo,capturePage,newWbPage};',context);
  context.wbPages=[context.api.newWbPage()];
  return{context,state,api:context.api};
}
const pic=id=>({id,image:{},x:0,y:0,w:1,h:1,after:null});
const mark=id=>({id,owner:'teacher',tool:'pen',color:'#000000',size:.01,points:[{x:.1,y:.1},{x:.2,y:.2}]});
const ids=list=>Array.from(list,p=>p.id);

test('a whiteboard starts with one page; no page strip numbers appear until there is more than one',()=>{
  const h=harness();
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.pagesInfo())),{count:1,current:0});
});

test('a new page is blank, the page before keeps its pictures and marks, and going back brings them back',async()=>{
  const h=harness(),c=h.context;
  c.boardPictures=[pic('A')];h.state.marks=[mark('m1')];
  assert.equal(await h.api.addPage(false),true);
  assert.equal(c.wbPages.length,2);assert.equal(c.wbAt,1);
  assert.equal(c.boardPictures.length,0,'the new page has no pictures');
  assert.deepEqual(h.state.restored.at(-1),[],'and no marks');
  h.state.marks=[mark('m2')];c.boardPictures=[pic('B')];
  await h.api.showPage(0);
  assert.deepEqual(ids(c.boardPictures),['A']);
  assert.equal(h.state.restored.at(-1).length,1);
  await h.api.showPage(1);
  assert.deepEqual(ids(c.boardPictures),['B']);
  assert.equal(h.state.restored.at(-1)[0].id,'m2','page 2 kept its own mark');
});

test('copying a page makes a second page just like it, right after it',async()=>{
  const h=harness(),c=h.context;
  c.boardPictures=[pic('A')];h.state.marks=[mark('m1')];
  await h.api.addPage(true);
  assert.equal(c.wbPages.length,2);assert.equal(c.wbAt,1);
  assert.deepEqual(ids(c.boardPictures),['A']);
  assert.equal(h.state.restored.at(-1).length,1);
});

test('pages are added after the one being shown, up to 20, and never more',async()=>{
  const h=harness(),c=h.context;
  for(let i=0;i<30;i++)await h.api.addPage(false);
  assert.equal(c.wbPages.length,20);
  assert.ok(h.state.status.some(t=>/up to 20 pages/.test(t)));
});

test('deleting a page: the page that takes its place is shown; the last page cannot be deleted; saying no keeps it',async()=>{
  const h=harness(),c=h.context;
  await h.api.addPage(false);await h.api.addPage(false);        // 3 pages, on the third
  const [a,b,third]=c.wbPages.map(p=>p.id);
  await h.api.showPage(1);
  c.confirm=()=>false;
  assert.equal(await h.api.deletePage(b),false);assert.equal(c.wbPages.length,3);
  c.confirm=()=>true;
  await h.api.deletePage(b);
  assert.deepEqual(ids(c.wbPages),[a,third]);assert.equal(c.wbAt,1,'the old third page took its place');
  await h.api.deletePage(third);
  assert.deepEqual(ids(c.wbPages),[a]);assert.equal(c.wbAt,0);
  assert.equal(await h.api.deletePage(a),false,'the last page stays');
  assert.ok(h.state.status.some(t=>/at least one page/.test(t)));
});

test('deleting another page leaves the page on the screen where it is',async()=>{
  const h=harness(),c=h.context;
  await h.api.addPage(false);await h.api.addPage(false);
  const [a,,third]=c.wbPages.map(p=>p.id);
  const shown=c.wbAt,published=h.state.published.length;
  await h.api.deletePage(a);
  assert.equal(c.wbPages[c.wbAt].id,third,'still on the same page');
  assert.equal(h.state.published.length,published,'and nothing was re-sent to the class');
  assert.ok(shown===2);
});

test('moving a page keeps the shown page on the screen and changes only the order',async()=>{
  const h=harness(),c=h.context;
  await h.api.addPage(false);await h.api.addPage(false);
  const [a,b,third]=c.wbPages.map(p=>p.id),published=h.state.published.length;
  await h.api.movePage(third,0);
  assert.deepEqual(ids(c.wbPages),[third,a,b]);
  assert.equal(c.wbPages[c.wbAt].id,third,'the page that was shown is still shown');
  assert.equal(h.state.published.length,published,'moving a page sends nothing to the class');
  await h.api.movePage(a,99);
  assert.deepEqual(ids(c.wbPages),[third,b,a]);
});

test('while pictures are being placed, changing page keeps them on the page they were placed on',async()=>{
  const h=harness(),c=h.context;
  let finished=0;
  c.pictureEdits=[{image:{},x:.1,y:.1,w:.5,h:.5,after:null}];
  c.finishPictureEdit=()=>{finished++;for(const item of c.pictureEdits)c.boardPictures.push({image:item.image,x:item.x,y:item.y,w:item.w,h:item.h,after:item.after});c.pictureEdits=[]};
  await h.api.addPage(false);
  assert.equal(finished,1);
  assert.equal(c.wbPages[0].pictures.length,1,'the picture is on page 1');
  assert.equal(c.boardPictures.length,0);
});

test('one change at a time: a second page change while one is running is ignored',async()=>{
  const h=harness(),c=h.context;
  const first=h.api.addPage(false),second=h.api.addPage(false);
  assert.equal(await second,false);
  assert.equal(await first,true);
  assert.equal(c.wbPages.length,2);
});

test('Send: one picture per page, in page order, or just the page asked for',async()=>{
  const h=harness();
  await h.api.addPage(false);await h.api.addPage(false);
  assert.equal((await h.api.exportPagePngs()).length,3);
  assert.equal((await h.api.exportPagePngs(2)).length,1);
});

test('saving: one page is written exactly as before (version 1); several pages as version 2',()=>{
  const start=source.indexOf('  function savedStrokes(list){'),end=source.indexOf('  // Opens the whiteboard exactly as the Whiteboard button does');
  assert.ok(start>0&&end>start);
  const code=source.slice(start,end);
  assert.match(code,/wbPages\.length===1\)\{\s*return\{version:1,kind:'lesson-whiteboard'/,'one page: the old file');
  assert.match(code,/Pages\.wrap\('lesson-whiteboard',pages,wbAt\)/,'several pages: the pages file');
  assert.match(code,/capturePage\(\)/,'the page on the screen is copied into the list before saving');
});
