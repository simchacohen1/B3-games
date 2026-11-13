'use strict';
// Issue #801: with about seven boys sharing, every shared screen vanished at once and every
// Share My Screen button disappeared.
//
// Cause: the teacher page asked the database to DELETE the lesson record whenever its connection
// dropped, and never wrote it back. Every student page read the missing record as "lesson over".
//
// This runs the REAL teacher script (dashboard-session.js) and the REAL student script
// (activity-share.js, one copy per simulated boy) against one small in-memory database that
// behaves like Firebase for what matters here: live listeners, per-connection onDisconnect
// actions, server timestamps and .info/connected. No browser, no network, no real accounts.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const ROOM='class-pointer-12345678-1234-1234-1234-123456789abc';
const ROOM2='class-pointer-22222222-2222-2222-2222-222222222222';
const CLASS='b3Games/workspaces/b3-2026/classes/et';
const SESSIONS=CLASS+'/classPointerSessions';
const POLICY='b3Private/classPointerSharePermissions/b3-2026/et';
const GRACE=120000;
const settle=async()=>{for(let i=0;i<25;i++)await new Promise(resolve=>setImmediate(resolve))};

// ---------- One controllable clock for the server and every page ----------
function makeClock(){
  let now=1800000000000,seq=0;const timers=new Map();
  return{
    now:()=>now,
    Date:{now:()=>now},
    setTimeout(fn,ms){const id=++seq;timers.set(id,{fn,at:now+Math.max(0,Number(ms)||0)});return id},
    clearTimeout(id){timers.delete(id)},
    async advance(ms){
      const end=now+ms;
      for(;;){
        const due=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!due)break;
        timers.delete(due[0]);now=Math.max(now,due[1].at);due[1].fn();await settle();
      }
      now=end;await settle();
    }
  };
}

// ---------- In-memory database with Firebase connection behaviour ----------
function makeDatabase(clock){
  const root={},listeners=new Set();
  const TIMESTAMP={'.sv':'timestamp'};
  const parts=p=>p.split('/').filter(Boolean);
  const clone=v=>v===undefined||v===null?null:JSON.parse(JSON.stringify(v));
  const resolve=v=>v===TIMESTAMP?clock.now():v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolve(x)])):v;
  function get(p){let node=root;for(const key of parts(p)){if(!node||typeof node!=='object')return null;node=node[key]}return node===undefined?null:node}
  function write(p,value){
    const keys=parts(p);value=resolve(value);
    if(value&&typeof value==='object'&&!Object.keys(value).length)value=null;
    const trail=[root];let node=root;
    for(const key of keys.slice(0,-1)){if(!node[key]||typeof node[key]!=='object'){if(value===null)return;node[key]={}}node=node[key];trail.push(node)}
    const last=keys[keys.length-1];
    if(value===null){delete node[last];for(let i=trail.length-1;i>0;i--)if(!Object.keys(trail[i]).length)delete trail[i-1][keys[i-1]]}
    else node[last]=clone(value);
  }
  function notify(){for(const l of [...listeners])if(listeners.has(l))l.cb({val:()=>clone(get(l.path))})}
  function client(){
    let pending=[];const info=new Set();
    const ref=p=>({
      key:parts(p).pop(),
      child:key=>ref(p+'/'+key),
      once:async()=>({val:()=>clone(get(p))}),
      on(_event,cb,onError){
        if(p==='.info/connected'){info.add(cb);cb({val:()=>true});return}
        if(p==='.info/serverTimeOffset'){cb({val:()=>0});return}
        const l={path:p,cb,onError};listeners.add(l);cb.__l=l;Promise.resolve().then(()=>{if(listeners.has(l))cb({val:()=>clone(get(p))})});
      },
      off(_event,cb){for(const l of [...listeners])if(l.path===p&&(!cb||l.cb===cb))listeners.delete(l)},
      set:async value=>{write(p,value);notify()},
      update:async value=>{for(const [k,v] of Object.entries(value))write(p+'/'+k,v);notify()},
      remove:async()=>{if(api.failRemove?.(p))throw Error('offline');write(p,null);notify()},
      onDisconnect:()=>({
        set:async value=>{pending=pending.filter(o=>o.path!==p);pending.push({path:p,value})},
        remove:async()=>{pending=pending.filter(o=>o.path!==p);pending.push({path:p,value:null})},
        cancel:async()=>{pending=pending.filter(o=>o.path!==p&&!o.path.startsWith(p+'/'))}
      })
    });
    const api={
      ref,
      armed:()=>pending.map(o=>o.path),
      // The connection drops: the server runs this connection's onDisconnect actions once.
      disconnect(){const ops=pending;pending=[];for(const op of ops)write(op.path,op.value);notify();for(const cb of info)cb({val:()=>false})},
      reconnect(){for(const cb of info)cb({val:()=>true})}
    };
    return api;
  }
  // The server cancels every listener on a path (as when read permission is withdrawn).
  function cancelListeners(p){for(const l of [...listeners])if(l.path===p){listeners.delete(l);l.onError?.(Error('permission_denied'))}}
  return{client,get,write:(p,v)=>{write(p,v);notify()},cancelListeners,TIMESTAMP,listenerCount:p=>[...listeners].filter(l=>l.path===p).length};
}

// ---------- The teacher's connection service: who is connected, who is sharing ----------
function makeHub(){
  const presence=new Map(),calls=new Map();   // student id -> Set of live connections / calls
  const add=(map,id,item)=>{if(!map.has(id))map.set(id,new Set());map.get(id).add(item)};
  const drop=(map,id,item)=>{map.get(id)?.delete(item);if(!map.get(id)?.size)map.delete(id)};
  return{
    presence,calls,add,drop,
    // The rule the teacher's list uses: green = sharing, red = connected but not sharing, grey = not connected.
    colour:id=>calls.has(id)?'green':presence.has(id)?'red':'grey',
    colours(ids){return Object.fromEntries(ids.map(id=>[id,this.colour(id)]))}
  };
}

// ---------- One student page (a boy on Shorashim, the home page, the Yiddish game...) ----------
async function studentPage({db,clock,hub,id,page='/shorashim/index.html'}){
  const connection=db.client();
  let holder=null;const windowEvents={},tracks=[];
  const storage=new Map([['b3Games_studentId',id],['b3Games_classPin','pin-'+id]]);
  const sessionStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
  const element=tag=>({tag,style:{cssText:''},dataset:{},children:[],listeners:{},textContent:'',hidden:false,disabled:false,
    setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn},append(...n){this.children.push(...n)},appendChild(n){this.children.push(n);return n},remove(){}});
  const document={currentScript:{src:'https://funtorahtools.com/class-pointer-prototype/activity-share.js'},title:'Test page',
    createElement:element,getElementById:()=>null,head:{appendChild(){}},body:{appendChild(node){if(node.id==='fttActivityScreenShare')holder=node}}};
  class FakePeer{
    constructor(peerId){this.id=peerId;this.handlers={}}
    on(event,fn){(this.handlers[event]??=[]).push(fn)}
    once(event,fn){if(event==='open')Promise.resolve().then(fn)}
    connect(room){
      const handlers={},conn={peer:room,open:false,on:(event,fn)=>{(handlers[event]??=[]).push(fn)},
        send:message=>{if(message?.type==='join'){hub.add(hub.presence,id,conn);Promise.resolve().then(()=>{for(const fn of handlers.data||[])fn({type:'present'})})}},
        close:()=>{if(conn.closed)return;conn.closed=true;conn.open=false;hub.drop(hub.presence,id,conn)}};
      Promise.resolve().then(()=>{if(conn.closed)return;conn.open=true;for(const fn of handlers.open||[])fn()});
      return conn;
    }
    call(room,stream,options){
      const handlers={},media={room,stream,options,closed:false,on:(event,fn)=>{(handlers[event]??=[]).push(fn)},
        close:()=>{if(media.closed)return;media.closed=true;hub.drop(hub.calls,id,media);for(const fn of handlers.close||[])fn()}};
      hub.add(hub.calls,id,media);return media;
    }
    reconnect(){}
    destroy(){this.destroyed=true}
  }
  const window={firebase:null,B3_FIREBASE_CONFIG:{},Peer:FakePeer,
    FunTorahStudentClass:{resolve:async()=>({workspaceId:'b3-2026',classId:'et'})},
    addEventListener(type,fn){(windowEvents[type]??=[]).push(fn)},removeEventListener(){}};
  const firebase={apps:[{}],database:()=>({ref:connection.ref})};window.firebase=firebase;
  const navigator={mediaDevices:{getDisplayMedia(){
    const track={stopped:false,stop(){this.stopped=true},addEventListener(){},getSettings:()=>({displaySurface:'monitor'})};tracks.push(track);
    return Promise.resolve({active:true,getTracks:()=>[track],getVideoTracks:()=>[track]});
  }}};
  async function fetch(url,options){
    if(String(url).includes('funTorahStudentAuth'))return{ok:true,status:200,json:async()=>({ok:true})};
    const body=JSON.parse(options?.body||'{}');
    // Like the real service: nothing is issued unless this lesson's record exists.
    const session=db.get(SESSIONS+'/'+body.room);
    if(!session)return{ok:false,status:403,json:async()=>({ok:false,error:'Class Pointer is not active for this class.'})};
    if(body.action==='permissions')return{ok:true,status:200,json:async()=>({ok:true,screenSharingDenied:false,whiteboardDenied:false})};
    if(body.action==='joinIssue')return{ok:true,status:200,json:async()=>({ok:true,token:'a'.repeat(64),studentName:id})};
    if(body.action==='issue')return{ok:true,status:200,json:async()=>({ok:true,token:'b'.repeat(64)})};
    return{ok:false,status:400,json:async()=>({ok:false})};
  }
  let counter=0;
  await vm.runInNewContext(read('class-pointer-prototype/activity-share.js'),{
    window,document,location:{href:'https://funtorahtools.com'+page,pathname:page},URL,sessionStorage,firebase,fetch,navigator,
    Peer:FakePeer,crypto:{randomUUID:()=>id+'-'+(++counter)},AbortSignal:{timeout:()=>undefined},
    Date:clock.Date,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,console:{warn(){},log(){}}
  });
  await settle();
  assert.ok(holder,id+' must have a share control');
  const [button,label]=holder.children;
  return{
    id,
    buttonVisible:()=>holder.style.display==='flex',
    sharing:()=>/Stop Sharing/.test(button.textContent),
    captureRunning:()=>tracks.some(track=>!track.stopped),
    label:()=>label.textContent,
    async share(){await button.listeners.click();await settle()},
    // The boy opens another page (or closes the tab): this page goes away.
    async leave(){for(const fn of windowEvents.pagehide||[])fn({persisted:false});await settle()}
  };
}

// ---------- The teacher's Class Pointer page ----------
async function teacherPage({db,clock,uid='teacher-et',localStorage=new Map()}){
  const connection=db.client();let authChanged;const windowEvents={},warnings=[];
  const window={B3_APP_CONTEXT:{workspaceId:'b3-2026'},B3SiteSettings:{onAuthStateChanged:fn=>authChanged=fn},
    addEventListener(type,fn){(windowEvents[type]??=[]).push(fn)}};
  const database=()=>({ref:connection.ref});database.ServerValue={TIMESTAMP:db.TIMESTAMP};
  const context=vm.createContext({window,URL,location:{href:'https://funtorahtools.com/class-pointer-prototype/classroom.html?dashboard=teacher&class=et'},
    document:{getElementById:()=>null},firebase:{database,auth:()=>({currentUser:{uid}})},
    localStorage:{getItem:k=>localStorage.get(k)??null,setItem:(k,v)=>localStorage.set(k,String(v)),removeItem:k=>localStorage.delete(k)},
    setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,console:{warn:(...a)=>warnings.push(a),log(){}}});
  for(const name of ['dashboard-core.js','dashboard-session.js'])vm.runInContext(read('class-pointer-prototype/'+name),context);
  await authChanged({uid},true,{authorized:true,role:'teacher',classIds:['et']});
  return{dashboard:window.ClassPointerDashboard,connection,warnings,localStorage,
    async closePage(){for(const fn of windowEvents.pagehide||[])fn({persisted:false});await settle()}};
}

async function classroom(count=7){
  const clock=makeClock(),db=makeDatabase(clock),hub=makeHub();
  db.write(CLASS,{name:'Test ET',active:true,toolGrants:{'class-pointer':true}});
  const teacher=await teacherPage({db,clock});
  await teacher.dashboard.publish(ROOM);
  await teacher.dashboard.setStudentScreenSharing(true);
  const ids=Array.from({length:count},(_,i)=>'test-boy-'+(i+1)),students=[];
  for(const id of ids)students.push(await studentPage({db,clock,hub,id}));
  await clock.advance(1000);           // background class connection starts 400 ms after the lesson is seen
  return{clock,db,hub,teacher,ids,students,session:()=>db.get(SESSIONS+'/'+ROOM)};
}
async function everyoneShares(c){for(const s of c.students)await s.share();return c}
const all=(list,fn)=>list.map(fn);

test('seven students connect and share; the teacher list shows each one green',async()=>{
  const c=await everyoneShares(await classroom());
  assert.deepEqual(all(c.students,s=>s.buttonVisible()),Array(7).fill(true));
  assert.deepEqual(all(c.students,s=>s.sharing()),Array(7).fill(true));
  assert.deepEqual(Object.values(c.hub.colours(c.ids)),Array(7).fill('green'));
});

test('#801: the teacher connection blinks; no share ends, no Share My Screen button disappears',async()=>{
  const c=await everyoneShares(await classroom());
  c.teacher.connection.disconnect();await settle();
  // This is the moment the old code deleted the lesson for everyone.
  assert.ok(c.session(),'the lesson record must survive a dropped teacher connection');
  assert.equal(c.session().roomId,ROOM);
  assert.equal(c.session().teacherOfflineAt,c.clock.now(),'the drop is recorded as a time, nothing else changes');
  assert.equal(c.session().studentScreenSharing,true);
  await c.clock.advance(20000);
  assert.deepEqual(all(c.students,s=>s.sharing()),Array(7).fill(true),'every share keeps going during the drop');
  assert.deepEqual(all(c.students,s=>s.buttonVisible()),Array(7).fill(true),'every button stays');
  assert.deepEqual(Object.values(c.hub.colours(c.ids)),Array(7).fill('green'));
  c.teacher.connection.reconnect();await settle();
  assert.equal(c.session().teacherOfflineAt,undefined,'the offline mark is cleared when the teacher returns');
  assert.deepEqual(c.teacher.connection.armed(),[SESSIONS+'/'+ROOM+'/teacherOfflineAt'],'armed again for the next drop');
  // Well past the grace period nothing must fire late: the lesson is live again.
  await c.clock.advance(GRACE*3);
  assert.deepEqual(all(c.students,s=>s.sharing()),Array(7).fill(true));
  assert.deepEqual(all(c.students,s=>s.buttonVisible()),Array(7).fill(true));
  // A second and third blink behave the same way.
  for(let i=0;i<2;i++){c.teacher.connection.disconnect();await c.clock.advance(5000);c.teacher.connection.reconnect();await settle()}
  assert.equal(c.session().teacherOfflineAt,undefined);
  assert.deepEqual(all(c.students,s=>s.sharing()),Array(7).fill(true));
  assert.deepEqual(c.teacher.warnings,[]);
});

test('a dropped teacher connection never deletes the per-student sharing permissions',async()=>{
  const c=await classroom(2);
  await c.teacher.dashboard.requestStudentDestination('screens',{screens:{'test-boy-2':true}});
  assert.deepEqual(c.db.get(POLICY+'/'+ROOM),{'test-boy-2':{screenSharingDenied:true}});
  c.teacher.connection.disconnect();await settle();
  assert.deepEqual(c.db.get(POLICY+'/'+ROOM),{'test-boy-2':{screenSharingDenied:true}},'a blocked boy must stay blocked through a blink');
});

test('one student opening another page ends only his own share; he can share again from the new page',async()=>{
  const c=await everyoneShares(await classroom());
  const before=JSON.stringify(c.session());
  await c.students[2].leave();         // test-boy-3 goes to the Yiddish game
  assert.equal(JSON.stringify(c.session()),before,'a student page never changes the lesson record');
  assert.equal(c.students[2].captureRunning(),false,'his own capture is released');
  const others=c.students.filter((_,i)=>i!==2);
  assert.deepEqual(all(others,s=>s.sharing()),Array(6).fill(true),'the other six keep sharing');
  assert.deepEqual(all(others,s=>s.buttonVisible()),Array(6).fill(true));
  assert.deepEqual(c.hub.colours(c.ids),{'test-boy-1':'green','test-boy-2':'green','test-boy-3':'grey','test-boy-4':'green','test-boy-5':'green','test-boy-6':'green','test-boy-7':'green'});
  // His next page (the Yiddish game) loads: connected again, button there, not sharing yet = red.
  const next=await studentPage({db:c.db,clock:c.clock,hub:c.hub,id:'test-boy-3',page:'/yiddish/index.html'});
  await c.clock.advance(1000);
  assert.equal(next.buttonVisible(),true,'Share My Screen is offered on the page he moved to');
  assert.equal(c.hub.colour('test-boy-3'),'red');
  await next.share();
  assert.equal(c.hub.colour('test-boy-3'),'green');
  assert.deepEqual(all(others,s=>s.sharing()),Array(6).fill(true));
});

test('one student disconnecting turns only him grey; reconnecting he can share again',async()=>{
  const c=await everyoneShares(await classroom());
  await c.students[6].leave();
  assert.deepEqual(Object.values(c.hub.colours(c.ids)),['green','green','green','green','green','green','grey']);
  const back=await studentPage({db:c.db,clock:c.clock,hub:c.hub,id:'test-boy-7'});
  await c.clock.advance(1000);
  assert.equal(back.buttonVisible(),true);
  assert.equal(c.hub.colour('test-boy-7'),'red');
  await back.share();
  assert.deepEqual(Object.values(c.hub.colours(c.ids)),Array(7).fill('green'));
});

test('green, red and grey: sharing, connected but not sharing, and not connected',async()=>{
  const c=await classroom(3);
  assert.deepEqual(Object.values(c.hub.colours(c.ids)),['red','red','red']);
  await c.students[0].share();
  await c.students[2].leave();
  assert.deepEqual(c.hub.colours(c.ids),{'test-boy-1':'green','test-boy-2':'red','test-boy-3':'grey'});
  await c.students[0].share();         // pressing Stop Sharing
  assert.equal(c.hub.colour('test-boy-1'),'red');
  assert.equal(c.students[0].buttonVisible(),true,'the button stays after he stops, so he can share again');
});

test('privacy: if the teacher does not come back, every student stops by himself after the grace period',async()=>{
  const c=await everyoneShares(await classroom());
  c.teacher.connection.disconnect();await settle();
  await c.clock.advance(GRACE-2000);
  assert.deepEqual(all(c.students,s=>s.sharing()),Array(7).fill(true),'still inside the grace period');
  await c.clock.advance(4000);
  assert.deepEqual(all(c.students,s=>s.sharing()),Array(7).fill(false),'capture is not left running for an absent teacher');
  assert.deepEqual(all(c.students,s=>s.captureRunning()),Array(7).fill(false));
  assert.deepEqual(all(c.students,s=>s.buttonVisible()),Array(7).fill(false));
  // A page opened later (a boy changing pages) must not get a fresh grace period for the same absence.
  const late=await studentPage({db:c.db,clock:c.clock,hub:c.hub,id:'test-boy-1',page:'/yiddish/index.html'});
  await c.clock.advance(1000);
  assert.equal(late.buttonVisible(),false);
  // The teacher's laptop wakes up: the button returns to every page with no restart and no refresh.
  c.teacher.connection.reconnect();await settle();await c.clock.advance(1000);
  assert.equal(c.session().teacherOfflineAt,undefined);
  assert.deepEqual(all(c.students,s=>s.buttonVisible()),Array(7).fill(true),'Share My Screen comes back by itself');
  assert.equal(late.buttonVisible(),true);
  await c.students[3].share();
  assert.equal(c.students[3].sharing(),true,'and sharing works again');
});

test('End Class still ends sharing for everyone at once',async()=>{
  const c=await everyoneShares(await classroom());
  await c.teacher.dashboard.end();await settle();
  assert.equal(c.session(),null);
  assert.equal(c.db.get(POLICY+'/'+ROOM),null);
  assert.deepEqual(all(c.students,s=>s.sharing()),Array(7).fill(false));
  assert.deepEqual(all(c.students,s=>s.buttonVisible()),Array(7).fill(false));
  assert.deepEqual(c.teacher.connection.armed(),[],'nothing is left armed for an ended lesson');
  // A later reconnect must not bring the ended lesson back.
  c.teacher.connection.disconnect();c.teacher.connection.reconnect();await settle();await c.clock.advance(20000);
  assert.equal(c.db.get(SESSIONS),null);
});

test('Disable student sharing still stops and hides sharing for the class; a blink keeps it disabled',async()=>{
  const c=await everyoneShares(await classroom(3));
  await c.teacher.dashboard.setStudentScreenSharing(false);await settle();
  assert.deepEqual(all(c.students,s=>s.sharing()),[false,false,false]);
  assert.deepEqual(all(c.students,s=>s.buttonVisible()),[false,false,false]);
  c.teacher.connection.disconnect();await c.clock.advance(3000);c.teacher.connection.reconnect();await settle();
  assert.equal(c.session().studentScreenSharing,false);
  assert.deepEqual(all(c.students,s=>s.buttonVisible()),[false,false,false]);
});

test('closing or reloading the teacher page ends the lesson for students immediately, with no grace period',async()=>{
  const c=await everyoneShares(await classroom(3));
  await c.teacher.closePage();
  assert.equal(c.session(),null);
  assert.deepEqual(all(c.students,s=>s.sharing()),[false,false,false]);
});

test('if the lesson record is missing when the teacher reconnects, it is written back with sharing still enabled',async()=>{
  const c=await classroom(2);
  c.teacher.connection.disconnect();await settle();
  c.db.write(SESSIONS+'/'+ROOM,null);await settle();   // e.g. removed by an older cached copy of the teacher page
  assert.deepEqual(all(c.students,s=>s.buttonVisible()),[false,false]);
  c.teacher.connection.reconnect();await settle();await c.clock.advance(1000);
  assert.equal(c.session().roomId,ROOM);
  assert.equal(c.session().teacherUid,'teacher-et');
  assert.equal(c.session().studentScreenSharing,true);
  assert.deepEqual(all(c.students,s=>s.buttonVisible()),[true,true],'students get their button back without a restart');
});

test('End Class pressed while offline is finished on reconnect and never undone',async()=>{
  const clock=makeClock(),db=makeDatabase(clock);
  db.write(CLASS,{active:true,toolGrants:{'class-pointer':true}});
  const teacher=await teacherPage({db,clock});
  await teacher.dashboard.publish(ROOM);
  teacher.connection.disconnect();await settle();
  assert.equal(typeof db.get(SESSIONS+'/'+ROOM).teacherOfflineAt,'number');
  teacher.connection.failRemove=()=>true;            // the removal cannot reach the server
  await assert.rejects(()=>teacher.dashboard.end(),/offline/);
  assert.ok(db.get(SESSIONS+'/'+ROOM),'still there, still marked offline');
  teacher.connection.failRemove=null;
  teacher.connection.reconnect();await settle();await clock.advance(20000);
  assert.equal(db.get(SESSIONS+'/'+ROOM),null,'the ended lesson is gone and stays gone');
});

test('a lesson abandoned by a crash is cleared when the same teacher opens the next lesson',async()=>{
  const clock=makeClock(),db=makeDatabase(clock),stored=new Map();
  db.write(CLASS,{active:true,toolGrants:{'class-pointer':true}});
  const first=await teacherPage({db,clock,localStorage:stored});
  await first.dashboard.publish(ROOM);
  await first.dashboard.requestStudentDestination('screens',{screens:{'test-boy-2':true}});
  first.connection.disconnect();await settle();      // the browser died: no End Class, no page close
  assert.ok(db.get(SESSIONS+'/'+ROOM));
  await clock.advance(600000);
  const second=await teacherPage({db,clock,localStorage:stored});
  await second.dashboard.publish(ROOM2);await settle();
  assert.equal(db.get(SESSIONS+'/'+ROOM),null,'the abandoned lesson is removed');
  assert.equal(db.get(POLICY+'/'+ROOM),null,'and its permission rows');
  assert.equal(db.get(SESSIONS+'/'+ROOM2).roomId,ROOM2);
});

test('another teacher\'s live lesson is never cleared as "abandoned"',async()=>{
  const clock=makeClock(),db=makeDatabase(clock),stored=new Map([['classPointerLastRoom:et',ROOM]]);
  db.write(CLASS,{active:true,toolGrants:{'class-pointer':true}});
  db.write(SESSIONS+'/'+ROOM,{roomId:ROOM,teacherUid:'someone-else',createdAt:clock.now(),studentScreenSharing:true,teacherOfflineAt:clock.now()});
  const teacher=await teacherPage({db,clock,localStorage:stored});
  await teacher.dashboard.publish(ROOM2);await settle();
  assert.equal(db.get(SESSIONS+'/'+ROOM).teacherUid,'someone-else');
});

test('a student whose lesson listener is cancelled listens again instead of losing the button for the day',async()=>{
  const c=await classroom(1),boy=c.students[0];
  assert.equal(boy.buttonVisible(),true);
  c.db.cancelListeners(SESSIONS);await settle();
  assert.equal(boy.buttonVisible(),false);
  assert.equal(c.db.listenerCount(SESSIONS),0);
  await c.clock.advance(11000);
  assert.equal(c.db.listenerCount(SESSIONS),1,'listening again');
  assert.equal(boy.buttonVisible(),true);
});

test('static: no teacher code deletes the lesson on disconnect; hardened rules accept the offline time',()=>{
  const session=read('class-pointer-prototype/dashboard-session.js');
  assert.doesNotMatch(session,/onDisconnect\(\)\.remove\(\)/);
  assert.match(session,/ref\.child\(OFFLINE\)\.onDisconnect\(\)\.set\(firebase\.database\.ServerValue\.TIMESTAMP\)/);
  const rules=JSON.parse(read('firebase-rules.hardened.json')).rules;
  const room=rules.b3Games.workspaces.$workspaceId.classes.$classId.classPointerSessions.$roomId;
  assert.equal(room.teacherOfflineAt['.validate'],'newData.isNumber()');
  assert.equal(room.$other['.validate'],false);
});
