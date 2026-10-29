'use strict';
// Synthetic-only regression: explicit Chazara orphan repair must not assign
// ambiguous classless history or another class's events to the selected class.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const classScope = require('../backend/functions/teacher-class-scope');

function fixture() {
  const base = 'posukPractice/chazara/events/shared';
  const events = {
    alpha_done: {workspaceClassId:'alpha',reviewApplied:true,recorded:true,pointRequestStatus:'approved'},
    beta_orphan: {workspaceClassId:'beta',reviewApplied:true,recorded:true},
    ambiguous_orphan: {reviewApplied:true,recorded:true}
  };
  return {
    'b3Games/workspaces/b3-2026/teachers/teacher': {active:true,classIds:{alpha:true}},
    'b3Games/workspaces/b3-2026/classes/alpha': {
      active:true,name:'Alpha',toolGrants:{chazara:true},members:{shared:{active:true}}
    },
    'b3Games/students/shared/profile': {name:'Fictional Shared Student',active:true},
    'b3Games/students/shared/memberships': {
      a:{workspaceId:'b3-2026',classId:'alpha',active:true},
      b:{workspaceId:'b3-2026',classId:'beta',active:true}
    },
    [base]:events,
    ...Object.fromEntries(Object.entries(events).map(([id,event])=>[base+'/'+id,event])),
    'studentRewards/pointRequests': {}
  };
}

function server(data) {
  const reads=[],writes=[];
  const snap=value=>({
    val:()=>value===undefined?null:value,
    exists:()=>value!=null,
    forEach(callback){Object.entries(value||{}).forEach(([key,v])=>callback({key,val:()=>v}));}
  });
  const db={ref:path=>({
    get:async()=>{reads.push(path);return snap(data[path]);},
    set:async value=>{writes.push([path,value]);},
    update:async value=>{writes.push([path,value]);}
  })};
  const admin={
    apps:[{}],database:()=>db,
    auth:()=>({verifyIdToken:async()=>({uid:'teacher',email:'teacher@example.test',email_verified:true})})
  };
  const ctx={
    exports:{},
    require:name=>name==='firebase-admin'?admin:
      name==='firebase-functions/v2/https'?{onRequest:(_options,handler)=>handler}:
      name==='./teacher-class-scope'?classScope:
      name.startsWith('./')?require('../backend/functions/'+name.slice(2)):require(name),
    console,Buffer,Intl,Date,process
  };
  vm.runInNewContext(fs.readFileSync('backend/functions/student-rewards-auto-award.js','utf8'),ctx);
  async function call(action,extra={}) {
    const req={method:'POST',body:{action,classId:'alpha',...extra},headers:{authorization:'Bearer synthetic'}};
    const res={
      code:200,set(){return this},setHeader(){return this},
      status(code){this.code=code;return this},
      json(body){this.body=body;return this},end(){return this}
    };
    await ctx.exports.studentRewardsAutoAward(req,res);
    return res;
  }
  return {call,reads,writes};
}

const eventsPath='posukPractice/chazara/events/shared';
test('pending-only startup never scans or repairs a shared student\'s ambiguous orphans',async()=>{
  const x=server(fixture());
  const result=await x.call('list-chazara-pending');
  assert.equal(result.code,200,JSON.stringify(result.body));
  assert.equal(x.reads.some(path=>path.startsWith('posukPractice/chazara/events/')),false);
  assert.deepEqual(x.writes,[]);
});

test('explicit class recovery skips foreign and ambiguous legacy orphans',async()=>{
  const x=server(fixture());
  const result=await x.call('repair-chazara-pending');
  assert.equal(result.code,200,JSON.stringify(result.body));
  assert.ok(x.reads.includes(eventsPath),'explicit recovery may inspect the authorized student history');
  assert.equal(x.reads.some(path=>path.startsWith('studentRewards/pointRequests/')),false,
    'no foreign or ambiguous orphan should reach a point-request lookup');
  assert.deepEqual(x.writes,[],'no request or class attribution may be written for ambiguous records');
});

test('unassigned class and revoked tool grant block recovery before event reads',async()=>{
  const data=fixture(),x=server(data);
  const wrongClass=await x.call('repair-chazara-pending',{classId:'beta'});
  assert.notEqual(wrongClass.code,200);
  assert.equal(x.reads.includes(eventsPath),false);
  data['b3Games/workspaces/b3-2026/classes/alpha'].toolGrants.chazara=false;
  const revoked=await x.call('repair-chazara-pending');
  assert.notEqual(revoked.code,200);
  assert.equal(x.reads.includes(eventsPath),false);
  assert.deepEqual(x.writes,[]);
});
