const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const directory=__dirname+'/../class-pointer-prototype/';
const source=name=>fs.readFileSync(directory+name,'utf8');
const room='class-pointer-12345678-1234-1234-1234-123456789abc';
const other='class-pointer-aaaaaaaa-1234-1234-1234-123456789abc';

// A newer lesson from someone else for the same class makes students join that one: the teacher must be told, and
// one click must make this lesson the newest again (nothing deleted).
test('teacher sees a banner when a newer lesson exists for the class, and can take it back',async()=>{
  const writes=[];let listener=null,auth;
  const node=()=>{const n={children:[],style:{},hidden:false,textContent:'',className:'',append(...c){n.children.push(...c)},appendChild(c){n.children.push(c);return c},
    setAttribute(){},querySelector(sel){return n.children.find(c=>sel==='.'+c.className)||null}};return n};
  const body=node();
  const ref=path=>({child:key=>ref(path+'/'+key),key:path.split('/').pop(),
    once:async()=>({val:()=>({active:true,toolGrants:{'class-pointer':true}})}),
    onDisconnect:()=>({set:async()=>{},remove:async()=>{},cancel:async()=>{}}),
    set:async v=>writes.push(['set',path,v]),update:async v=>writes.push(['update',path,v]),remove:async()=>writes.push(['remove',path]),
    on:(event,cb)=>{if(path.endsWith('/classPointerSessions'))listener=cb},off:()=>{}});
  const database=()=>({ref});database.ServerValue={TIMESTAMP:{'.sv':'timestamp'}};
  const context=vm.createContext({
    window:{ClassPointerDashboardCore:(()=>{const c=vm.createContext({window:{}});vm.runInContext(source('dashboard-core.js'),c);return c.window.ClassPointerDashboardCore})(),
      B3_APP_CONTEXT:{workspaceId:'b3-2026'},B3SiteSettings:{onAuthStateChanged:cb=>auth=cb}},
    location:{href:'https://example.test/classroom.html?dashboard=teacher&class=one'},
    document:{body,createElement:()=>node(),getElementById:()=>null,dispatchEvent(){}},
    firebase:{database,auth:()=>({currentUser:{uid:'t1'},onAuthStateChanged(){}})},
    localStorage:{getItem:()=>'',setItem(){}},Event:function(){},setTimeout,clearTimeout,URL
  });
  vm.runInContext(source('dashboard-session.js'),context);
  await auth({uid:'t1'},true,{authorized:true,role:'teacher',classIds:['one']});
  await context.window.ClassPointerDashboard.publish(room);
  assert.equal(typeof listener,'function','teacher page watches the class lesson list');
  const now=Date.now(),banner=()=>body.children.find(c=>c.id==='cpCompetingLessonBanner');
  // Alone: no banner.
  listener({val:()=>({[room]:{roomId:room,createdAt:now-1000,teacherUid:'t1'}})});
  assert.ok(!banner()||banner().hidden===true);
  // A newer live lesson from another account: banner names it, then the takeover refreshes createdAt.
  listener({val:()=>({[room]:{roomId:room,createdAt:now-1000,teacherUid:'t1'},[other]:{roomId:other,createdAt:now,teacherUid:'t2'}})});
  assert.ok(banner()&&banner().hidden===false,'banner is shown');
  assert.match(banner().children[0].textContent,/Another teacher account/);
  banner().children[1].onclick();
  await new Promise(r=>setTimeout(r,20));
  assert.ok(writes.some(([op,path,v])=>op==='update'&&path.endsWith('/'+room)&&v.createdAt&&v.createdAt['.sv']==='timestamp'),'takeover refreshes the start time');
  assert.deepEqual(writes.filter(([op])=>op==='remove'),[],'nothing is deleted');
  // A competing lesson that is stale (teacher gone for over two minutes) or older is ignored.
  listener({val:()=>({[room]:{roomId:room,createdAt:now,teacherUid:'t1'},[other]:{roomId:other,createdAt:now+5,teacherUid:'t2',teacherOfflineAt:now-300000}})});
  assert.equal(banner().hidden,true);
});

test('student status pill reports reasons instead of failing silently',()=>{
  const text=fs.readFileSync(directory+'activity-share.js','utf8').split('\u2019').join("'").split(String.fromCharCode(0x2019)).join("'");
  for(const phrase of ['Connected to class',"Can't connect",'your sign-in was not accepted','not in a class that uses Class Pointer','could not be read','did not accept your passcode','Waiting for your teacher'])
    assert.ok(text.includes(phrase),'pill text present: '+phrase);
});
