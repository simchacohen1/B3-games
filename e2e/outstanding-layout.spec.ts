import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const read=(p:string)=>fs.readFileSync(p,'utf8');
const strip=(s:string)=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
function section(s:string,start:string,end:string){const a=s.indexOf(start),b=s.indexOf(end,a+start.length);if(a<0||b<a)throw Error('Missing '+start);return s.slice(a,b)}
test('first Shorashim card fits normal zoom and renders text before mouse movement',async({page})=>{
 await page.setViewportSize({width:1280,height:800});
 await page.route('https://layout.test/**',route=>route.fulfill({contentType:'text/html',body:strip(read('shorashim/index.html'))}));
 await page.goto('https://layout.test/shorashim/index.html');
 await page.addStyleTag({content:read('shorashim/shorashim-skin.css')+'\n'+read('shorashim/compact-cards.css')});
 await page.evaluate(()=>{
  document.body.classList.add('shorashim-learning-active');
  document.querySelectorAll('.screen').forEach(e=>e.classList.remove('active'));document.getElementById('learnScreen')!.classList.add('active');
  document.getElementById('learnWorkspace')!.classList.remove('hidden');document.getElementById('editorContent')!.classList.remove('hidden');document.getElementById('emptyEditor')!.classList.add('hidden');
  document.getElementById('editorTitle')!.textContent='אברהם — sample';document.getElementById('hebrewText')!.textContent='אַבְרָהָם';document.getElementById('englishText')!.textContent='Avraham';
  (document.getElementById('hebrewSize') as HTMLInputElement).value='58';(document.getElementById('englishSize') as HTMLInputElement).value='46';
  (window as any).applyArtSize=()=>{};
 });
 const app=read('shorashim/app.js');await page.addScriptTag({content:section(app,'const CARD_DESIGN_WIDTH=','function applyEditorControls()')});
 await page.addScriptTag({content:read('shorashim/index.html').match(/<script data-shorashim-workspace-ux="v1">([\s\S]*?)<\/script>/)![1]});
 await page.addScriptTag({content:read('shorashim/compact-cards.js')});
 await page.waitForFunction(()=>parseFloat(document.getElementById('hebrewText')!.style.fontSize)>38);
 const initial=await page.locator('#hebrewText').evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
 expect(initial).toBeGreaterThan(38);await expect(page.locator('.ux-quick-save')).toBeVisible();await expect(page.locator('#saveCardBtn')).toBeHidden();
 await page.evaluate(()=>Promise.all(document.querySelector('.sc-flipper')!.getAnimations().map(a=>a.finished.catch(()=>{}))));
 const front=await page.locator('#frontCard').boundingBox();expect(front!.width).toBeGreaterThan(430);expect(front!.x+front!.width).toBeLessThanOrEqual(1280);
 await page.getByRole('button',{name:'Flip the card'}).click();await expect(page.locator('#backCard')).toBeVisible();await expect(page.locator('#frontCard')).toBeHidden();
 await page.getByRole('button',{name:'Flip the card'}).click();await expect(page.locator('#frontCard')).toBeVisible();
 await page.setViewportSize({width:540,height:740});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(540);
});
test('Pointer menus, dragging and stop-sharing stay inside a smaller fullscreen viewport',async({page})=>{
 await page.setViewportSize({width:780,height:640});
 await page.route('https://layout.test/**',route=>route.fulfill({contentType:'text/html',body:strip(read('class-pointer-prototype/classroom.html'))}));await page.goto('https://layout.test/classroom.html?dashboard=teacher&class=et');
 await page.addStyleTag({content:read('class-pointer-prototype/classroom.css')});
 await page.evaluate(()=>{document.getElementById('teacherPanel')!.hidden=false;document.getElementById('studentPanel')!.hidden=true;(document.getElementById('stopScreen') as HTMLButtonElement).disabled=false});
 for(const f of ['classroom-core.js','teacher-toolbar.js','lesson-fullscreen.js','menu-viewport.js'])await page.addScriptTag({content:read('class-pointer-prototype/'+f)});
 await page.evaluate(()=>Object.assign(window,{C:(window as any).ClassPointerCore,$:(id:string)=>document.getElementById(id),isTeacher:true,navigating:false,allowed:()=>true,writingAllowed:()=>false,live:()=>true,highlighter:null,cancelHover:()=>{}}));
 await page.addScriptTag({content:section(read('class-pointer-prototype/classroom.js'),'function pointerPermission(){','function drawPointers(){')});
 for(const tool of ['target','sparkle','heart','paw','roar','pen']){
  const cursor=await page.evaluate(tool=>{(document.getElementById('teacherTool') as HTMLSelectElement).value=tool;(window as any).pointerPermission();return document.getElementById('stage')!.style.cursor},tool);
  expect(cursor).toBe(['target','pen'].includes(tool)?'default':'none');
 }

 await page.locator('#tbFullscreen').click();await page.locator('#tbStudentsBtn').click();
 const panel=page.locator('#tbStudentsMenu');
 async function inside(){await expect.poll(async()=>{const r=await panel.boundingBox();return !!r&&r.x>=0&&r.y>=0&&r.x+r.width<=781&&r.y+r.height<=641}).toBe(true)}
 await inside();const handle=await page.locator('.tb-roster-handle').boundingBox();const before=await panel.boundingBox();
 await page.mouse.move(handle!.x+40,handle!.y+15);await page.mouse.down();await page.mouse.move(handle!.x+140,handle!.y+75,{steps:5});await page.mouse.up();await inside();
 const after=await panel.boundingBox();expect(Math.abs(after!.x-before!.x)+Math.abs(after!.y-before!.y)).toBeGreaterThan(10);
 await page.keyboard.press('Escape');await page.locator('#tbFullscreen').click();await page.locator('#tbCollapse').click();await expect(page.locator('#tbStopShare')).toBeVisible();
 const stop=await page.locator('#tbStopShare').boundingBox();expect(stop!.x).toBeGreaterThanOrEqual(0);expect(stop!.x+stop!.width).toBeLessThanOrEqual(780);
});
test('Posuk shows voice controls for three questions and tap controls for two',async({page})=>{
 const html=read('record_pesukim/student.html');await page.route('https://layout.test/**',route=>route.fulfill({contentType:'text/html',body:strip(html)}));await page.goto('https://layout.test/student.html');
 await page.evaluate(()=>Object.assign(window,{comprehensionMode:'questions',comprehensionQIndex:0,comprehensionQuestions:[...Array.from({length:3},(_,i)=>({question:'Spoken '+i,answerMode:'voice'})),...Array.from({length:2},(_,i)=>({question:'Tap '+i,answerMode:'tap',answerWordSets:[[0]],posukNum:1}))],comprehensionQResults:{},questionSelectionDrafts:{},currentAudio:{},currentAudioExt:{},questionProgressDots:()=>'',renderAnsweredQuestionHistory:()=>{},renderQuestionFinalScore:()=>{},questionIsCorrect:(r:any)=>!!r&&(r.finalVerdict||r.verdict)==='correct',getQuestionPosukWords:()=>['אַבְרָהָם','אֹהֶל']}));
 await page.addScriptTag({content:section(html,'function renderQuestionWordChoices(','function renderQuestionResult(')});
 await page.addScriptTag({content:section(html,'function renderComprehensionQuestionUI(){','function resetRecordingUI(){')});
 for(let index=0;index<5;index++){
  await page.evaluate(index=>{(window as any).comprehensionQIndex=index;(window as any).renderComprehensionQuestionUI()},index);
  expect(await page.locator('#questionWordChoices').evaluate(e=>(e as HTMLElement).hidden)).toBe(index<3);
  expect(await page.locator('#comprehensionRecordCaption').evaluate(e=>e.closest('.record-stage')!.classList.contains('hidden'))).toBe(index>=3);
  await expect(page.locator('#questionAnswerInstruction')).toHaveText(index<3?'🎙️ Answer this question aloud.':'Tap all the Hebrew words that answer the question.');
 }
});
test('student-preview banner moves and bottom navigation does not overlap gallery controls',async({page})=>{
 await page.setViewportSize({width:540,height:740});await page.route('https://layout.test/**',route=>route.fulfill({contentType:'text/html',body:'<body><a id="b3HomeButton" style="position:fixed;left:10px;bottom:10px;padding:10px">Back to Fun Torah Tools</a><button id="fttGalleryShareButton">Add to Gallery</button></body>'}));await page.goto('https://layout.test/fixture.html');
 const gallery=read('gallery-share.js').match(/css.textContent = `([\s\S]*?)`;/)![1];await page.addStyleTag({content:gallery});
 await page.evaluate(()=>Object.assign(window,{getActingStudent:()=>({name:'Sample pupil',className:'ET'}),actingEsc:(s:string)=>s,stopActingAsStudent:()=>{(window as any).exited=true}}));
 await page.addScriptTag({content:section(read('site-settings.js'),'  function showActingBanner()','  function openActAsStudentPicker()')+'\nshowActingBanner();'});
 const nav=await page.locator('#b3HomeButton').boundingBox(),galleryBox=await page.locator('#fttGalleryShareButton').boundingBox();expect(galleryBox!.y+galleryBox!.height).toBeLessThan(nav!.y);
 const before=await page.locator('#b3ActingBanner').boundingBox(),handle=await page.getByRole('button',{name:'Drag student preview banner'}).boundingBox();
 await page.mouse.move(handle!.x+20,handle!.y+10);await page.mouse.down();await page.mouse.move(handle!.x+40,handle!.y-100,{steps:5});await page.mouse.up();
 const after=await page.locator('#b3ActingBanner').boundingBox();expect(before!.y-after!.y).toBeGreaterThan(50);expect(after!.x).toBeGreaterThanOrEqual(0);expect(after!.x+after!.width).toBeLessThanOrEqual(540);
 await page.getByRole('button',{name:'Exit student view'}).click();expect(await page.evaluate(()=>(window as any).exited)).toBe(true);
});
