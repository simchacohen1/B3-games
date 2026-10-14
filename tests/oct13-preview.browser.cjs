const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {resolveFixtureFile} = require('./helpers/local-fixture-path.cjs');
const root = path.resolve(__dirname, '..'), out = path.join(root,'test-results','oct13-preview');
fs.mkdirSync(out,{recursive:true});
const results = [];
let browser;
const skipScripts = new Set(['game-gate.js','site-settings.js','guest-mode.js','back-nav.js','teacher-preview.js','student-class.js','teacher-student-split.js']);
async function fixture() {
  const page = await browser.newPage({acceptDownloads:true});
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'audit.test') return route.fulfill({status:200,contentType:'application/javascript',body:''});
    let file = decodeURIComponent(u.pathname).replace(/^\//,'');
    if (!file || file === 'fixture.html') return route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'});
    if (skipScripts.has(path.basename(file))) return route.fulfill({contentType:'application/javascript',body:''});
    const resolved = resolveFixtureFile(root,file);
    if (!resolved || !fs.existsSync(resolved)) return route.fulfill({status:404,body:''});
    const type = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'}[path.extname(file)];
    return route.fulfill({path:resolved,contentType:type});
  });
  return page;
}
async function check(name, run) {
  try { await run(); results.push({name,status:'LOCAL PASS'}); }
  catch(e) { results.push({name,status:'LOCAL FAIL',error:e.message}); }
  console.log(results.at(-1));
}
(async()=>{
  browser = await chromium.launch({executablePath:process.env.FTT_TEST_CHROMIUM||undefined,headless:true});
  await check('Shorashim: real audio metadata, reconnect, approval, and reused sign-in', async()=>{
    const page=await fixture();await page.goto('https://audit.test/fixture.html');
    await page.setContent('<div id="recordingsBadge"></div><button id="recordingsGoogleSignIn">Sign in</button><div id="recordingsAuthStatus"></div><div id="shorashimRecordingsList"></div>');
    // A generated silent WAV is non-sensitive test audio, never a student recording.
    const samples=10000,wav=Buffer.alloc(44+samples*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
    await page.route('**/sample.wav',route=>route.fulfill({contentType:'audio/wav',body:wav}));
    await page.evaluate(()=>{
      window.$=id=>document.getElementById(id);window.esc=value=>String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
      window.CLASS_ID='';window.teacherRosterScope=null;window.SPACE='test-only-recordings';window.STUDENT_REWARDS_AUTO_AWARD_URL='https://audit.test/rewards';window.shorashimRecordingRows=[];
      const row={studentName:'Sample student',audioURL:'https://audit.test/sample.wav',durationMs:7500,status:'pending',createdAt:1};
      window.db={ref:()=>({once:async()=>({forEach:student=>student({key:'test-only-student',forEach:event=>event({key:'test-event',val:()=>({...row})})})})})};
      window.audit={popups:0,requests:[],alerts:[]};window.alert=message=>window.audit.alerts.push(message);
      const user={email:'simcha5770@gmail.com',getIdToken:async()=> 'test-only-token'};
      window.firebase={auth:()=>({currentUser:user,onAuthStateChanged:callback=>callback(user),signInWithPopup:()=>{window.audit.popups++;throw Error('Unexpected popup')}})};
      window.fetch=async(url,options)=>{const body=JSON.parse(options.body);window.audit.requests.push(body);if(body.action==='repair-shorashim-recording'){row.pointRequestId='test-request';row.pointRequestStatus='pending'}else if(body.action==='approve-point-request')row.pointRequestStatus='approved';return {ok:true,json:async()=>({ok:true})}};
    });
    const source=fs.readFileSync(path.join(root,'shorashim/teacher.js'),'utf8');
    const start=source.indexOf('function recordingTime('),end=source.indexOf('// Existing local dashboard unlocks',start);assert.ok(start>=0&&end>start);
    await page.addScriptTag({content:source.slice(start,end)});
    await page.evaluate(()=>{window.dispatchEvent(new Event('DOMContentLoaded'));return loadShorashimRecordings()});
    await page.waitForFunction(()=>document.querySelector('[data-recording-duration]').textContent==='Length: 0:01');
    assert.equal(await page.locator('#recordingsGoogleSignIn').isVisible(),false);
    await page.getByRole('button',{name:'Reconnect points request'}).click();await page.getByRole('button',{name:/Approve 2 Points/}).click();
    await page.waitForFunction(()=>document.getElementById('shorashimRecordingsList').textContent.includes('✅ Approved'));
    const result=await page.evaluate(()=>window.audit);assert.equal(result.popups,0);assert.deepEqual(result.alerts,[]);
    assert.deepEqual(result.requests.map(r=>r.action),['repair-shorashim-recording','approve-point-request']);
    await page.screenshot({path:path.join(out,'shorashim-local.png'),fullPage:true});await page.close();
  });
  await check('Classroom: move/resize permissions, fullscreen controls, and combined screens', async()=>{
    const page=await fixture();await page.setViewportSize({width:1400,height:1000});
    const html=fs.readFileSync(path.join(root,'class-pointer-prototype/classroom.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
    await page.route('**/class-pointer-prototype/classroom.html*',route=>route.fulfill({contentType:'text/html',body:html}));
    await page.goto('https://audit.test/class-pointer-prototype/classroom.html?dashboard=teacher&class=et');
    await page.evaluate(()=>{
      document.getElementById('teacherPanel').hidden=false;
      document.getElementById('studentPanel').hidden=true;
      document.getElementById('studentBoards').disabled=false;
      const members=new Map([['a',{id:'a',name:'Test ET student',admitted:true,connection:{id:'a'}}],['b',{id:'b',name:'Second test student',admitted:true,connection:{id:'b'}}]]);
      window.auditScreens=[];
      window.ClassPointerBridge={isTeacher:true,started:()=>true,members:()=>members,send(){},status(){},fail(){}};
      window.ClassPointerDashboard={setStudentScreenSharing:async enabled=>window.auditScreens.push(enabled)};
    });
    for(const file of ['classroom-core.js','student-boards.js','teacher-toolbar.js','lesson-fullscreen.js'])await page.addScriptTag({url:'https://audit.test/class-pointer-prototype/'+file});
    await page.locator('#tbStudentsBtn').click();
    const panel=page.locator('#tbStudentsMenu');assert.equal(await panel.evaluate(e=>getComputedStyle(e).resize),'both');
    const handle=page.locator('.tb-roster-handle'),before=await panel.boundingBox(),r=await handle.boundingBox();
    await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2-150,r.y+r.height/2+90,{steps:8});await page.mouse.up();
    const moved=await panel.boundingBox();assert.ok(Math.abs(moved.x-before.x)>30 || Math.abs(moved.y-before.y)>30);
    await page.mouse.move(moved.x+moved.width-3,moved.y+moved.height-3);await page.mouse.down();await page.mouse.move(moved.x+moved.width-50,moved.y+moved.height+60,{steps:8});await page.mouse.up();
    const resized=await panel.boundingBox();assert.ok(Math.abs(resized.height-moved.height)>10 || Math.abs(resized.width-moved.width)>10);
    await page.keyboard.press('Escape');
    await page.locator('#tbStudentScreensQuick').click();assert.equal(await page.locator('.board-tile').count(),2);
    assert.equal(await page.evaluate(()=>window.auditScreens.at(-1)),true);
    await page.locator('#tbFullscreen').click();await page.waitForFunction(()=>document.getElementById('stage').classList.contains('lesson-fullscreen'));
    assert.equal(await page.locator('#teacherDock').evaluate(e=>e.parentElement.id),'stage');
    await page.screenshot({path:path.join(out,'classroom-local.png'),fullPage:true});
    await page.locator('#tbFullscreen').click();await page.waitForFunction(()=>!document.getElementById('stage').classList.contains('lesson-fullscreen'));
    await page.close();
  });
  await check('Sefer: previous day, Hebrew title, coloring, and PNG download', async()=>{
    const page=await fixture();
    await page.addInitScript(()=>{ const D=Date;window.Date=class extends D {constructor(...a){super(...(a.length?a:['2026-10-13T18:00:00Z']))}static now(){return new D('2026-10-13T18:00:00Z').getTime()}}; });
    await page.goto('https://audit.test/sefer-hamitzvos/index.html');
    await page.waitForFunction(()=>document.getElementById('outline').complete && document.getElementById('outline').naturalWidth>0);
    const card=await page.locator('#card').inputValue();assert.equal(Number(card),477);
    assert.ok(await page.evaluate(()=>exportCanvas().height > document.getElementById('paint').height));
    assert.equal(await page.locator('#tomorrow').isDisabled(),true);
    await page.locator('#yesterday').click();assert.equal(Number(await page.locator('#card').inputValue()),476);
    await page.locator('#today').click();assert.equal(Number(await page.locator('#card').inputValue()),477);
    await page.waitForFunction(()=>document.getElementById('outline').complete && document.getElementById('outline').naturalWidth>0);
    const canvas=page.locator('#paint');await canvas.scrollIntoViewIfNeeded();const r=await canvas.boundingBox();
    await page.mouse.move(r.x+r.width*.3,r.y+r.height*.5);await page.mouse.down();await page.mouse.move(r.x+r.width*.5,r.y+r.height*.5,{steps:8});await page.mouse.up();
    assert.ok(await page.evaluate(()=>strokes.length>0));
    const downloadEvent=page.waitForEvent('download');await page.locator('#save').click();const download=await downloadEvent;
    await download.saveAs(path.join(out,download.suggestedFilename()));assert.ok(fs.statSync(path.join(out,download.suggestedFilename())).size>1000);
    await page.screenshot({path:path.join(out,'sefer-local.png'),fullPage:true});await page.close();
  });
  await check('Yiddish: four vocabulary cards display nekudos', async()=>{
    const page=await fixture();
    const C={window:{}};require('node:vm').runInNewContext(fs.readFileSync(path.join(root,'yiddish/content.js'),'utf8'),C);
    const config={version:1,unlocked:{et:4,wt:4},sections:[0,1,2,3].map(g=>({start:g*300,end:g*300+300,verified:true,words:C.window.YIDDISH_CONTENT.words.filter(w=>w.group===g).map(w=>w.id)}))};
    await page.addInitScript(config=>{window.YiddishAPI={preview:true,ready:Promise.resolve(),call:async()=>({student:{id:'test-only',name:'Test student',classId:'et'},config,progress:{}})};},config);
    await page.route('**/yiddish/api.js*',route=>route.fulfill({contentType:'application/javascript',body:''}));
    await page.goto('https://audit.test/yiddish/index.html');await page.waitForSelector('#words .word .yi');
    const cards=await page.locator('#words .word .yi').allTextContents();assert.equal(cards.length,4);assert.ok(cards.every(s=>/[\u05b0-\u05bc\u05c1\u05c2\u05c7]/.test(s)));
    await page.screenshot({path:path.join(out,'yiddish-local.png'),fullPage:true});await page.close();
  });
  await check('Rashi: rendered page contains no video embeds', async()=>{
    const page=await fixture();await page.goto('https://audit.test/rashi-letters/student.html');
    assert.equal(await page.locator('video,iframe[src*="youtube"],iframe[src*="youtu.be"],iframe[src*="vimeo"]').count(),0);
    await page.screenshot({path:path.join(out,'rashi-local.png'),fullPage:true});await page.close();
  });
  await check('Game Show: a single question generator is rendered', async()=>{
    const page=await fixture();await page.goto('https://audit.test/fixture.html');
    await page.setContent('<div id="tabSetup"><div class="setup-grid"></div></div><div id="editorList"></div>');
    await page.evaluate(()=>{window.createQuestionRow=()=>document.createElement('div')});
    const html=fs.readFileSync(path.join(root,'game-show/teacher.html'),'utf8');
    const sources=[...html.matchAll(/<script src="(question-generator-grade3-v4\.js[^\"]*)"/g)].map(m=>m[1]);
    for(const src of sources)await page.addScriptTag({url:'https://audit.test/game-show/'+src});
    assert.equal(await page.locator('#sefariaGenerator').count(),1);await page.close();
  });
  await check('Sharing companion: options, verified class, and close cleanup', async()=>{
    const page=await fixture();await page.goto('https://audit.test/class-pointer-prototype/share-window.html');
    await page.evaluate(()=>{
      delete window.__classPointerActivityShareLoaded;
      sessionStorage.setItem('b3Games_studentId','test-only-student');sessionStorage.setItem('b3Games_classPin','test-only-pin');
      const room='class-pointer-12345678-1234-1234-1234-123456789abc';
      window.audit={stops:0,options:null,sessionPath:null};
      const db={ref:path=>{if(path.endsWith('/classPointerSessions'))window.audit.sessionPath=path;return {on:(event,listener)=>listener({val:()=>path.endsWith('/classPointerSessions')?({[room]:{roomId:room,createdAt:Date.now(),studentScreenSharing:true}}):({active:true,members:{'test-only-student':{active:true}}})})}}};
      window.firebase={apps:[{}],database:()=>db};window.B3_FIREBASE_CONFIG={};
      window.FunTorahStudentClass={resolve:async()=>({workspaceId:'b3-2026',classId:'et'})};
      window.fetch=async(url,options)=>({ok:true,json:async()=>({ok:true,token:'0'.repeat(64)})});
      const track={stop:()=>window.audit.stops++,addEventListener(){}};
      const stream={active:true,getTracks:()=>[track],getVideoTracks:()=>[track]};
      Object.defineProperty(navigator,'mediaDevices',{value:{getDisplayMedia:async options=>{window.audit.options=options;return stream}}});
      window.Peer=class {once(event,listener){if(event==='open')setTimeout(listener,0)}destroy(){}call(){return {on(){},close(){}}}};
    });
    await page.addScriptTag({url:'https://audit.test/class-pointer-prototype/activity-share.js'});
    await page.waitForSelector('#fttActivityScreenShare button');await page.locator('#fttActivityScreenShare button').click();
    await page.waitForFunction(()=>document.querySelector('#fttActivityScreenShare button').textContent.includes('Stop Sharing'));
    const state=await page.evaluate(()=>window.audit);assert.match(state.sessionPath,/\/classes\/et\/classPointerSessions$/);
    assert.equal(state.options.preferCurrentTab,false);assert.equal(state.options.video.displaySurface,undefined);
    await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
    assert.equal(await page.evaluate(()=>window.audit.stops),1);
    // The companion owns the stream; closing that window still cleans capture up.
    await page.close();
  });
  await browser.close();fs.writeFileSync(path.join(out,'local-feature-results.json'),JSON.stringify(results,null,2));
  if(results.some(r=>r.status==='LOCAL FAIL'))process.exitCode=1;
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1});
