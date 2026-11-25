const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const directory=__dirname+'/../class-pointer-prototype/';
const source=name=>fs.readFileSync(directory+name,'utf8');
const mk=n=>'class-pointer-'+String(n).repeat(8)+'-1234-1234-1234-123456789abc';
const mine=mk(1),older=mk(2),newer=mk(3),stale=mk(4);
const SESSIONS='b3Games/workspaces/b3-2026/classes/one/classPointerSessions';

// A fake database holding the class's lesson list, plus recorded operations.
function fixture(initial){
  const rows=JSON.parse(JSON.stringify(initial||{})),ops=[],listeners={},events=[],pagehide=[];let auth;
  const node=()=>({children:[],style:{},textContent:'',append(){},appendChild(c){return c},setAttribute(){}});
  const ref=path=>({key:path.split('/').pop(),child:key=>ref(path+'/'+key),
    once:async()=>({val:()=>path===SESSIONS?JSON.parse(JSON.stringify(rows)):path.startsWith(SESSIONS+'/')&&!path.endsWith('/teacherOfflineAt')?rows[path.split('/').pop()]??null:path==='.info/serverTimeOffset'?0:({active:true,toolGrants:{'class-pointer':true}})}),
    onDisconnect:()=>({set:async()=>ops.push(['disconnect-set',path]),remove:async()=>{},cancel:async()=>ops.push(['disconnect-cancel',path])}),
    set:async v=>{ops.push(['set',path]);if(path.startsWith(SESSIONS+'/'))rows[path.split('/').pop()]={...v,createdAt:Date.now()}},
    update:async v=>{ops.push(['update',path]);},
    remove:async()=>{ops.push(['remove',path]);if(path.startsWith(SESSIONS+'/'))delete rows[path.split('/').pop()]},
    on:(e,cb)=>{(listeners[path]=listeners[path]||[]).push(cb)},off:(e,cb)=>{listeners[path]=(listeners[path]||[]).filter(x=>x!==cb)}});
  const database=()=>({ref});database.ServerValue={TIMESTAMP:{'.sv':'timestamp'}};
  const context=vm.createContext({
    window:{ClassPointerDashboardCore:(()=>{const c=vm.createContext({window:{}});vm.runInContext(source('dashboard-core.js'),c);return c.window.ClassPointerDashboardCore})(),
      B3_APP_CONTEXT:{workspaceId:'b3-2026'},B3SiteSettings:{onAuthStateChanged:cb=>{auth=cb}},addEventListener:(e,cb)=>{if(e==='pagehide')pagehide.push(cb)}},
    location:{href:'https://example.test/classroom.html?dashboard=teacher&class=one'},
    document:{body:node(),createElement:node,getElementById:()=>null,dispatchEvent:e=>{events.push(e.type||e)}},
    firebase:{database,auth:()=>({currentUser:{uid:'t1'},onAuthStateChanged(){}})},
    localStorage:{getItem:()=>'',setItem(){}},Event:function(type){this.type=type},CustomEvent:function(type,init){this.type=type;this.detail=init?.detail},setTimeout,clearTimeout,URL
  });
  vm.runInContext(source('dashboard-session.js'),context);
  return {rows,ops,listeners,events,pagehide,context,
    async open(room=mine){await auth({uid:'t1'},true,{authorized:true,role:'teacher',classIds:['one']});await context.window.ClassPointerDashboard.publish(room)},
    push(next){for(const cb of listeners[SESSIONS]||[])cb({val:()=>next})}};
}
const now=Date.now();
const live=(room,ageMs=1000,extra={})=>({roomId:room,teacherUid:'tx',createdAt:now-ageMs,studentScreenSharing:false,...extra});

test('opening a lesson removes dead leftovers but never another teacher’s live lesson',async()=>{
  const f=fixture({
    [older]:live(older,600000),                                   // live, other teacher: must stay
    [stale]:live(stale,600000,{teacherOfflineAt:now-600000}),     // teacher gone for 10 minutes
    [mk(5)]:{teacherOfflineAt:now-600000},                        // old stub left by a disconnect
    [mk(6)]:live(mk(6),15000000),                                 // older than 4 hours
    [mk(7)]:{teacherOfflineAt:now-1000}                           // fresh stub (could be a lesson reconnecting): keep for now
  });
  await f.open();
  const removed=f.ops.filter(([op,p])=>op==='remove'&&p.startsWith(SESSIONS+'/')).map(([,p])=>p.split('/').pop());
  assert.deepEqual(removed.sort(),[stale,mk(5),mk(6)].sort());
  assert.ok(f.rows[older]&&f.rows[mk(7)]&&f.rows[mine],'live lessons and fresh stubs stay');
});

test('a lesson is taken over when a newer live lesson appears: event fires once, nothing recreates it',async()=>{
  const f=fixture({});await f.open();
  const t=Date.now();
  // Alone, or only older / offline / stale competitors: still live.
  f.push({[mine]:live(mine,5000),[older]:live(older,9000)});
  f.push({[mine]:live(mine,5000),[newer]:live(newer,1000,{teacherOfflineAt:t-300000})});
  f.push({[mine]:live(mine,5000),[newer]:live(newer,1000,{createdAt:t-15000000})});
  assert.deepEqual(f.events,[]);
  // A newer live lesson from another teacher: taken over, exactly once.
  f.push({[mine]:live(mine,5000),[newer]:live(newer,1000)});
  f.push({[mine]:live(mine,5000),[newer]:live(newer,500)});
  assert.deepEqual(f.events,['class-pointer-taken-over']);
});

test('two lessons with the same start time resolve the same way on both sides (higher room id wins)',async()=>{
  const f=fixture({});await f.open();
  const t=Date.now()-1000;
  f.push({[mine]:{...live(mine),createdAt:t},[newer]:{...live(newer),createdAt:t}});
  assert.deepEqual(f.events,['class-pointer-taken-over'],'newer id > mine id, so mine yields');
  const g=fixture({});await g.open(newer);
  g.push({[newer]:{...live(newer),createdAt:t},[mine]:{...live(mine),createdAt:t}});
  assert.deepEqual(g.events,[],'the higher id keeps the class');
});

test('closing the teacher page cancels the offline stamp first, so no stub is left behind',async()=>{
  const f=fixture({});await f.open();f.ops.length=0;
  f.pagehide[0]({persisted:false});
  const order=f.ops.map(([op,p])=>op+':'+p.split('/').pop());
  assert.ok(order.indexOf('disconnect-cancel:teacherOfflineAt')>=0&&order.indexOf('disconnect-cancel:teacherOfflineAt')<order.findIndex(x=>x==='remove:'+mine));
});

test('the teacher window shows "This lesson was taken over" and the student page follows a new lesson without a refresh',()=>{
  const room=source('classroom.js'),share=source('activity-share.js');
  assert.match(room,/class-pointer-taken-over/);assert.match(room,/This lesson was taken over/);assert.match(room,/Take this class back/);
  assert.match(share,/next\.roomId!==presenceTarget\)\{presenceTarget=next\.roomId;presenceDelay=0;presenceFailures=0;admitted=false;/);
});
