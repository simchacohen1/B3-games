'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const room='class-pointer-12345678-1234-1234-1234-123456789abc';
async function fixture(){
 let auth,releaseWrite,failRemoval=false;const operations=[];
 const ref=path=>({child:key=>ref(path+'/'+key),once:async()=>({val:()=>({active:true,toolGrants:{'class-pointer':true}})}),
 onDisconnect:()=>({remove:async()=>{},cancel:async()=>{operations.push(['cancel',path])}}),
 set:async()=>{},update:async value=>{operations.push(['update',path,value]);await new Promise(resolve=>releaseWrite=resolve)},
 remove:async()=>{operations.push(['remove',path]);if(failRemoval)throw Error('offline')}});
 const database=()=>({ref});database.ServerValue={TIMESTAMP:{'.sv':'timestamp'}};
 const window={B3_APP_CONTEXT:{workspaceId:'b3-2026'},B3SiteSettings:{onAuthStateChanged:fn=>auth=fn}};
 const context=vm.createContext({window,URL,location:{href:'https://example.test/classroom.html?dashboard=teacher&class=wt'},document:{getElementById:()=>null},firebase:{database,auth:()=>({currentUser:{uid:'wt-teacher'}})}});
 for(const name of ['dashboard-core.js','dashboard-session.js'])vm.runInContext(fs.readFileSync(__dirname+'/../class-pointer-prototype/'+name,'utf8'),context);
 await auth({uid:'wt-teacher'},true,{authorized:true,role:'teacher',classIds:['wt']});
 const dashboard=window.ClassPointerDashboard;await dashboard.publish(room);
 return {dashboard,operations,release:()=>releaseWrite(),fail:()=>{failRemoval=true},recover:()=>{failRemoval=false}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('End drains an in-flight permission write and drops queued writes before removing WT session',async()=>{
 const f=await fixture();const first=f.dashboard.updateActivityPermissions({screens:{boy:true}});await tick();
 const queued=f.dashboard.setStudentScreenSharing(true);await tick();
 const ending=f.dashboard.end();await tick();
 assert.equal(f.operations.filter(([op])=>op==='remove').length,0,'must wait for the in-flight write');
 await assert.rejects(()=>f.dashboard.publish(room),/still ending/);
 f.release();await Promise.all([first,queued,ending]);
 assert.deepEqual(f.operations.map(([op])=>op),['update','remove','cancel']);
 assert.ok(f.operations.every(([,path])=>path.includes('/classes/wt/classPointerSessions/'+room)));
 const before=f.operations.length;await f.dashboard.setStudentScreenSharing(false);
 assert.equal(f.operations.length,before,'removed rooms receive no late child writes');
});
test('failed deletion retains the exact previous session reference for retry',async()=>{
 const f=await fixture();f.fail();await assert.rejects(()=>f.dashboard.end(),/offline/);
 f.recover();await f.dashboard.end();
 assert.equal(f.operations.filter(([op])=>op==='remove').length,2);
 assert.equal(f.operations[0][1],f.operations[1][1]);
 assert.equal(f.operations.at(-1)[0],'cancel');
});

test('teacher can End and Restart three times; duplicate clicks never overlap cleanup',async()=>{
 const src=fs.readFileSync(__dirname+'/../class-pointer-prototype/classroom.js','utf8');
 const start=src.slice(src.indexOf('async function startClass(){'),src.indexOf('\nasync function requestEveryoneToShare'));
 const end=src.slice(src.indexOf('function endClass(){'),src.indexOf('\nfunction clearStudentVideo'));
 const items=new Map(),peers=[],errors=[];let finishCleanup,ends=0;
 const $=id=>{if(!items.has(id))items.set(id,{hidden:false,disabled:false,value:'',textContent:''});return items.get(id)};
 const window={ClassPointerDashboard:{ready:Promise.resolve(),publish:async()=>{},end:()=>{ends++;return new Promise(resolve=>finishCleanup=resolve)}},ClassPointerBoards:{endClass(){}},ClassPointerActivityShares:{closeAll(){}},ClassPointerPdf:{close(){}}};
 const context=vm.createContext({isTeacher:true,started:false,openingClass:false,closingClass:false,endPromise:Promise.resolve(),peer:null,joinTimer:null,members:new Map(),state:{},window,$,
 makePeer:()=>{const events={};const p={events,on:(name,fn)=>events[name]=fn,destroy(){this.destroyed=true}};peers.push(p);return p},
 clearError(){},status(){},fail:message=>errors.push(message),stopSharing(){},roster(){},send(){},receiveStudent(){},
 clearTimeout(){},setTimeout:()=>1,crypto:{randomUUID:()=>String(peers.length)},URL,location:{href:'https://example.test/classroom.html?dashboard=teacher&class=wt'}});
 vm.runInContext(start+'\n'+end,context);
 for(let cycle=0;cycle<3;cycle++){
  await vm.runInContext('startClass()',context);
  await peers.at(-1).events.open(room);
  assert.equal(vm.runInContext('started',context),true);
  const pending=vm.runInContext('endClass()',context);
  assert.equal(vm.runInContext('endClass()',context),pending);
  const before=peers.length;await vm.runInContext('startClass()',context);
  assert.equal(peers.length,before,'no new Peer connection before cleanup');
  await tick();assert.equal($('startClass').disabled,true);
  finishCleanup();await pending;
  assert.equal($('startClass').disabled,false);
  assert.match($('startClass').textContent,/Start another class/);
  assert.equal(peers.at(-1).destroyed,true);
 }
 assert.equal(ends,3);assert.equal(peers.length,3);assert.deepEqual(errors,[]);
});
