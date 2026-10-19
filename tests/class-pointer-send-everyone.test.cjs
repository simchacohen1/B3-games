const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=name=>fs.readFileSync(__dirname+'/../class-pointer-prototype/'+name,'utf8');
const room='class-pointer-12345678-1234-1234-1234-123456789abc';
const clock=()=>Date.now();
function sessionFixture(){
  const writes=[];let authChanged;
  const ref=path=>({
    key:path.split('/').pop(),
    child:key=>ref(path+'/'+key),
    once:async()=>({val:()=>({active:true,toolGrants:{'class-pointer':true}})}),
    onDisconnect:()=>({remove:async()=>{},cancel:async()=>{}}),
    set:async value=>writes.push(['set',path,value]),
    update:async value=>writes.push(['update',path,value]),
    remove:async()=>{}
  });
  const database=()=>({ref});database.ServerValue={TIMESTAMP:{'.sv':'timestamp'}};
  const context=vm.createContext({
    window:{B3_APP_CONTEXT:{workspaceId:'b3-2026'},B3SiteSettings:{onAuthStateChanged:cb=>authChanged=cb}},
    location:{href:'https://funtorahtools.com/class-pointer-prototype/classroom.html?dashboard=teacher&class=et'},
    firebase:{database,auth:()=>({currentUser:{uid:'teacher-et'}})},
    document:{getElementById:()=>null},URL
  });
  vm.runInContext(source('dashboard-core.js'),context);
  vm.runInContext(source('dashboard-session.js'),context);
  return {context,writes,authorize:()=>authChanged({uid:'teacher-et'},true,{authorized:true,role:'teacher',classIds:['et']})};
}
test('teacher broadcasts selected mode only inside their authenticated active session',async()=>{
  const f=sessionFixture();await f.authorize();const dashboard=f.context.window.ClassPointerDashboard;
  await dashboard.publish(room);
  await dashboard.requestStudentDestination('boards');
  await dashboard.requestStudentDestination('screens');
  const requests=f.writes.filter(x=>x[0]==='update');
  assert.equal(requests.length,2);
  for(const [,path,row] of requests){
    assert.equal(path,'b3Games/workspaces/b3-2026/classes/et/classPointerSessions/'+room);
    assert.deepEqual(JSON.parse(JSON.stringify(row.destinationRequest.at)),{'.sv':'timestamp'});
  }
  assert.equal(requests[0][2].destinationRequest.mode,'boards');
  assert.equal(requests[0][2].studentScreenSharing,undefined,'whiteboards must not revoke existing screen-sharing consent');
  assert.equal(requests[1][2].destinationRequest.mode,'screens');
  assert.equal(requests[1][2].studentScreenSharing,true);
  await assert.rejects(()=>dashboard.requestStudentDestination('unapproved'));
});
async function studentFixture(){
  let subscribe,goTo=null,sessionPath='',shareHolder,shareOverlay,policy={},permissionRevision=0;const permissionRequests=[];
  const stored=new Map([['b3Games_studentId','test-boy'],['b3Games_classPin','12345']]);
  const makeElement=tag=>({
    tag,style:{cssText:''},textContent:'',children:[],
    setAttribute(){},append(...args){this.children.push(...args)},
    addEventListener(){},getTracks(){return[]}
  });
  const document={
    currentScript:{src:'https://funtorahtools.com/class-pointer-prototype/activity-share.js'},
    createElement:makeElement,head:{appendChild(){}},
    body:{appendChild:v=>{if(v.id==='fttActivityScreenShare')shareHolder=v;if(v.id==='fttShareRequestOverlay')shareOverlay=v}}
  };
  const db={ref:path=>({on:(kind,cb)=>{if(path.includes('/classPointerSessions')){sessionPath=path;subscribe=cb}},off(){}})};
  const firebase={apps:[{}],database:()=>db};
  const location={href:'https://funtorahtools.com/shorashim/index.html',pathname:'/shorashim/index.html',assign:url=>{goTo=url}};
  const context=vm.createContext({
    window:{firebase,B3_FIREBASE_CONFIG:{},addEventListener(){},FunTorahStudentClass:{resolve:async()=>({workspaceId:'b3-2026',classId:'et'})}},
    document,location,firebase,URL,Date,AbortSignal,console,
    sessionStorage:{getItem:key=>stored.get(key)||null,setItem:(key,v)=>stored.set(key,v)},
    fetch:async(_url,options)=>{const body=JSON.parse(options.body||'{}');if(body.action==='permissions'){permissionRequests.push(body);return{ok:true,json:async()=>({ok:true,...policy})}}return{ok:true,json:async()=>({ok:true})}},
  });
  vm.runInContext(source('activity-share.js'),context);
  for(let i=0;i<20&&!subscribe;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(subscribe,'student class subscription should be established');
  return {emit:async(record,permissions={})=>{policy=permissions;const rows={...record},row=rows[room];if(row)rows[room]={...row,permissionRevision:++permissionRevision};await subscribe({val:()=>rows})},get destination(){return goTo},get sessionPath(){return sessionPath},get permissionRequests(){return permissionRequests},holder:shareHolder,overlay:shareOverlay};
}
test('signed-in student receives embedded whiteboard request without requiring screen permission',async()=>{
  const s=await studentFixture(),now=clock();
  assert.equal(s.sessionPath,'b3Games/workspaces/b3-2026/classes/et/classPointerSessions');
  await s.emit({[room]:{roomId:room,createdAt:now,studentScreenSharing:false,destinationRequest:{mode:'boards',at:now}}});
  assert.equal(s.permissionRequests.length,1,'student should fetch only its permission row via the authenticated endpoint');
  assert.deepEqual(JSON.parse(JSON.stringify(s.permissionRequests[0])),{action:'permissions',studentId:'test-boy',pin:'12345',classId:'et',room});
  assert.doesNotMatch(s.sessionPath,/b3Private/);
  assert.equal(s.destination,null,'whiteboards stay on the active student page');
  assert.equal(s.holder.style.display,'none');
});
test('expired class destination commands do not redirect students',async()=>{
  const s=await studentFixture(),now=clock();
  await s.emit({[room]:{roomId:room,createdAt:now,studentScreenSharing:false,destinationRequest:{mode:'boards',at:now-60000}}});
  assert.equal(s.destination,null);
});
test('teacher controls offer both class destinations',()=>{
  const src=source('student-boards.js');
  assert.match(src,/Send to Screen Sharing/);
  assert.match(src,/Send to Whiteboards/);
  // Broadcast now carries per-boy Screen / Whiteboard exclusions; the old one-argument assertion was stale.
  assert.match(src,/requestStudentDestination\(destination,policy\(\)\)/);
  assert.match(src,/const denied=\{screens:new Set\(\),boards:new Set\(\)\}/);
  assert.match(src,/screenSharingDenied|excluded\(m,'screens'\)/);
});

test('teacher policy excludes only the requested pupils for each activity',async()=>{
  const f=sessionFixture();await f.authorize();
  const dashboard=f.context.window.ClassPointerDashboard;
  await dashboard.publish(room);
  const selection={screens:{'boy-one':true,'boy-two':false},boards:{'boy-three':true}};
  await dashboard.requestStudentDestination('screens',selection);
  await dashboard.updateActivityPermissions(selection);
  await dashboard.requestStudentDestination('boards',selection);
  const updates=f.writes.filter(([op])=>op==='update');
  assert.equal(updates.length,3);
  for(const [,path] of updates)assert.match(path,/\/classes\/et\/classPointerSessions\//);
  const [, ,screens]=updates[0], [,,boards]=updates[2];
  assert.equal(screens.destinationRequest.mode,'screens');
  assert.equal(screens.screenSharingDenied,undefined);
  assert.equal(screens.whiteboardDenied,undefined);
  const policies=f.writes.filter(([op,path])=>op==='set'&&path.startsWith('b3Private/classPointerSharePermissions/'));
  assert.equal(policies.length,3);
  assert.deepEqual(JSON.parse(JSON.stringify(policies[0][2])),{'boy-one':{screenSharingDenied:true},'boy-three':{whiteboardDenied:true}});
  for(const [,path] of policies)assert.equal(path,'b3Private/classPointerSharePermissions/b3-2026/et/'+room);
  for(const [, ,value] of policies.slice(1))assert.deepEqual(JSON.parse(JSON.stringify(value)),JSON.parse(JSON.stringify(policies[0][2])));
  assert.equal(boards.destinationRequest.mode,'boards');
  assert.equal(boards.studentScreenSharing,undefined,'switching to whiteboards preserves existing screen captures');
  assert.equal(boards.screenSharingDenied,undefined);
  assert.equal(boards.whiteboardDenied,undefined);
});

test('unchecked student receives neither screen nor whiteboard redirect',async()=>{
  const now=clock();
  const s=await studentFixture();
  await s.emit({[room]:{roomId:room,createdAt:now,studentScreenSharing:true,
    destinationRequest:{mode:'screens',at:now}}},{screenSharingDenied:true});
  assert.equal(s.destination,null,'unchecked student must not open screen sharing');
  assert.equal(s.holder.style.display,'none');
  const w=await studentFixture();
  await w.emit({[room]:{roomId:room,createdAt:now,studentScreenSharing:false,
    destinationRequest:{mode:'boards',at:now}}},{whiteboardDenied:true});
  assert.equal(w.destination,null,'unchecked student must not open whiteboards');
});

test('screen and whiteboard checkboxes are independent; rechecking restores routing',async()=>{
  const now=clock(),s=await studentFixture();
  const session={roomId:room,createdAt:now,studentScreenSharing:true,destinationRequest:{mode:'screens',at:now}};
  await s.emit({[room]:session},{screenSharingDenied:true,whiteboardDenied:true});
  assert.equal(s.destination,null);
  await s.emit({[room]:session},{});
  assert.equal(s.destination,null,'screen requests stay in the learning activity');
  assert.equal(s.holder.style.display,'flex','rechecking exposes the small Share My Screen button');
  assert.equal(s.overlay,undefined,'no second consent dialog is created');
  assert.equal(s.holder.children[0].textContent,'🖥 Share My Screen');
  assert.equal(s.holder.children[0].disabled,undefined,'capture remains student-controlled');
  const w=await studentFixture();
  await w.emit({[room]:{...session,destinationRequest:{mode:'boards',at:now},studentScreenSharing:false}},
    {screenSharingDenied:true,whiteboardDenied:false});
  assert.equal(w.destination,null,'board is delivered over authenticated presence without navigation');
});

test('connected share revocation closes the media connection rather than hiding just its tile',()=>{
  const student=source('student-boards.js');
  const activity=source('activity-share.js');
  const backend=fs.readFileSync(__dirname+'/../backend/functions/class-pointer-share-auth.js','utf8');
  assert.match(student,/if\(!on\|\|suspended\|\|excluded\(m,mode\)\)\{if\(!on\|\|excluded\(m,mode\)\)closeScreen\(m\);/);
  assert.match(student,/if\(!on\|\|mode!=='screens'\|\|blocked\)stopShare\(false\)/);
  assert.match(activity,/if\(!shareable\|\|!active\|\|shareable.roomId!==active.roomId\)\{if\(stream\)stop\(\)\}/);
  assert.match(backend,/classPointerSharePermissions/);
  assert.match(backend,/permission\?\.screenSharingDenied===true/);
  // TEMPORARY compatibility: the live site still writes denials to the public session record; every read must be OR'd with the private policy.
  for (const line of backend.split(/\r?\n/).filter(l => /session\.(screenSharingDenied|whiteboardDenied)/.test(l))) assert.match(line, /permission\??\.(screenSharing|whiteboard)Denied===true\|\|/);  assert.match(activity,/action:'permissions'/);
  assert.match(activity,/permissionRevision/);
  assert.doesNotMatch(activity,/ref\('b3Private\/classPointerSharePermissions/);
});

