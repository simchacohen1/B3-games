'use strict';
// Edge cases for activity sharing: (1) popup blocked -> same-page explicit-consent fallback; (2) persistent window survives 3 navigations and Stop ends the teacher tile.
const { chromium } = require(process.env.LAB_PLAYWRIGHT||'@playwright/test');
const BASE='http://localhost:8787', sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(b,blockPopup){
  const tctx=await b.newContext(), sctx=await b.newContext();
  for (const c of [tctx,sctx]) await c.addInitScript(()=>{ navigator.mediaDevices.getDisplayMedia=()=>navigator.mediaDevices.getUserMedia({video:{width:640,height:360}}); });
  if(blockPopup) await sctx.addInitScript(()=>{ window.open=()=>null; });
  const t=await tctx.newPage();
  await t.goto(BASE+'/_lab/login'); await Promise.all([t.waitForURL('**/teacher-home.html'),t.click('#t')]);
  await t.goto(BASE+'/class-pointer-prototype/classroom.html?dashboard=teacher&class=pointer-test&sendEveryoneShare=1');
  await t.waitForFunction(()=>/room=/.test((document.getElementById('joinLink')||{}).value||''),null,{timeout:30000});
  const s=await sctx.newPage();
  await s.goto(BASE+'/_lab/student?who=A&go=/rashi-letters/student.html'); await s.waitForURL('**/rashi-letters/student.html',{timeout:60000});
  await s.waitForFunction(()=>[...document.querySelectorAll('button')].some(x=>/Share My Screen/.test(x.textContent)),null,{timeout:40000});
  await s.evaluate(()=>[...document.querySelectorAll('button')].find(x=>/Share My Screen/.test(x.textContent)).click());
  await sleep(1200);
  return {t,s,sctx};
}
const tiles=t=>t.evaluate(()=>[...document.querySelectorAll('#activityScreenTray video')].map(x=>({w:x.videoWidth,t:Math.round(x.currentTime*10)/10})));
(async()=>{
  const b=await chromium.launch({channel:'msedge',headless:false,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--window-size=900,700']});
  // 1 popup blocked
  { const {t,s}=await setup(b,true);
    console.log('[blocked] tiles before consent click:',JSON.stringify(await tiles(t)),'(must be empty: no capture without a click)');
    await s.getByText('Open Sharing Window').first().click({timeout:8000});
    await sleep(8000); const a=await tiles(t); await sleep(1500); const a2=await tiles(t);
    console.log('[blocked] fallback shares on same page after the click:',JSON.stringify(a),JSON.stringify(a2)); }
  // 2 persistent window, multiple navigations, then Stop
  { const {t,s,sctx}=await setup(b,false);
    const pp=sctx.waitForEvent('page',{timeout:15000});
    await s.getByText('Open Sharing Window').first().click({timeout:8000}); const pop=await pp;
    console.log('[persist] tiles before popup click (must be empty):',JSON.stringify(await tiles(t)));
    await pop.getByRole('button',{name:/Choose Entire Screen/}).first().click({timeout:15000});
    await sleep(6000);
    for (const p of ['/gematria/index.html','/chazara/index.html','/shorashim/index.html']) {
      await s.goto(BASE+p); await sleep(5000); const x=await tiles(t); await sleep(1500); const y=await tiles(t);
      console.log('[persist] on',p,JSON.stringify(x),JSON.stringify(y),'advancing:',x[0]&&y[0]&&y[0].t>x[0].t);
    }
    const stopBtn=pop.getByRole('button',{name:/Stop Sharing/}).first();
    console.log('[persist] popup shows Stop button:',await stopBtn.isVisible().catch(()=>false));
    await stopBtn.click({timeout:8000}).catch(e=>console.log('stop click failed',e.message.slice(0,80)));
    await sleep(5000); console.log('[persist] teacher tiles after Stop:',JSON.stringify(await tiles(t)),'(must be empty)'); }
  await b.close();
})().catch(e=>{console.log('ERR',e.message.slice(0,300));process.exit(1)});
