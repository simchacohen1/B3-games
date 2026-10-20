const { chromium } = require(process.env.LAB_PLAYWRIGHT||'@playwright/test');
const BASE='http://localhost:8787', sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pages=['/rashi-letters/student.html','/chazara/index.html','/record_pesukim/student.html','/gematria/index.html','/shorashim/index.html','/weekly-quiz/index.html','/halacha/index.html','/game-show/player.html','/class-gallery/index.html','/yiddish/index.html','/sefer-hamitzvos/index.html'];
(async()=>{
  const b=await chromium.launch({channel:process.env.LAB_CHANNEL||'msedge',headless:true});
  const ctx=await b.newContext(); const s=await ctx.newPage();
  await s.goto(BASE+'/_lab/student?who=A&go=/index.html'); await s.waitForURL('**/index.html',{timeout:90000}); await sleep(6000);
  for(const p of pages){
    try{ await s.goto(BASE+p,{timeout:30000}); await sleep(9000);
      const t=(await s.evaluate(()=>document.body.innerText)).replace(/\n+/g,' | ');
      const flags=[/Having trouble checking access/.test(t)&&'TROUBLE',/Please sign in again/.test(t)&&'SIGN-IN-LOCK',/not available|closed/i.test(t)&&'closed?'].filter(Boolean).join(',')||'ok';
      console.log(p.padEnd(34),flags.padEnd(14),t.slice(0,70));
    }catch(e){console.log(p.padEnd(34),'ERR',e.message.slice(0,50))}
  }
  await b.close();
})().catch(e=>{console.log('ERR',e.message.slice(0,250));process.exit(1)});
