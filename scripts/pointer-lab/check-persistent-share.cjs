'use strict';
// Real-Edge/Chrome check of the PERSISTENT sharing window against the running Pointer lab (see README.md):
// teacher sends the share request -> student page shows the consent box -> "Open Sharing Window" -> in that window
// "Choose Entire Screen" -> teacher tile shows live video -> the student's main page navigates to another activity ->
// the teacher tile must keep updating. Uses a fake camera as the "screen" (the real Entire Screen picker is a human click).
// Run: node scripts/pointer-lab/check-persistent-share.cjs   (LAB_CHANNEL=chrome to use Chrome instead of Edge)
const { chromium } = require(process.env.LAB_PLAYWRIGHT||'@playwright/test');
const BASE='http://localhost:8787', sleep=ms=>new Promise(r=>setTimeout(r,ms));
const FIRST=process.env.GO||'/rashi-letters/student.html', SECOND=process.env.GO2||'/gematria/index.html';
const nl=s=>String(s).replace(/\n+/g,' | ');
(async()=>{
  const b=await chromium.launch({channel:process.env.LAB_CHANNEL||'msedge',headless:false,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--window-size=900,700']});
  const tctx=await b.newContext(), sctx=await b.newContext();
  for (const c of [tctx,sctx]) await c.addInitScript(()=>{ navigator.mediaDevices.getDisplayMedia=()=>navigator.mediaDevices.getUserMedia({video:{width:640,height:360}}); });
  const t=await tctx.newPage();
  await t.goto(BASE+'/_lab/login'); await Promise.all([t.waitForURL('**/teacher-home.html'),t.click('#t')]);
  await t.goto(BASE+'/class-pointer-prototype/classroom.html?dashboard=teacher&class=pointer-test&sendEveryoneShare=1');
  await t.waitForFunction(()=>/room=/.test((document.getElementById('joinLink')||{}).value||''),null,{timeout:30000});
  const s=await sctx.newPage();
  await s.goto(`${BASE}/_lab/student?who=A&go=${FIRST}`); await s.waitForURL('**'+FIRST,{timeout:60000});
  await s.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>/Share My Screen/.test(b.textContent)),null,{timeout:40000});
  await s.evaluate(()=>[...document.querySelectorAll('button')].find(b=>/Share My Screen/.test(b.textContent)).click());
  await sleep(1200);
  const popupP=sctx.waitForEvent('page',{timeout:15000}).catch(()=>null);
  await s.getByText('Open Sharing Window').first().click({timeout:8000}).catch(e=>console.log('open-window click failed:',e.message.slice(0,80)));
  const pop=await popupP; console.log('sharing window opened:',!!pop);
  if(pop){
    pop.on('console',m=>{if(['error','warning'].includes(m.type()))console.log('POPUP '+m.type()+':',m.text().slice(0,200))}); pop.on('response',r=>{const u=r.url();if(u.includes('/_fn/')||u.includes('/_rtdb'))console.log('POPUP net',r.status(),u.replace(BASE,'').slice(0,90))}); await pop.waitForLoadState().catch(()=>{}); await sleep(9000); console.log('POPUP storage keys:',JSON.stringify(await pop.evaluate(()=>Object.keys(sessionStorage))),'opener:',await pop.evaluate(()=>String(window.opener)));
    console.log('popup:',pop.url().replace(BASE,''),'|',nl(await pop.evaluate(()=>document.body.innerText)).slice(0,260));
    console.log('POPUP dom:',JSON.stringify(await pop.evaluate(()=>[...document.querySelectorAll('button,[role=dialog],[role=status]')].map(e=>({t:e.tagName,txt:(e.textContent||'').trim().slice(0,50),vis:!!(e.offsetWidth||e.offsetHeight),hidden:e.hidden,disabled:e.disabled})))));
    await pop.getByRole('button',{name:/Choose Entire Screen/}).first().click({timeout:8000}).catch(e=>console.log('popup share click failed:',e.message.slice(0,80)));
    await sleep(3500); console.log('popup after click:',nl(await pop.evaluate(()=>document.body.innerText)).slice(0,260));
  }
  const tiles=()=>t.evaluate(()=>[...document.querySelectorAll('#activityScreenTray video')].map(x=>({w:x.videoWidth,rs:x.readyState,t:Math.round(x.currentTime*10)/10})));
  await sleep(5000); const a=await tiles(); await sleep(1500); const a2=await tiles();
  console.log('teacher tiles after share:',JSON.stringify(a),'then',JSON.stringify(a2));
  await s.goto(BASE+SECOND); await sleep(7000);
  const c=await tiles(); await sleep(1500); const c2=await tiles();
  console.log('after student navigated to',SECOND,': teacher tiles',JSON.stringify(c),'then',JSON.stringify(c2));
  console.log('student pages:',sctx.pages().map(p=>p.url().replace(BASE,'')));
  await b.close();
})().catch(e=>{console.log('ERR',e.message.slice(0,300));process.exit(1)});
