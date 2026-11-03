/* Run: HALACHA_TEST_CHROMIUM=/path/to/chromium node --test tests/halacha-studio.browser.cjs
   Isolated browser: account/gate scripts are stubbed; no real student or cloud writes. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const root=path.resolve(__dirname,'..');let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.HALACHA_TEST_CHROMIUM||undefined,args:['--no-sandbox','--disable-gpu']});});
test.after(async()=>browser?.close());
async function open(query='',legacy=false,student=''){
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{let u=new URL(route.request().url());if(u.origin==='http://studio.test'&&u.pathname.startsWith('/halacha/')&&!u.pathname.endsWith('gallery.js')){const file=path.join(root,u.pathname.endsWith('/')?u.pathname+'index.html':u.pathname);return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/javascript'});}return route.fulfill({body:'',contentType:'application/javascript'});});
 if(student)await page.addInitScript(id=>sessionStorage.setItem('b3Games_studentId',id),student);
 if(legacy)await page.addInitScript(()=>{
  const c=document.createElement('canvas');c.width=400;c.height=700;const ctx=c.getContext('2d');ctx.fillStyle='#e53935';ctx.fillRect(30,30,100,100);
  const old={a_scrap_pages:['<div class="scrap textbox" style="left:20px;top:100px;width:220px"><div class="tb-text" contenteditable="true">My old artwork</div></div>',''],a_draw:[c.toDataURL(),''],a_theme:'blue',a_done:true,b_got:['keep lesson progress']};
  localStorage.setItem('halachaV14',JSON.stringify(old));localStorage.setItem('halachaV14:demo',JSON.stringify(old));
 });
 await page.goto('http://studio.test/halacha/'+query);await page.getByRole('button',{name:/סימן א/}).click();await page.waitForFunction(()=>{const c=document.querySelector('#a .draw-layer');return c._w&&!c._loading;});return{page,errors};
}
async function pixel(p,x,y){return p.evaluate(([x,y])=>{const c=document.querySelector('#a .draw-layer');return Array.from(c.getContext('2d').getImageData(Math.round(x*c.width/c.clientWidth),Math.round(y*c.height/c.clientHeight),1,1).data);},[x,y]);}
async function stroke(p,mode,x1,y1,x2,y2){await p.locator('#a [data-mode="'+mode+'"]').first().click();await p.locator('#a .draw-layer').first().scrollIntoViewIfNeeded();const r=await p.locator('#a .draw-layer').first().boundingBox();await p.mouse.move(r.x+x1,r.y+y1);await p.mouse.down();await p.mouse.move(r.x+x2,r.y+y2,{steps:10});await p.mouse.up();}
test('legacy pieces, drawings and lesson progress survive load and resize',async()=>{
 const {page:p,errors}=await open('',true);assert.equal(await p.locator('#a .tb-text').textContent(),'My old artwork');assert.ok((await pixel(p,50,50))[3]>0);await p.setViewportSize({width:1200,height:900});assert.ok((await pixel(p,40,50))[3]>0);assert.deepEqual(await p.evaluate(()=>S.b_got),['keep lesson progress']);await p.evaluate(()=>saveDrawing('a'));await p.reload();await p.getByRole('button',{name:/סימן א/}).click();await p.waitForFunction(()=>!document.querySelector('#a .draw-layer')._loading);assert.equal(await p.locator('#a .tb-text').textContent(),'My old artwork');assert.ok((await pixel(p,40,50))[3]>0);assert.deepEqual(errors,[]);await p.close();
});
test('drawing, eraser, undo, redo and shape fill use the saved bitmap',async()=>{
 const {page:p,errors}=await open();await stroke(p,'pen',40,450,180,450);assert.ok((await pixel(p,100,450))[3]>0);
 await stroke(p,'erase',95,445,105,455);assert.equal((await pixel(p,100,450))[3],0);
 await p.locator('#a [data-history=undo]').click();await p.waitForFunction(()=>!document.querySelector('#a .draw-layer')._loading);assert.ok((await pixel(p,100,450))[3]>0);
 await p.locator('#a [data-history=redo]').click();await p.waitForFunction(()=>!document.querySelector('#a .draw-layer')._loading);assert.equal((await pixel(p,100,450))[3],0);
 await stroke(p,'rect',220,430,320,530);await p.locator('#a [data-color="#e53935"]').first().click();await stroke(p,'fill',270,480,270,480);assert.deepEqual((await pixel(p,270,480)).slice(0,3),[229,57,53]);assert.equal((await pixel(p,190,480))[3],0);
 assert.ok(await p.evaluate(()=>S.a_draw[0].startsWith('data:image/png')));assert.deepEqual(errors,[]);await p.close();
});
test('text, Torah stickers, picture actions and backgrounds persist with undo',async()=>{
 const {page:p,errors}=await open();await p.getByRole('button',{name:'Add text box'}).click();await p.locator('#a .tb-text').fill('My mitzvah');await p.locator('#a .studio-more-stickers>summary').click();await p.getByRole('button',{name:'Torah',exact:true}).click();assert.equal(await p.locator('#a .studio-sticker img').getAttribute('alt'),'Torah');
 await p.evaluate(()=>openCustomizer(document.querySelector('#a .studio-sticker')));await p.getByRole('button',{name:'Flip picture',exact:true}).click();assert.equal(await p.locator('#a .studio-sticker img').evaluate(e=>e.style.transform),'scaleX(-1)');await p.getByRole('button',{name:'Copy',exact:false}).last().click();assert.equal(await p.locator('#a .studio-sticker').count(),2);await p.getByRole('button',{name:'Done',exact:false}).click();
 await p.getByRole('tab',{name:/Page styles/}).click();await p.getByRole('button',{name:'Sky',exact:false}).click();assert.equal(await p.locator('#a .page').first().getAttribute('data-studio-bg'),'sky');await p.locator('#a [data-history=undo]').click();assert.equal(await p.locator('#a .page').first().getAttribute('data-studio-bg'),'');await p.reload();await p.getByRole('button',{name:/סימן א/}).click();assert.equal(await p.locator('#a .tb-text').textContent(),'My mitzvah');assert.equal(await p.locator('#a .studio-sticker').count(),2);assert.deepEqual(errors,[]);await p.screenshot({path:process.env.HALACHA_TEST_SCREENSHOT||'/tmp/halacha-studio.png',fullPage:true});await p.close();
});
test('teacher student-work inspection is read only',async()=>{
 const {page:p,errors}=await open('?teacherView=demo',true);const before=await p.evaluate(()=>JSON.stringify(S));assert.equal(await p.getByRole('button',{name:'Add text box'}).isEnabled(),false);await p.evaluate(()=>{studioSticker('a','torah');studioText('a');studioBackground('a','sky');studioMode('a',0,'pen');});assert.equal(await p.evaluate(()=>JSON.stringify(S)),before);assert.equal(await p.locator('#a .tb-text').getAttribute('contenteditable'),'false');assert.deepEqual(errors,[]);await p.close();
});
test('each Halacha seif shows five title ideas without opening the Words tab',async()=>{
 const {page:p,errors}=await open('?teacherView=title-visibility-test');
 for(const lesson of await p.evaluate(()=>lessons.map(l=>({id:l.id,title:l.title})))){
  await p.evaluate(id=>show(id),lesson.id);
  const info=await p.locator('#'+lesson.id+' .hal-title-guidance').evaluate(e=>({
   visible:e.getClientRects().length>0,open:e.open,
   choices:e.querySelectorAll('.hal-title-choice').length,
   outsideHiddenTabs:!e.closest('.studio-shelf-pane'),
   hasCustom:e.querySelector('.hal-title-input')!==null
  }));
  assert.equal(info.visible,true,lesson.id+' title suggestions should be visible');
  assert.equal(info.open,true,lesson.id+' title suggestions should be expanded');
  assert.equal(info.choices,5,lesson.id+' should offer five relevant title suggestions');
  assert.equal(info.outsideHiddenTabs,true,lesson.id+' should not hide titles behind supply tabs');
  assert.equal(info.hasCustom,true,lesson.id+' should allow composing a custom title');
 }
 assert.deepEqual(errors,[]);await p.close();
});
test('student Siman locks, all lessons and existing exports remain available',async()=>{
 const {page:p}=await open();assert.equal(await p.locator('.section[data-studio]').count(),await p.evaluate(()=>lessons.length));assert.ok(await p.evaluate(()=>lessons.length===32));assert.equal(await p.evaluate(()=>isSimanUnlocked('ב')),false);await p.evaluate(()=>openSiman('ב'));assert.equal(await p.locator('.section.on').getAttribute('id'),'a');await p.getByRole('button',{name:'Print / PDF / Slides'}).click();assert.ok(await p.locator('#exportDlg').isVisible());assert.ok((await p.locator('.expSec').count())>=6);await p.close();
});

test('reset is reversible and student account autosave retains the existing path and state',async()=>{
 const {page:p,errors}=await open('',false,'studio-test-only');
 await p.evaluate(()=>{window.testWrites=[];halachaDb={ref:path=>({set:value=>{window.testWrites.push({path,value:JSON.parse(JSON.stringify(value))});return Promise.resolve();}})};window.firebase={database:{ServerValue:{TIMESTAMP:123}}};});
 await p.getByRole('button',{name:'Add text box'}).click();await p.locator('#a .tb-text').fill('Keep my work');
 await stroke(p,'pen',50,450,150,450);
 await p.waitForFunction(()=>window.testWrites.length>0);
 assert.equal(await p.evaluate(()=>window.testWrites.at(-1).path),'b3Games/students/studio-test-only/halacha/siman1');
 assert.ok(await p.evaluate(()=>window.testWrites.at(-1).value.state.a_scrap_pages[0].includes('Keep my work')));
 assert.ok(await p.evaluate(()=>window.testWrites.at(-1).value.state.a_draw[0].startsWith('data:image/png')));
 await p.evaluate(()=>resetScrapbookPage('a'));assert.equal(await p.locator('#a .scrap').count(),0);
 await p.locator('#a [data-history=undo]').click();await p.waitForFunction(()=>!document.querySelector('#a .draw-layer')._loading);
 assert.equal(await p.locator('#a .tb-text').textContent(),'Keep my work');assert.ok((await pixel(p,100,450))[3]>0);assert.deepEqual(errors,[]);await p.close();
});
test('text box gets a contextual toolbar with familiar formatting and direct editing',async()=>{
 const {page:p,errors}=await open();await p.getByRole('button',{name:'Add text box'}).click();assert.ok(await p.locator('.studio-context').isVisible());assert.ok(await p.locator('#a .book>.studio-context').count());
 await p.locator('#a .tb-text').fill('My Torah idea');await p.getByRole('button',{name:'Bold',exact:true}).click();await p.getByRole('button',{name:'Align center',exact:true}).click();await p.getByLabel('Text size',{exact:true}).fill('30');await p.getByLabel('Text size',{exact:true}).press('Tab');await p.locator('#pcText').selectOption('#e53935');await p.locator('#pcBg').selectOption('transparent');
 const style=await p.locator('#a .textbox').evaluate(e=>({size:e.style.fontSize,weight:e.style.fontWeight,align:e.style.textAlign,color:e.style.color,clear:e.classList.contains('clear')}));assert.deepEqual(style,{size:'30px',weight:'700',align:'center',color:'rgb(229, 57, 53)',clear:true});assert.equal(await p.locator('#studioPieceText').count(),0);if(process.env.HALACHA_TEST_SCREENSHOT)await p.screenshot({path:process.env.HALACHA_TEST_SCREENSHOT,fullPage:true});await p.reload();await p.getByRole('button',{name:/סימן א/}).click();assert.equal(await p.locator('#a .tb-text').textContent(),'My Torah idea');assert.equal(await p.locator('#a .textbox').evaluate(e=>e.style.fontSize),'30px');assert.deepEqual(errors,[]);await p.close();
});

test('Seif Aleph lesson is complete, RTL, ordered for the weekly plan, and independently collapsible',async()=>{
 const {page:p,errors}=await open();
 const order=await p.locator('#tabs button').evaluateAll(nodes=>nodes.map(n=>n.dataset.id).filter(id=>['a','c','b','f','d','e'].includes(id)));
 assert.deepEqual(order.slice(0,6),['a','c','b','f','d','e']);
 if(process.env.HALACHA_LESSON_SCREENSHOT)await p.screenshot({path:process.env.HALACHA_LESSON_SCREENSHOT,fullPage:true});
 const text=p.locator('#a .hal-a-full-text');
 assert.equal(await text.getAttribute('dir'),'rtl');
 const source=await text.textContent();
 assert.ok(source.length>650,'complete Hebrew source should be present');
 assert.ok(source.includes('וְיֵבוֹשׁ מִמֶּנּוּ'));
 assert.ok(source.includes('אוֹרַח חַיִּים סָעִיף א'));
 assert.doesNotMatch(source,/\.\.\./);
 const phrases=await p.locator('#a .hal-a-phrase>summary').allTextContents();
 assert.match(phrases[0],/שִׁוִיתִי.*לְנֶגְדִּי.*תָמִיד/);
 assert.match(phrases[1],/מְלֹא.*הָאָרֶץ.*כְּבוֹדוֹ/);
 await p.locator('#a .hal-a-reading>summary').click();
 assert.equal(await p.locator('#a .hal-a-reading').evaluate(e=>e.open),false);
 await p.locator('#a .hal-a-reading>summary').click();
 const book=p.locator('#a .book');const before=await book.evaluate(e=>e.getBoundingClientRect().width);
 await p.getByRole('button',{name:/Hide Activity/}).click();
 assert.equal(await p.locator('#a .hal-a-body').isVisible(),false);
 const after=await book.evaluate(e=>e.getBoundingClientRect().width);assert.ok(after>before);
 if(process.env.HALACHA_COLLAPSED_SCREENSHOT)await p.screenshot({path:process.env.HALACHA_COLLAPSED_SCREENSHOT,fullPage:true});
 await p.getByRole('button',{name:/Show \/ Review Activity/}).click();
 assert.equal(await p.locator('#a .hal-a-body').isVisible(),true);
 const notes=p.locator('#a .hal-a-teacher-notes');assert.equal(await notes.isVisible(),false);
 assert.deepEqual(errors,[]);await p.close();
 const {page:t,errors:teacherErrors}=await open('?teacherView=halacha-synthetic');
 await t.evaluate(()=>{setHalachaMode(true);openSiman('א')});
 assert.equal(await t.locator('#a .hal-a-teacher-notes').isVisible(),true);
 assert.equal(await t.getByRole('button',{name:'Add text box'}).isEnabled(),false);
 if(process.env.HALACHA_TEACHER_SCREENSHOT)await t.screenshot({path:process.env.HALACHA_TEACHER_SCREENSHOT,fullPage:true});
 assert.deepEqual(teacherErrors,[]);await t.close();
});

test('picture practice retries, title ideas are editable, themed stickers and pasted pictures persist',async()=>{
 const {page:p,errors}=await open('',false,'halacha-seif-a-synthetic');
 const wrong=p.getByRole('button',{name:/leaves his toys scattered/});
 await wrong.click();assert.match(await p.locator('#a .hal-a-feedback').textContent(),/Try again/);
 const correct=p.getByRole('button',{name:/puts his toys away carefully/});
 await correct.click();assert.match(await p.locator('#a .hal-a-feedback').textContent(),/Yes!/);
 assert.equal(await p.locator('#a .scrap').count(),0,'answering does not auto-fill the scrapbook');
 await p.getByRole('tab',{name:/Words/}).click();
 await p.getByRole('button',{name:'Does It Matter How I Behave When Nobody Is Watching?'}).click();
 const title=p.locator('#a .tb-text').last();assert.equal(await title.getAttribute('contenteditable'),'true');
 await title.fill('My own edited title');
 await p.getByRole('tab',{name:/Pictures/}).click();
 await p.locator('#a .studio-shelf-extra-pictures:has(.hal-sticker-shelf) > summary').click();
 assert.equal(await p.getByRole('button',{name:'Home',exact:true}).count(),1);
 assert.equal(await p.getByRole('button',{name:'Shofar',exact:true}).count(),0);
 await p.getByRole('button',{name:'Home',exact:true}).click();
 assert.equal(await p.locator('#a .studio-sticker img[alt="Home"]').count(),1);
 const position=await title.evaluate(e=>({left:e.closest('.scrap').style.left,top:e.closest('.scrap').style.top}));
 await p.getByRole('tab',{name:/Page styles/}).click();
 await p.getByRole('button',{name:'Photo album',exact:false}).click();
 assert.deepEqual(await title.evaluate(e=>({left:e.closest('.scrap').style.left,top:e.closest('.scrap').style.top})),position);
 assert.equal(await p.locator('#a .page').first().getAttribute('data-studio-bg'),'photo');
 await p.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;const ctx=canvas.getContext('2d');ctx.fillStyle='#3b82f6';ctx.fillRect(0,0,16,16);canvas.toBlob(blob=>{const transfer=new DataTransfer();transfer.items.add(new File([blob],'pasted-screenshot.png',{type:'image/png'}));document.querySelector('#a .work').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:transfer}));},'image/png')});
 await p.waitForFunction(()=>document.querySelectorAll('#a .scrap img[src^="data:image/png"]').length>0);
 await p.reload();await p.getByRole('button',{name:/סימן א/}).click();
 assert.equal(await p.locator('#a .tb-text').last().textContent(),'My own edited title');
 assert.equal(await p.locator('#a .studio-sticker img[alt="Home"]').count(),1);
 assert.equal(await p.locator('#a .page').first().getAttribute('data-studio-bg'),'photo');
 assert.ok(await p.locator('#a .scrap img[src^="data:image/png"]').count()>0);
 assert.deepEqual(errors,[]);await p.close();
});


test('opening selected-piece controls never squeezes scrapbook pages into the drawing rail',async()=>{
 const {page:p,errors}=await open();
 for(const width of [1277,900]){
  await p.setViewportSize({width,height:900});
  const before=await p.locator('#a .page').first().boundingBox();
  await p.getByRole('button',{name:'Add text box'}).click();
  assert.ok(await p.locator('#a .book>.studio-context.show').isVisible());
  const bounds=await p.evaluate(()=>{
   const r=selector=>document.querySelector('#a '+selector).getBoundingClientRect();
   const first=r('.page'),pages=r('.spread'),rail=r('.studio-draw-rail'),toolbar=r('.book>.studio-context.show');
   return {pageWidth:first.width,spreadLeft:pages.left,spreadRight:pages.right,railLeft:rail.left,
    railTop:rail.top,pageTop:first.top,toolbarWidth:toolbar.width};
  });
  assert.ok(bounds.pageWidth>250,'page stays readable with editing controls at '+width+'px');
  assert.ok(Math.abs(bounds.pageWidth-before.width)<2,'opening toolbar does not resize existing artwork');
  assert.ok(bounds.spreadRight<=bounds.railLeft+2,'drawing rail stays beside pages');
  assert.ok(Math.abs(bounds.railTop-bounds.pageTop)<2,'drawing rail is aligned with pages');
  assert.ok(bounds.toolbarWidth>bounds.pageWidth,'editing controls use full book width');
  await p.getByRole('button',{name:'Done editing'}).click();
  const closed=await p.locator('#a .page').first().boundingBox();
  assert.ok(Math.abs(closed.width-before.width)<2,'closing toolbar does not resize artwork');
 }
 assert.deepEqual(errors,[]);
 await p.close();
});
