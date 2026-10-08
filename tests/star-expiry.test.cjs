const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
function setup(initial) {
  let saved = JSON.stringify(initial);
  const context = {window:{},console,Intl,Date,localStorage:{getItem:()=>saved,setItem:(k,v)=>{saved=v;}}};
  vm.runInNewContext(fs.readFileSync('site-settings.js','utf8'),context);
  return {api:context.window.B3SiteSettings,read:()=>JSON.parse(saved)};
}
const allDay = {mon:[],tue:[],wed:[],thu:[],fri:[],sat:[],sun:[]};
test('a new star saves an end time and stops counting after it', async()=>{
  const s=setup({classAccess:{et:{mode:'locked',lockWindows:allDay}}});
  await s.api.setClassLockedGame('et','halacha',true);
  const until=s.read().classLockedGameOverrideUntil.et.halacha;
  assert.ok(until>Date.now() && until<=Date.now()+24*3600e3);
  assert.equal(s.api.classHasLockedGameOverride(s.read(),'et','halacha'),true);
  assert.equal(s.api.classHasLockedGameOverride(s.read(),'et','halacha',new Date(until+1000)),false);
});
test('star ends when the current scheduled lock ends', ()=>{
  const s=setup({});
  const now=new Date();
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
  const day={Sun:'sun',Mon:'mon',Tue:'tue',Wed:'wed',Thu:'thu',Fri:'fri',Sat:'sat'}[p.weekday];
  const mins=+p.hour*60+ +p.minute; if(mins<5||mins>1400) return;
  const f=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
  const lw={...allDay,[day]:[{start:f(mins-5),end:f(mins+20)}]};
  const settings={classAccess:{et:{mode:'auto',lockWindows:lw}},classLockedGameOverride:{et:'halacha'},classLockedGameOverrideUntil:{et:{}}};
  // simulate starring now
  return s.api.save(settings).then(()=>s.api.setClassLockedGame('et','yiddish',true)).then(()=>{
    const until=s.read().classLockedGameOverrideUntil.et.yiddish;
    assert.ok(Math.abs(until-(now.getTime()+20*60e3))<61e3);
  });
});
test('old stars without an end time keep working, game-gate respects expiry', ()=>{
  const s=setup({classLockedGameOverride:{et:'halacha,yiddish'},classLockedGameOverrideUntil:{et:{yiddish:Date.now()-1000}}});
  assert.deepEqual([...s.api.activeLockedGameList(s.read(),'et')],['halacha']);
  const gate=fs.readFileSync('game-gate.js','utf8');
  assert.match(gate,/classLockedGameOverrideUntil/);
});
