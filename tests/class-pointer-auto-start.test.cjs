const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const src=fs.readFileSync(path.join(__dirname,'../class-pointer-prototype/classroom.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../class-pointer-prototype/classroom.html'),'utf8');
const dashboard=fs.readFileSync(path.join(__dirname,'../class-pointer-prototype/dashboard.js'),'utf8');

// Exercise the real startClass function from classroom.js in an isolated peer
// fixture, avoiding access to actual Firebase accounts and student sessions.
const startCode=src.slice(src.indexOf('async function startClass(){'),src.indexOf('\nfunction stopSharing()'));
assert.ok(startCode.startsWith('async function startClass()'));
assert.ok(startCode.endsWith('}\n'));

function fixture({ready=Promise.resolve(),publish=async()=>{},makePeer=true}={}){
  const items=new Map(),events={},reports=[],calls=[];
  const $=id=>{if(!items.has(id))items.set(id,{disabled:false,hidden:false,textContent:'',value:''});return items.get(id)};
  const candidate={on:(key,fn)=>{events[key]=fn}};
  const ctx=vm.createContext({
    isTeacher:true,started:false,openingClass:false,peer:null,joinTimer:null,members:new Map(),
    window:{ClassPointerDashboard:{ready,publish}},
    $,
    makePeer:()=>{calls.push('makePeer');return makePeer?candidate:null},
    clearError:()=>reports.push('clearError'),status:t=>reports.push(t),fail:t=>reports.push('ERROR '+t),
    crypto:{randomUUID:()=> 'fake-uuid'},
    setTimeout:()=>42,clearTimeout:()=>{},
    location:{href:'https://example.test/classroom.html?dashboard=teacher&class=et'},
    URL,roster:()=>calls.push('roster'),receiveStudent:()=>{},endClass:()=>calls.push('endClass'),
  });
  vm.runInContext(startCode,ctx);
  return{ctx,events,calls,reports,$,start:()=>vm.runInContext('startClass()',ctx),values:()=>vm.runInContext('({started,openingClass,peer})',ctx)};
}

test('teacher classroom automatically runs the start method once; screen capture stays user-initiated',()=>{
  assert.match(src,/if\(isTeacher\)void startClass\(\);/);
  assert.match(html,/<button id="startClass"[^>]*hidden/);
  assert.match(dashboard,/Open teacher classroom to start automatically/);
  assert.ok(!startCode.includes('getDisplayMedia('));
  assert.ok(!startCode.includes('shareScreen(false)'));
});

test('authorization happens before the peer connection; class opens and enables screen share automatically',async()=>{
  let authorize;
  const ready=new Promise(resolve=>{authorize=resolve});
  const f=fixture({ready});
  const pending=f.start();
  assert.deepEqual(f.calls,[],'peer connection must not start before authorization');
  assert.equal(f.$('startClass').hidden,true);
  assert.equal(f.$('shareScreen').disabled,false); // mocked button, not yet changed
  authorize();
  await pending;
  assert.deepEqual(f.calls,['makePeer']);
  await f.events.open('class-room');
  assert.equal(f.values().started,true);
  assert.equal(f.values().openingClass,false);
  assert.equal(f.$('shareScreen').disabled,false);
  assert.equal(f.$('openBrowserTab').disabled,false);
  assert.equal(f.$('startClass').hidden,true);
  assert.match(f.reports.at(-1),/Class ready!/);
  const count=f.calls.length;
  await f.start();
  assert.equal(f.calls.length,count,'must not create a duplicate class');
});

test('failed authentication shows a retry control; no peer gets started',async()=>{
  const f=fixture({ready:Promise.reject(new Error('Not assigned to this class'))});
  await f.start();
  assert.deepEqual(f.calls,[]);
  assert.equal(f.$('startClass').hidden,false);
  assert.equal(f.$('startClass').disabled,false);
  assert.match(f.$('startClass').textContent,/Retry/);
  assert.ok(f.reports.some(x=>x.includes('Not assigned to this class')));
});

test('missing peer connectivity shows retry without enabling the classroom',async()=>{
  const f=fixture({makePeer:false});
  await f.start();
  assert.equal(f.values().started,false);
  assert.equal(f.$('startClass').hidden,false);
  assert.equal(f.$('startClass').disabled,false);
});
