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
  assert.equal(requests[0][2].studentScreenSharing,false);
  assert.equal(requests[1][2].destinationRequest.mode,'screens');
  assert.equal(requests[1][2].studentScreenSharing,true);
  await assert.rejects(()=>dashboard.requestStudentDestination('unapproved'));
});
async function studentFixture(){
  let subscribe,goTo=null,sessionPath='',shareHolder;
  const stored=new Map([['b3Games_studentId','test-boy'],['b3Games_classPin','12345']]);
  const makeElement=tag=>({
    tag,style:{cssText:''},textContent:'',children:[],
    setAttribute(){},append(...args){this.children.push(...args)},
    addEventListener(){},getTracks(){return[]}
  });
  const document={
    currentScript:{src:'https://funtorahtools.com/class-pointer-prototype/activity-share.js'},
    createElement:makeElement,head:{appendChild(){}},
    body:{appendChild:v=>{shareHolder=v}}
  };
  const db={ref:path=>{sessionPath=path;return{on:(kind,cb)=>{subscribe=cb}}}};
  const firebase={apps:[{}],database:()=>db};
  const location={href:'https://funtorahtools.com/shorashim/index.html',pathname:'/shorashim/index.html',assign:url=>{goTo=url}};
  const context=vm.createContext({
    window:{firebase,B3_FIREBASE_CONFIG:{},addEventListener(){},FunTorahStudentClass:{resolve:async()=>({workspaceId:'b3-2026',classId:'et'})}},
    document,location,firebase,URL,Date,console,
    sessionStorage:{getItem:key=>stored.get(key)||null,setItem:(key,v)=>stored.set(key,v)},
    fetch:async()=>({ok:true,json:async()=>({ok:true})}),
  });
  vm.runInContext(source('activity-share.js'),context);
  for(let i=0;i<20&&!subscribe;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(subscribe,'student class subscription should be established');
  return {emit:record=>subscribe({val:()=>record}),get destination(){return goTo},get sessionPath(){return sessionPath},holder:shareHolder};
}
test('signed-in student follows whiteboard request without requiring screen-sharing permission',async()=>{
  const s=await studentFixture(),now=clock();
  assert.equal(s.sessionPath,'b3Games/workspaces/b3-2026/classes/et/classPointerSessions');
  s.emit({[room]:{roomId:room,createdAt:now,studentScreenSharing:false,destinationRequest:{mode:'boards',at:now}}});
  assert.equal(s.destination,'https://funtorahtools.com/class-pointer-prototype/dashboard.html');
  assert.equal(s.holder.style.display,'none');
});
test('expired class destination commands do not redirect students',async()=>{
  const s=await studentFixture(),now=clock();
  s.emit({[room]:{roomId:room,createdAt:now,studentScreenSharing:false,destinationRequest:{mode:'boards',at:now-60000}}});
  assert.equal(s.destination,null);
});
test('teacher controls offer both class destinations',()=>{
  const src=source('student-boards.js');
  assert.match(src,/Send to Screen Sharing/);
  assert.match(src,/Send to Whiteboards/);
  assert.match(src,/requestStudentDestination\(destination\)/);
});
