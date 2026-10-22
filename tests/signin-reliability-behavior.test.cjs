'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('game-gate.js','utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
function context(extra={}){
  return vm.createContext({Promise,URLSearchParams,AbortController,setTimeout,clearTimeout,FETCH_TIMEOUT_MS:15,
    authReadyPromise:Promise.resolve(),window:{firebase:{auth:()=>({currentUser:{getIdToken:async()=> 'synthetic-token'}})}},...extra});
}
function installReads(c){vm.runInContext(section('  function boundedAccess(', '  function loadOneScript(')+section('  async function fetchJson(', '  let followLoader'),c);}
test('token failure never sends an anonymous REST request',async()=>{
  let calls=0;
  const c=context({fetch:()=>{calls++;},window:{firebase:{auth:()=>({currentUser:{getIdToken:async()=>{throw Error('expired');}}})}}});
  installReads(c);
  await assert.rejects(c.fetchJson('http://127.0.0.1/synthetic.json'),/authenticated access/);
  assert.equal(calls,0);
});
test('signed-out session never sends protected REST requests',async()=>{
  let calls=0;const c=context({fetch:()=>{calls++;},window:{firebase:{auth:()=>({currentUser:null})}}});
  installReads(c);await assert.rejects(c.fetchJson('http://127.0.0.1/synthetic.json'));assert.equal(calls,0);
});
test('hung token acquisition terminates without fetching',async()=>{
  let calls=0;const c=context({fetch:()=>{calls++;},window:{firebase:{auth:()=>({currentUser:{getIdToken:()=>new Promise(()=>{})}})}}});
  installReads(c);await assert.rejects(c.fetchJson('http://127.0.0.1/synthetic.json'));assert.equal(calls,0);
});
test('authenticated REST request includes the verified token',async()=>{
  let target;const c=context({fetch:async url=>{target=url;return {ok:true,json:async()=>({active:true})};}});
  installReads(c);assert.equal((await c.fetchJson('http://127.0.0.1/synthetic.json')).active,true);
  assert.equal(new URL(target).searchParams.get('auth'),'synthetic-token');
});
test('hung REST read aborts and fails closed',async()=>{
  let signal;const c=context({fetch:(_,options)=>{signal=options.signal;return new Promise(()=>{});}});
  installReads(c);await assert.rejects(c.fetchJson('http://127.0.0.1/synthetic.json'),/timed out/);assert.equal(signal.aborted,true);
});
function checkContext(extra={}){
  const c=context({isGuestPreview:()=>false,teacherWatchStarted:true,teacherCheckPending:false,requestInFlight:false,refreshRequested:false,followActivityOpen:false,
    DATABASE_URL:'http://127.0.0.1',SETTINGS_PATH:'settings',storedTeacherBypass:()=>false,
    verifiedTeacherAccess:null,window:{B3StudentTools:{},FTTFollowStudent:null},resolveStudentClass:async()=>{},
    studentActive:true,teacherClassRecord:{active:true},lastSettings:{siteEnabled:true},gameId:'halacha',
    console:{warn(){}},decide:()=>{},showClosed:()=>{},...extra});
  vm.runInContext(section('  function checkNow() {','  ["click"'),c);return c;
}
async function flush(c){for(let i=0;i<30&&c.requestInFlight;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(c.requestInFlight,false);}
test('settings and student verification start together',async()=>{
  const started=[];let release;
  const c=checkContext({fetchJson:async()=>{started.push('settings');return {};},resolveStudentClass:()=>{started.push('student');return new Promise(r=>release=r);}});
  c.checkNow();await Promise.resolve();assert.deepEqual(started,['settings','student']);release();await flush(c);
});
test('failed refresh closes previously open permissions',async()=>{
  let closed=0,opened=0;
  const c=checkContext({fetchJson:async()=>{throw Error('denied');},showClosed:()=>closed++,decide:()=>opened++});
  c.checkNow();await flush(c);assert.equal(closed,1);assert.equal(opened,0);assert.equal(c.studentActive,false);assert.equal(c.teacherClassRecord,null);
});
test('overlapping checks are coalesced into one follow-up and stale result is discarded',async()=>{
  let release,reads=0,decisions=0;
  const c=checkContext({fetchJson:()=>{reads++;return reads===1?new Promise(r=>release=r):Promise.resolve({});},decide:()=>decisions++});
  c.checkNow();c.checkNow();c.checkNow();release({});await flush(c);assert.equal(reads,2);assert.equal(decisions,1);
});
test('a hung script is removed and rejects so the vendor fallback can run',async()=>{
  let removed=false;const c=context({document:{createElement:()=>({remove(){removed=true;}}),head:{appendChild(){}}}});
  vm.runInContext(section('  function loadOneScript(', '  // If gstatic.com'),c);
  await assert.rejects(c.loadOneScript('http://127.0.0.1/test.js'),/Script load timed out/);assert.equal(removed,true);
});

test('failed settings waits for the student branch before closing and accepting another pass',async()=>{
  let release,closed=0;
  const c=checkContext({fetchJson:async()=>{throw Error('network');},resolveStudentClass:()=>new Promise(r=>release=r),showClosed:()=>closed++});
  c.checkNow();await new Promise(r=>setImmediate(r));assert.equal(c.requestInFlight,true);assert.equal(closed,0);
  release();await flush(c);assert.equal(closed,1);assert.equal(c.studentActive,false);
});
for(const track of ['et','wt']){
  test(`${track} synthetic student retains every membership and permission read`,async()=>{
    const paths=[];
    const c=context({getStoredStudentId:()=> 'synthetic',getStoredClass:()=>track,WORKSPACE_ID:'test-workspace',DATABASE_URL:'http://127.0.0.1',
      studentActive:false,assignedClass:null,studentClassId:'',startFollowTeacherListener:async()=>{},
      fetchJson:async url=>{
        paths.push(url);
        if(url.endsWith('/profile.json'))return {active:true};
        if(url.endsWith('/memberships.json'))return {one:{active:true,workspaceId:'test-workspace',classId:track}};
        if(url.endsWith('/members/synthetic.json'))return {active:true};
        if(url.endsWith('/toolGrants.json'))return {halacha:true};
        if(url.endsWith('/access.json'))return {mode:'open'};
        return true;
      }});
    vm.runInContext(section('  async function resolveStudentClass()', '  function timeToMinutes'),c);
    assert.equal(await c.resolveStudentClass(),track);assert.equal(c.studentActive,true);assert.equal(paths.length,7);
    assert.equal(c.assignedClass.toolGrants.halacha,true);assert.equal(c.assignedClass.members.synthetic.active,true);
  });
}
test('inactive profile prevents all subsequent class reads',async()=>{
  const paths=[];const c=context({getStoredStudentId:()=> 'synthetic',getStoredClass:()=> 'et',WORKSPACE_ID:'test',DATABASE_URL:'http://127.0.0.1',
    studentActive:true,assignedClass:null,studentClassId:'et',fetchJson:async url=>{paths.push(url);return url.endsWith('/profile.json')?{active:false}:{};}});
  vm.runInContext(section('  async function resolveStudentClass()', '  function timeToMinutes'),c);
  assert.equal(await c.resolveStudentClass(),'');assert.equal(c.studentActive,false);assert.equal(paths.length,2);
});
test('periodic refresh skips hidden tabs',()=>{
  let poll,checks=0;const c=context({document:{visibilityState:'hidden'},POLL_INTERVAL_MS:30000,checkNow:()=>checks++,setInterval:callback=>{poll=callback;}});
  const line=source.split('\n').find(line=>line.includes('setInterval(function () { if (document.visibilityState'));
  vm.runInContext(line,c);poll();assert.equal(checks,0);c.document.visibilityState='visible';poll();assert.equal(checks,1);
});

test('startup waits for role resolution instead of duplicating student reads',async()=>{
  let reads=0;const c=checkContext({teacherCheckPending:true,fetchJson:async()=>{reads++;return {};}});
  c.checkNow();assert.equal(reads,0);assert.equal(c.requestInFlight,false);
  c.teacherCheckPending=false;c.checkNow();await flush(c);assert.equal(reads,1);
});
