'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function harness(classId='testing') {
  const html=fs.readFileSync('admin.html','utf8');
  const start=html.indexOf('function renderOwnerPlatformClass(panel){');
  const end=html.indexOf('async function cpSave(',start);
  assert.ok(start>0&&end>start,'Owner class editor must exist');
  const controls={
    lock:{dataset:{cpNewMode:'locked'}},
    open:{dataset:{cpNewMode:'open'}},
    halacha:{dataset:{cpGrant:'halacha'}},
    posuk:{dataset:{cpGrant:'posuk-practice-scroll'}}
  };
  const panel={
    innerHTML:'',
    querySelectorAll(query){
      if(query==='[data-cp-new-mode]')return [controls.open,controls.lock];
      if(query==='[data-cp-grant]')return [controls.halacha,controls.posuk];
      return [];
    }
  };
  const writes=[];
  const db={ref(path=''){
    return {
      async set(value){writes.push({path,method:'set',value})},
      async update(value){writes.push({path,method:'update',value})}
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
    cpApi:()=>({updateSiteEnabled:async()=>{throw Error('Unexpected global update')}}),
    cpSave:async(fn)=>await fn(),console
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start,end),ctx);
  return {ctx,panel,controls,writes,render:()=>ctx.renderOwnerPlatformClass(panel)};
}
const ROOT='b3Games/workspaces/b3-2026/classes';

test('owner can lock Testing without touching ET, WT, or Family and Friends',async()=>{
  const x=harness('testing');
  x.render();
  assert.match(x.panel.innerHTML,/Testing/);
  await x.controls.lock.onclick();
  assert.deepEqual(x.writes,[{path:ROOT+'/testing/access/mode',method:'set',value:'locked'}]);
});

test('opening a class clears its own site lock without changing another class',async()=>{
  const x=harness('testing');
  x.render();
  await x.controls.open.onclick();
  assert.equal(x.writes.length,1);
  const update=x.writes[0].value;
  assert.equal(update[ROOT+'/testing/access/mode'],'open');
  assert.equal(update[ROOT+'/testing/siteEnabled'],true);
  assert.deepEqual(Object.keys(update).sort(),[ROOT+'/testing/access/mode',ROOT+'/testing/siteEnabled'].sort());
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
  assert.match(x.panel.innerHTML,/data-cp-new-mode/);
});
