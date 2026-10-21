'use strict';
// Opens each student activity page in a real browser with SYNTHETIC database
// answers and a fixed network delay, and reports whether the shared access gate
// opened or stayed closed, and how long that took. Nothing real is contacted:
// every database read is answered locally; no student or class is touched.
//
// Usage: node scripts/check-student-gate.cjs <siteRoot> <delayMs> <fresh|returning> [runs]
//   fresh     = a brand-new browser profile (first visit / private window)
//   returning = the browser already has Firebase's saved-sign-in database
// Needs Playwright (npm i -D playwright, or run from a folder that has it).
const http=require('http'),fs=require('fs'),path=require('path');
let chromium;try{({chromium}=require('playwright'));}catch(e){({chromium}=require('@playwright/test'));}
const [root,delayArg,mode='returning',runsArg='1']=process.argv.slice(2);
const DELAY=Number(delayArg||0),RUNS=Number(runsArg);
const PAGES=['shorashim/index.html','halacha/index.html','sefer-hamitzvos/index.html','record_pesukim/student.html','chazara/index.html','yiddish/index.html','rashi-letters/student.html','weekly-quiz/index.html','student-rewards/student.html'];
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  const p=decodeURIComponent(req.url.split('?')[0]);
  const f=path.join(root,p==='/'?'index.html':p);
  fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});res.end(d);});
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const gameIdOf=page=>{const m=fs.readFileSync(path.join(root,page),'utf8').match(/game-gate\.js[^>]*data-game-id="([^"]+)"/);return m?m[1]:'';};

// scenario -> [synthetic answers, expected outcome]
const SCENARIOS={
  open:g=>({settings:{siteEnabled:true,classAccess:{et:{mode:'open'}}},expect:'open'}),
  'class-locked':g=>({settings:{siteEnabled:true,classAccess:{et:{mode:'locked'}}},expect:'locked'}),
  'tool-off':g=>({settings:{siteEnabled:true,classAccess:{et:{mode:'open'}},games:{[g]:false}},expect:'off'}),
  'not-a-member':g=>({settings:{siteEnabled:true,classAccess:{et:{mode:'open'}}},member:null,expect:'signin'}),
  'student-exception':g=>({settings:{siteEnabled:true,classAccess:{et:{mode:'locked'}},studentGameOverrides:{test_student:{[g]:true}}},expect:'open'}),
  'site-closed':g=>({settings:{siteEnabled:false,classAccess:{et:{mode:'open'}}},expect:'closed'})
};
const classify=text=>/Fun Torah Tools is closed/.test(text)?'closed':/is locked right now/.test(text)?'locked':/turned off/.test(text)?'off':/sign in/i.test(text)?'signin':/Fun Torah Tools is closed/.test(text)?'closed':/Still checking|Having trouble/.test(text)?'stuck':text?'other:'+text.slice(0,40):'open';

(async()=>{
  await new Promise(r=>server.listen(0,r));
  const port=server.address().port,browser=await chromium.launch(),out=[];
  for(const page of PAGES){
    if(!fs.existsSync(path.join(root,page)))continue;
    const gameId=gameIdOf(page);
    if(!gameId)continue; // this page does not use the shared gate
    for(const [name,build] of Object.entries(SCENARIOS)){
      const sc=build(gameId),times=[];let outcome='',reads=0;
      for(let i=0;i<RUNS;i++){
        const ctx=await browser.newContext();
        await ctx.addInitScript(()=>{try{sessionStorage.setItem('b3Games_studentId','test_student');sessionStorage.setItem('b3Games_studentClass','et');sessionStorage.setItem('b3Games_studentName','Test Student');}catch(e){}});
        if(mode==='returning')await ctx.addInitScript(()=>{const r=indexedDB.open('firebaseLocalStorageDb',1);r.onupgradeneeded=e=>e.target.result.createObjectStore('firebaseLocalStorage',{keyPath:'fbase_key'});});
        const pg=await ctx.newPage();reads=0;
        await pg.route('**/*',async route=>{
          const url=route.request().url();
          if(url.startsWith('https://b3-games-default-rtdb.firebaseio.com/')&&!url.includes('.lp')){
            reads++;await sleep(DELAY);
            const p=new URL(url).pathname.replace(/\.json$/,'');let body=null;
            if(p.endsWith('/profile'))body={name:'Test Student',active:true};
            else if(p.endsWith('/memberships'))body={'b3-2026_et':{active:true,workspaceId:'b3-2026',classId:'et'}};
            else if(p.endsWith('/siteSettings'))body=sc.settings;
            else if(p.endsWith('/active'))body=true;
            else if(p.includes('/members/'))body='member' in sc?sc.member:{active:true};
            return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
          }
          if(url.startsWith('http://localhost')||url.startsWith('https://www.gstatic.com/'))return route.continue();
          return route.abort();
        });
        const t0=Date.now();
        await pg.goto(`http://localhost:${port}/${page}`,{waitUntil:'commit'});
        // Settled = page revealed and no "still checking" overlay.
        try{
          await pg.waitForFunction(()=>{const o=document.getElementById('b3-gate-overlay');const t=o?o.innerText:'';return !document.getElementById('b3-gate-hide-style')&&!/Still checking|Having trouble/.test(t)&&document.readyState!=='loading';},null,{timeout:12000,polling:25});
          times.push(Date.now()-t0);
        }catch(e){times.push(-1);}
        const text=await pg.evaluate(()=>{const o=document.getElementById('b3-gate-overlay');return o?o.innerText:'';}).catch(()=>'');
        outcome=times[times.length-1]<0?'stuck':classify(text);
        await ctx.close();
      }
      const ok=times.filter(t=>t>0).sort((a,b)=>a-b);
      out.push({page,gameId,scenario:name,expected:sc.expect,outcome,pass:outcome===sc.expect,medianMs:ok.length?ok[Math.floor(ok.length/2)]:-1,reads});
    }
  }
  await browser.close();server.close();
  console.log(JSON.stringify({mode,delayMs:DELAY,runs:RUNS,results:out}));
})();
