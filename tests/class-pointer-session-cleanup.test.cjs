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
