'use strict';
// Run: npx playwright test tests/student-access-diagnostics.spec.cjs --workers=1
// Optional: FTT_BASE_URL=https://funtorahtools.com/ FTT_STORAGE_STATE=/absolute/path/to/test-user-state.json
// Never provide real student credentials or commit a storage-state file.
const {test, expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const base=(process.env.FTT_BASE_URL || 'https://funtorahtools.com/').replace(/\/+$/,'')+'/';
const authState=process.env.FTT_STORAGE_STATE;
if(authState && !fs.existsSync(authState)) throw new Error('FTT_STORAGE_STATE file does not exist');
const pages=[
  ['home',''],
  ['halacha','halacha/index.html'],
  ['sefer-hamitzvos','sefer-hamitzvos/index.html'],
  ['posuk-practice','record_pesukim/student.html'],
  ['shorashim','shorashim/index.html'],
  ['chazara','chazara/index.html'],
  ['weekly-quiz','weekly-quiz/index.html'],
  ['yiddish','yiddish/index.html'],
  ['rashi-letters','rashi-letters/student.html']
];
test.describe.configure({mode:'serial'});
test.use({viewport:{width:1365,height:850}, ...(authState?{storageState:authState}:{})});
for(const [name,relative] of pages){
 test(name+' browser/network diagnostics',async({page},testInfo)=>{
  const events=[],start=Date.now();
  const record=(kind,data)=>events.push({elapsed_ms:Date.now()-start,kind,...data});
  page.on('console',msg=>{if(msg.type()==='error'||msg.type()==='warning')record('console',{type:msg.type(),message:msg.text().slice(0,500)});});
  page.on('pageerror',err=>record('pageerror',{message:err.message.slice(0,500)}));
  page.on('requestfailed',req=>record('requestfailed',{url:safeUrl(req.url()),error:req.failure()?.errorText}));
  page.on('response',res=>{if(res.status()>=400)record('http-error',{status:res.status(),url:safeUrl(res.url())});});
  const url=new URL(relative,base).toString();
  let navigationError=null;
  try { await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000}); }
  catch(err){navigationError=err.message;record('navigation-error',{message:navigationError.slice(0,500)});}
  // Capture delayed access overlays and Firebase failures without hanging indefinitely.
  await page.waitForTimeout(6500);
  const snapshot=await page.evaluate(()=>{
   const root=document.body;
   const text=(root?.innerText||'').slice(0,3500);
   const overlays=[...document.querySelectorAll('[role="dialog"],[class*="overlay"],[id*="Loading"],[id*="loading"]')]
     .filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';})
     .map(el=>({tag:el.tagName,id:el.id,classes:String(el.className).slice(0,120),text:(el.innerText||'').slice(0,250)})).slice(0,20);
   const nav=performance.getEntriesByType('navigation')[0];
   const slow=performance.getEntriesByType('resource').filter(r=>r.duration>1500)
     .map(r=>({url:r.name.split('?')[0],duration_ms:Math.round(r.duration)})).slice(0,20);
   return {title:document.title,location:location.pathname,readyState:document.readyState,
     bodyTextExcerpt:text,overlays,domContentLoaded_ms:nav?Math.round(nav.domContentLoadedEventEnd):null,slowResources:slow};
  }).catch(err=>({snapshotError:err.message}));
  // A 401/403 or lock screen may be correct for signed-out/unassigned students.
  // This is a diagnostic, not an attempt to bypass access policy.
  const report={name,url,authenticatedStateProvided:!!authState,elapsed_ms:Date.now()-start,navigationError,snapshot,events};
  const out=path.join(testInfo.outputDir,'diagnostics.json');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(report,null,2));
  await testInfo.attach('diagnostics',{path:out,contentType:'application/json'});
  await page.screenshot({path:path.join(testInfo.outputDir,'page.png'),fullPage:true}).catch(()=>{});
  expect(navigationError,'navigation should reach DOMContentLoaded').toBeNull();
  expect(snapshot.snapshotError,'page should remain inspectable').toBeUndefined();
 });
}
function safeUrl(raw){try{const u=new URL(raw);return u.origin+u.pathname;}catch{return '<invalid-url>';}}
