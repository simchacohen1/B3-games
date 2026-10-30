'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { allowsMultiplayer, isScheduledOpen, newYorkNow } = require('../backend/functions/multiplayer-lock-policy.cjs');

const TOOL='multiplayer-center';
const mondayLocked = new Date('2026-11-02T14:05:00Z'); // 9:05 AM Eastern
const mondayBreak = new Date('2026-11-02T15:20:00Z'); // 10:20 AM Eastern

function input(settings = {}, extra = {}) {
  return { actorRole:'student', studentId:'boy_a', classId:'et', settings, classRow:{active:true}, date:mondayLocked, ...extra };
}
test('lock schedule uses New York time, including the standard-time change', () => {
  assert.deepEqual(newYorkNow(mondayLocked), {day:'mon',minutes:545});
  assert.equal(isScheduledOpen({},'et',mondayLocked),false);
  assert.equal(isScheduledOpen({},'et',mondayBreak),true);
  assert.equal(isScheduledOpen({},'wt',new Date('2026-11-02T17:30:00Z')),false);
});
test('manual lock and unlock, automatic schedule, and emergency lock follow normal activities',()=>{
  assert.equal(allowsMultiplayer(input()),false);
  assert.equal(allowsMultiplayer(input({}, {date:mondayBreak})),true);
  assert.equal(allowsMultiplayer(input({classAccess:{et:{mode:'open'}}})),true);
  assert.equal(allowsMultiplayer(input({classAccess:{et:{mode:'locked'}}}, {date:mondayBreak})),false);
  assert.equal(allowsMultiplayer(input({siteEnabled:false},{date:mondayBreak})),false);
});
test('teacher exceptions and individual class/student overrides follow existing access policy',()=>{
  const locked = {siteEnabled:false,classAccess:{et:{mode:'locked'}}};
  assert.equal(allowsMultiplayer(input(locked)),false);
  assert.equal(allowsMultiplayer(input(locked,{actorRole:'teacher'})),true);
  const student = { ...locked, studentGameOverrides:{boy_a:{[TOOL]:true}} };
  assert.equal(allowsMultiplayer(input(student)),true);
  assert.equal(allowsMultiplayer(input(student,{studentId:'boy_b'})),false);
  const classroom={...locked,classLockedGameOverride:{et:TOOL},classLockedGameOverrideUntil:{et:{[TOOL]:mondayLocked.getTime()+60000}}};
  assert.equal(allowsMultiplayer(input(classroom)),true);
  assert.equal(allowsMultiplayer(input(classroom,{date:new Date(mondayLocked.getTime()+61000)})),false);
});
test('disabled activity always wins even against unlocked special access',()=>{
  const settings={siteEnabled:false,games:{[TOOL]:false},studentGameOverrides:{boy_a:{[TOOL]:true}}};
  assert.equal(allowsMultiplayer(input(settings)),false);
  assert.equal(allowsMultiplayer(input({...settings,games:{},classGames:{et:{[TOOL]:false}}})),false);
});
test('new workspaces obey their class locks and authorized teachers remain exempt',()=>{
  assert.equal(allowsMultiplayer(input({}, {classId:'class-1',classRow:{siteEnabled:false}})),false);
  assert.equal(allowsMultiplayer(input({}, {classId:'class-1',classRow:{access:{mode:'locked'}}})),false);
  assert.equal(allowsMultiplayer(input({}, {classId:'class-1'})),true);
  assert.equal(allowsMultiplayer(input({}, {actorRole:'teacher',classId:'class-1',classRow:{access:{mode:'locked'}}})),true);
});
test('both entry pages use the exact same game-gate as locked activities',()=>{
  for(const path of ['multiplayer/index.html','multiplayer/game.html']){
    const page=fs.readFileSync(path,'utf8');
    assert.match(page,/game-gate\.js[^"]*" data-game-id="multiplayer-center"/);
  }
});

test('callable server refuses direct create and join while locked; leave remains available',async()=>{
  const studentId='boy_a', workspaceId='b3-2026', classId='et';
  const records={
    [`b3Games/students/${studentId}/memberships/${workspaceId}_${classId}`]:{active:true,classId,workspaceId},
    [`b3Games/workspaces/${workspaceId}/classes/${classId}`]:{active:true,members:{[studentId]:{active:true}}},
    'b3Games/siteSettings':{siteEnabled:true,classAccess:{et:{mode:'locked'}}},
  };
  const mockDb={ref(path){return {get:async()=>({val:()=>records[path]??null}),once:async()=>({val:()=>records[path]??null})}}};
  const fakeAdmin={apps:[],initializeApp(){},database:()=>mockDb};
  class HttpsError extends Error { constructor(code,message){super(message);this.code=code;} }
  const originalLoad=Module._load;
  Module._load=function(req,parent,isMain){
    if(req==='firebase-admin')return fakeAdmin;
    if(req==='firebase-functions/v2/https')return {onCall:(_options,handler)=>handler,HttpsError};
    return originalLoad.call(this,req,parent,isMain);
  };
  let handler;
  try{
    const path=require.resolve('../backend/functions/multiplayer-games.js');
    delete require.cache[path];
    handler=require('../backend/functions/multiplayer-games.js').multiplayerGameAction;
    delete require.cache[path];
  } finally {Module._load=originalLoad;}
  const base={workspaceId,classId,gameKey:'tic-tac-toe',roomCode:'bad!',action:'create'};
  const call=action=>handler({auth:{uid:'student_auth',token:{b3StudentId:studentId,b3ClassId:classId}},data:{...base,action}});
  await assert.rejects(call('create'),/locked for your class/);
  await assert.rejects(call('join'),/locked for your class/);
  await assert.rejects(call('move'),/locked for your class/);
  await assert.rejects(call('get-private'),/locked for your class/);
  // The safety exit is exempt from the lock, but still checks the room ID.
  await assert.rejects(call('leave'),/Invalid room or game/);
  records['b3Games/siteSettings']={siteEnabled:true,classAccess:{et:{mode:'locked'}},studentGameOverrides:{boy_a:{[TOOL]:true}}};
  await assert.rejects(call('join'),/Invalid room or game/);
});
