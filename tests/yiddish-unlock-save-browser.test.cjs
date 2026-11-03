// Browser regression test for the Yiddish teacher page unlock saving.
// Runs the real yiddish/teacher.js in Chromium against the real backend logic
// (core.cjs) with a fake Firebase store that mimics real transaction behaviour.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('@playwright/test');
const {makeService,defaults}=require('../backend/functions/yiddish-service/core.cjs');
const ROOT=path.join(__dirname,'..');

function firebaseLikeTx(data){return async(p,f)=>{let assumed=null;for(let i=0;i<25;i++){const out=f(structuredClone(assumed));if(out===undefined)return;const actual=data[p]??null;if(JSON.stringify(assumed)===JSON.stringify(actual)){data[p]=structuredClone(out);return}assumed=structuredClone(actual)}throw Error('maxretry')}}
function backend(){
 const config=defaults();config.version=10;config.sections.forEach(s=>{s.verified=true;s.words=s.words.slice(0,8)});
 config.unlocked={et:2,wt:1};config.unlockedSteps={et:4,wt:2};
 const data={'yiddishPrivate/config':config,'posukPractice/allowedStudents':{s1:{name:'Test Student',classId:'wt'}},'yiddishPrivate/students/s1':{words:{},lastActive:1}};
 const store={get:async p=>structuredClone(data[p]??null),set:async(p,v)=>{data[p]=v},tx:firebaseLikeTx(data)};
 return {data,service:makeService(store,async()=>({uid:'owner',email:'simcha5770@gmail.com',email_verified:true}))};
}
function pageHtml(){
 const html=fs.readFileSync(path.join(ROOT,'yiddish/teacher.html'),'utf8');
 const body=html.slice(html.indexOf('<main>'),html.indexOf('</main>')+7);
 const stub=`<script>
  window.B3SiteSettings={onAuthStateChanged(cb){setTimeout(()=>cb({getIdToken:async()=>'owner'},true))},signInWithGoogle:async()=>{},signOut(){}};
  window.YiddishAPI={async call(action,data){const r=await window.__service(action,data);if(r.ok)return r.body;const e=Error(r.error);e.status=r.status;e.details=r.details||null;throw e}};
 </script>`;
 return `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}${stub}<script src="/yiddish/content.js"></script><script src="/yiddish/teacher.js"></script></body></html>`;
}
async function openTeacher(browser,svc,opts={}){
 const page=await browser.newPage();
 await page.exposeFunction('__service',async(action,data)=>{
  if(opts.delay)await new Promise(r=>setTimeout(r,opts.delay));
  try{return {ok:true,body:await svc.service({...data,action})}}catch(e){return {ok:false,status:e.code||500,error:e.message,details:e.details}}
 });
 await page.route('http://yiddish.test/**',route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/yiddish/teacher.html')return route.fulfill({contentType:'text/html',body:pageHtml()});
  if(u.pathname==='/yiddish/audio.mp3')return route.fulfill({status:204,body:''});
  const file=path.join(ROOT,u.pathname);
  if(fs.existsSync(file))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(file,'utf8')});
  return route.fulfill({status:404,body:''});
 });
 await page.goto('http://yiddish.test/yiddish/teacher.html');
 await page.waitForFunction(()=>document.getElementById('notice').textContent==='Progress loaded.');
 return page;
}
const choose=(page,id,v)=>page.selectOption('#'+id,String(v));
const waitNotice=(page,re)=>page.waitForFunction(r=>new RegExp(r).test(document.getElementById('notice').textContent),re.source,{timeout:5000});

let browser;
test.before(async()=>{const exe=process.env.YIDDISH_TEST_CHROMIUM||'/opt/pw-browsers/chromium';try{browser=await chromium.launch()}catch(e){browser=await chromium.launch({executablePath:exe})}});
test.after(async()=>{await browser?.close()});

test('WT Steps 1–5 saves, is confirmed only after the server commits, and survives a refresh',async()=>{
 const svc=backend(),before=structuredClone(svc.data['yiddishPrivate/students/s1']);
 const page=await openTeacher(browser,svc,{delay:300});
 await choose(page,'wt',5);
 await page.waitForTimeout(800); // autosave started, server still working
 assert.doesNotMatch(await page.textContent('#notice'),/Saved/);
 await waitNotice(page,/✓ Saved and confirmed by the server.*WT: Steps 1–5/);
 const c=svc.data['yiddishPrivate/config'];
 assert.equal(c.unlockedSteps.wt,5);assert.equal(c.unlockedSteps.et,4);assert.equal(c.version,10);
 assert.deepEqual(svc.data['yiddishPrivate/students/s1'],before);
 await page.close();
 const again=await openTeacher(browser,svc); // refresh / sign back in
 assert.equal(await again.inputValue('#wt'),'5');assert.equal(await again.inputValue('#et'),'4');
 await again.close();
});

test('changing ET in one session and WT in another keeps both',async()=>{
 const svc=backend(),a=await openTeacher(browser,svc),b=await openTeacher(browser,svc);
 await choose(b,'wt',5);await waitNotice(b,/✓ Saved/);
 await choose(a,'et',3);await waitNotice(a,/✓ Saved.*ET: Steps 1–3/);
 assert.deepEqual(svc.data['yiddishPrivate/config'].unlockedSteps,{et:3,wt:5});
 await a.close();await b.close();
});

test('a genuine conflict on the same track is reported and never silently overwritten',async()=>{
 const svc=backend(),a=await openTeacher(browser,svc),b=await openTeacher(browser,svc);
 await choose(b,'wt',3);await waitNotice(b,/✓ Saved/);
 await choose(a,'wt',5);await waitNotice(a,/Not saved: WT was changed to Steps 1–3 in another session/);
 assert.equal(svc.data['yiddishPrivate/config'].unlockedSteps.wt,3);
 assert.equal(await a.inputValue('#wt'),'3'); // shows the real saved value
 await choose(a,'wt',5);await waitNotice(a,/✓ Saved.*WT: Steps 1–5/); // teacher chooses again
 assert.equal(svc.data['yiddishPrivate/config'].unlockedSteps.wt,5);
 await a.close();await b.close();
});

test('lesson edits save with a version check and keep unlock levels',async()=>{
 const svc=backend(),page=await openTeacher(browser,svc);
 await choose(page,'wt',5);await waitNotice(page,/✓ Saved/);
 const box=page.locator('.section-editor').nth(3).locator('[data-word]:checked').first();
 await box.uncheck();await waitNotice(page,/✓ Saved.*lesson settings/);
 const c=svc.data['yiddishPrivate/config'];
 assert.equal(c.version,11);assert.equal(c.sections[3].words.length,7);assert.deepEqual(c.unlockedSteps,{et:4,wt:5});
 await page.close();
});
