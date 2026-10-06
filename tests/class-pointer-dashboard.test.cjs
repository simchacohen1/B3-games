const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const directory=__dirname+'/../class-pointer-prototype/';
const source=name=>fs.readFileSync(directory+name,'utf8');
const room='class-pointer-12345678-1234-1234-1234-123456789abc';
function core(){const context=vm.createContext({window:{}});vm.runInContext(source('dashboard-core.js'),context);return context.window.ClassPointerDashboardCore}
test('teacher access is limited to assigned active classes with the tool grant',()=>{
 const C=core(),access={authorized:true,role:'teacher',classIds:['one']},row={active:true,toolGrants:{'class-pointer':true}};
 assert.equal(C.permitted(access,'one',row),true);assert.equal(C.permitted(access,'other',row),false);assert.equal(C.permitted(access,'one',{active:false}),false);assert.equal(C.permitted(access,'one',{}),false);assert.equal(C.permitted({...access,authorized:false},'one',row),false);assert.equal(C.permitted({...access,role:'admin'},'other',{}),true);
});
test('room discovery rejects malformed and stale rooms, then chooses the newest valid lesson',()=>{
 const C=core(),now=Date.now(),other=room.replace('abc','def');
 assert.equal(C.latest({bad:{roomId:'bad',createdAt:now}}),null);assert.equal(C.latest({[room]:{roomId:room,createdAt:now-14400001}},now),null);
 assert.equal(C.latest({[room]:{roomId:room,createdAt:now-200},[other]:{roomId:other,createdAt:now-100}},now).roomId,other);
});
test('automatic join only accepts a fresh handoff for this room and student class',()=>{
 const C=core(),value={room,name:'Test Boy',studentId:'test-boy',classId:'one',at:Date.now()};
 assert.ok(C.handoff(value,room));assert.equal(C.handoff(value,'wrong'),null);assert.equal(C.handoff({...value,classId:'../et'},room),null);assert.equal(C.handoff({...value,at:0},room),null);
});
function studentFixture({verified=true,enabled=true,classEnabled=true,classLocked=false,granted=true,member=true}={}){
 let listener,redirect,stored,request;
 const nodes=new Map(),element=id=>{if(!nodes.has(id))nodes.set(id,{textContent:''});return nodes.get(id)};
 const row={name:'Test Class',active:true,siteEnabled:classEnabled,access:{mode:classLocked?'locked':'open'},toolGrants:{'class-pointer':granted},members:member?{'test-boy':{active:true}}:{}};
 const db={ref:path=>({child:key=>db.ref(path+'/'+key),once:async()=>({val:()=>path.endsWith('/profile')?{name:'Canonical Boy'}:path.endsWith('/siteSettings')?{siteEnabled:enabled}:row}),on:(event,callback)=>{listener=callback}})};
 const firebase={apps:[{}],database:()=>db};
 const context=vm.createContext({window:{B3_APP_CONTEXT:{workspaceId:'b3-2026'},FunTorahStudentClass:{resolve:async()=>({workspaceId:'b3-2026',classId:'one'})}},firebase,document:{getElementById:element},location:{href:'https://example.test/dashboard.html',replace:value=>redirect=value},URL,AbortSignal,
 localStorage:{getItem:key=>({'b3Games_studentId':'test-boy','b3Games_classPin':'test-only-pin','b3Games_studentName':'Wrong cached name'})[key]},sessionStorage:{setItem:(key,value)=>stored=JSON.parse(value)},fetch:async(url,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>({ok:verified})}}});
 vm.runInContext(source('dashboard-core.js'),context);
 return {run:()=>vm.runInContext(source('dashboard.js'),context),element,get listener(){return listener},get redirect(){return redirect},get stored(){return stored},get request(){return request}};
}
test('dashboard verifies existing sign-in, reads canonical name and joins only its class lesson without a PIN in the handoff',async()=>{
 const f=studentFixture();await f.run();assert.equal(f.request.action,'verify');assert.equal(f.element('welcome').textContent,'Hello, Canonical Boy.');
 f.listener({val:()=>({[room]:{roomId:room,createdAt:Date.now()}})});
 assert.equal(f.stored.name,'Canonical Boy');assert.equal(f.stored.classId,'one');assert.equal(f.stored.pin,undefined);assert.match(f.redirect,/dashboard=student&room=/);
});
test('dashboard does not join when sign-in, grant or membership is unavailable',async()=>{
 for(const options of [{verified:false},{granted:false},{member:false}]){const f=studentFixture(options);await f.run();assert.equal(f.listener,undefined);assert.equal(f.redirect,undefined);assert.ok(f.element('message').textContent)}
});
test('teacher publishes and removes only its own random room and registers disconnect cleanup first',async()=>{
 const writes=[],C=core(),classId='one';let auth;
 const ref=path=>({child:key=>ref(path+'/'+key),once:async()=>({val:()=>({active:true,toolGrants:{'class-pointer':true}})}),onDisconnect:()=>({remove:async()=>writes.push(['disconnect',path]),cancel:async()=>writes.push(['cancel',path])}),set:async value=>writes.push(['set',path,value]),remove:async()=>writes.push(['remove',path])});
 const database=()=>({ref});database.ServerValue={TIMESTAMP:{'.sv':'timestamp'}};
 const context=vm.createContext({window:{ClassPointerDashboardCore:C,B3_APP_CONTEXT:{workspaceId:'b3-2026'},B3SiteSettings:{onAuthStateChanged:callback=>auth=callback}},location:{href:'https://example.test/classroom.html?dashboard=teacher&class=one'},URL,firebase:{database,auth:()=>({currentUser:{uid:'test-teacher'}})}});
 vm.runInContext(source('dashboard-session.js'),context);await auth({uid:'test-teacher'},true,{authorized:true,role:'teacher',classIds:[classId]});
 await context.window.ClassPointerDashboard.publish(room);await context.window.ClassPointerDashboard.end();
 assert.equal(writes[0][0],'disconnect');assert.equal(writes[1][0],'set');assert.equal(writes[2][0],'remove');for(const write of writes)assert.ok(write[1].endsWith('/classPointerSessions/'+room));assert.equal(writes[1][2].teacherUid,'test-teacher');
});

test('Class Pointer joins during global and class game locks',async()=>{
 for(const options of [{enabled:false},{classEnabled:false},{classLocked:true},{enabled:false,classEnabled:false,classLocked:true}]){
  const f=studentFixture(options);await f.run();assert.equal(typeof f.listener,'function');
  f.listener({val:()=>({[room]:{roomId:room,createdAt:Date.now()}})});
  assert.match(f.redirect,/dashboard=student&room=/);
 }
});
