'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function harness(classId='testing') {
  const html=fs.readFileSync('admin.html','utf8');
  const start=html.indexOf('function cpFeatureOf(tool)');
  const end=html.indexOf('async function cpSave(',start);
  assert.ok(start>0&&end>start,'Owner class editor must exist');
  const controls={
    lock:{dataset:{cpBig:'locked'}},
    open:{dataset:{cpBig:'open'}},
    timed15:{dataset:{cpNewTimed:'15'}},
    starHalacha:{dataset:{cpNewstar:'halacha'}},
    starQuiz:{dataset:{cpNewstar:'chumash-quiz'}},
    lockMishnayos:{dataset:{cpTilelock:'record-mishnayos'}},
    halacha:{dataset:{cpGrant:'halacha'}},
    posuk:{dataset:{cpGrant:'posuk-practice-scroll'}}
  };
  const panel={
    innerHTML:'',
    querySelectorAll(query){
      if(query==='[data-cp-big]')return [controls.open,controls.lock];
      if(query==='[data-cp-newstar]')return [controls.starHalacha,controls.starQuiz];
      if(query==='[data-cp-new-timed]')return [controls.timed15];
      if(query==='[data-cp-tilelock]')return [controls.lockMishnayos];
      if(query==='[data-cp-grant]')return [controls.halacha,controls.posuk];
      return [];
    }
  };
  const writes=[],lockCalls=[];
  const db={ref(path=''){
    return {
      async set(value){writes.push({path,method:'set',value})},
      async update(value){writes.push({path,method:'update',value})},
      async once(){return {val:()=>null}}
    };
  }};
  const classes={
    et:{name:'ET',active:true},
    wt:{name:'WT',active:true},
    testing:{name:'Testing',active:true,toolGrants:{halacha:true}},
    family_and_friends:{name:'Family and Friends',active:true,toolGrants:{halacha:false}}
  };
  const ctx={
    cpClass:classId,cpRecords:classes,cpSettings:{siteEnabled:true},
    cpBusy:false,cpMsg:'',frame:{contentWindow:{
      firebase:{database:()=>db},B3SiteSettings:{workspaceId:'b3-2026'}
    }},
    document:{getElementById:()=>null},
    cpGames:()=>[{id:'halacha',name:'Halacha'},{id:'posuk-practice-scroll',name:'Posuk Practice'}],
    cpClassTabs:()=>'',cpBindClassTabs:()=>{},cpEsc:String,
    cpApi:()=>({newYorkMidnightMs:()=>1900000000000,updateSiteEnabled:async()=>{throw Error('Unexpected global update')},manageStudentLocks:async(id,body)=>{lockCalls.push({id,...body});return {ok:true}}}),
    cpSave:async(fn)=>await fn(),console
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start,end),ctx);
  return {ctx,panel,controls,writes,lockCalls,render:()=>ctx.renderOwnerPlatformClass(panel)};
}
const ROOT='b3Games/workspaces/b3-2026/classes';

test('the big LOCK switch locks the class and every feature of that class only',async()=>{
  const x=harness('testing');
  x.render();
  assert.match(x.panel.innerHTML,/Testing/);
  await x.controls.lock.onclick();
  assert.equal(x.writes.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(x.writes[0].value)),{[ROOT+'/testing/access/mode']:'locked',[ROOT+'/testing/access/openUntil']:null});
  assert.deepEqual(JSON.parse(JSON.stringify(x.lockCalls)),[{id:'testing',action:'setAll',locked:true}]);
});

test('the big OPEN switch opens class access, every feature lock and every tool of that class in one press',async()=>{
  const x=harness('testing');
  x.render();
  await x.controls.open.onclick();
  assert.equal(x.writes.length,1);
  const update=x.writes[0].value;
  assert.equal(update[ROOT+'/testing/access/mode'],'open');
  assert.equal(update[ROOT+'/testing/siteEnabled'],true);
  assert.equal(update[ROOT+'/testing/access/openUntil'],null);
  assert.equal(update[ROOT+'/testing/toolGrants/halacha'],true);
  assert.equal(update[ROOT+'/testing/toolGrants/posuk-practice-scroll'],true);
  assert.ok(Object.keys(update).every(k=>k.startsWith(ROOT+'/testing/')),'only the selected class is written');
  assert.deepEqual(JSON.parse(JSON.stringify(x.lockCalls)),[{id:'testing',action:'setAll',locked:false}]);
});

test('15 min after LOCK opens the features first, then sets the class open-until time',async()=>{
  const x=harness('testing');
  x.render();
  await x.controls.lock.onclick();
  x.lockCalls.length=0;x.writes.length=0;
  await x.controls.timed15.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(x.lockCalls)),[{id:'testing',action:'setAll',locked:false}],'feature locks are cleared even if the panel has not yet seen them');
  assert.equal(x.writes.length,1);
  assert.equal(x.writes[0].path,ROOT+'/testing/access/openUntil');
  assert.equal(x.writes[0].method,'set');
  const left=x.writes[0].value-Date.now();
  assert.ok(left>14*60000&&left<=15*60000+1000,'about 15 minutes from now');
});

test('star: a starred tool stays open while the class is locked (saved as access/stars/<tool>, feature lock opened with it)',async()=>{
  const x=harness('testing');
  x.render();
  await x.controls.starHalacha.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(x.writes)),[{path:ROOT+'/testing/access/stars/halacha',method:'set',value:1900000000000}]);
  assert.deepEqual(JSON.parse(JSON.stringify(x.lockCalls)),[{id:'testing',action:'setFeature',featureId:'halacha',locked:false}]);
});

test('each Chumash Cheder tile has its own star and its own lock',async()=>{
  const x=harness('testing');
  x.render();
  assert.match(x.panel.innerHTML,/Chumash/);
  for(const key of ['posuk-practice-scroll','chumash-quiz','record-mishnayos','record-mishnayos-quiz'])assert.match(x.panel.innerHTML,new RegExp('data-cp-newstar="'+key+'"'));
  for(const key of ['posuk-practice-scroll','chumash-quiz','record-mishnayos','record-mishnayos-quiz'])assert.match(x.panel.innerHTML,new RegExp('data-cp-tilelock="'+key+'"'));
  await x.controls.starQuiz.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(x.writes)),[
    {path:ROOT+'/testing/toolGrants/posuk-practice-scroll',method:'set',value:true},
    {path:ROOT+'/testing/access/stars/chumash-quiz',method:'set',value:1900000000000}],'only the quiz tile is starred; the tool is switched on first');
  assert.deepEqual(JSON.parse(JSON.stringify(x.lockCalls)),[{id:'testing',action:'setFeature',featureId:'chumash-quiz',locked:false}],'only that tile feature is unlocked');
  x.lockCalls.length=0;
  await x.controls.lockMishnayos.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(x.lockCalls)),[{id:'testing',action:'setFeature',featureId:'record-mishnayos',locked:true}],'locking one tile locks only that tile');
});

test('LOCK keeps a starred tool open and OPEN clears every star',async()=>{
  const x=harness('testing');
  x.ctx.cpRecords.testing.access={stars:{halacha:Date.now()+3600000}};
  x.render();
  await x.controls.lock.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(x.lockCalls)),[{id:'testing',action:'setAll',locked:true},{id:'testing',action:'setFeature',featureId:'halacha',locked:false}]);
  x.writes.length=0;
  await x.controls.open.onclick();
  assert.equal(JSON.parse(JSON.stringify(x.writes[0].value))[ROOT+'/testing/access/stars'],null);
});

test('student pages honour the timed unlock and stars: game gate, student home page, Arcade server rule',()=>{
  const gate=fs.readFileSync('game-gate.js','utf8'),home=fs.readFileSync('index.html','utf8');
  assert.match(gate,/access\.stars\[starKey\]/);
  assert.match(gate,/record-mishnayos-quiz/);assert.match(gate,/chumash-quiz/);
  assert.match(gate,/assignedClass\.access&&assignedClass\.access\.openUntil/);
  assert.match(home,/accessNow\.openUntil/);
  assert.match(home,/accessNow\.stars/);
  const policy=require('../backend/functions/multiplayer-lock-policy.cjs'),t=new Date('2026-11-23T16:00:00Z');
  const ok=(access)=>policy.allowsMultiplayer({actorRole:'student',classId:'testing',studentId:'x',settings:{siteEnabled:true},classRow:{siteEnabled:true,access},date:t});
  assert.equal(ok({mode:'locked'}),false);
  assert.equal(ok({mode:'locked',stars:{'multiplayer-center':t.getTime()+60000}}),true,'starred Arcade opens while locked');
  assert.equal(ok({mode:'locked',stars:{'multiplayer-center':t.getTime()-60000}}),false,'and stops when the star ends');
  assert.equal(ok({mode:'locked',openUntil:t.getTime()+60000}),true);
});

test('Halacha is changed for the selected class only',async()=>{
  const x=harness('testing');
  x.render();
  await x.controls.halacha.onclick();
  assert.deepEqual(x.writes,[{path:ROOT+'/testing/toolGrants/halacha',method:'set',value:false}]);
  x.ctx.cpClass='family_and_friends';
  x.render();
  await x.controls.halacha.onclick();
  assert.deepEqual(x.writes[1],{path:ROOT+'/family_and_friends/toolGrants/halacha',method:'set',value:true});
});

test('new classes retain distinct tools and can be selected without ET/WT hardcoding',()=>{
  const x=harness('family_and_friends');
  x.render();
  assert.match(x.panel.innerHTML,/Family and Friends/);
  assert.match(x.panel.innerHTML,/data-cp-grant/);
  assert.match(x.panel.innerHTML,/data-cp-big/);
});
