const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function active(room){return Object.entries(room.players||{}).filter(([,player])=>player&&!player.left)}

test('shared race publishes invite summaries only when visible fields change',()=>{
  const source=fs.readFileSync('b3-race.js','utf8');
  const start=source.indexOf('function publishCenterRoom(data, code)');
  const end=source.indexOf('\n    function draw()',start);
  assert.notEqual(start,-1);assert.notEqual(end,-1);
  const writes=[];
  const context={opts:{centerPath:'multiplayerCenter/class/rooms',gameKey:'shorashim',gameName:'Shorashim Race'},me:'host',myName:'Host',active,centerSummarySignatures:Object.create(null),firebase:{database:{ServerValue:{TIMESTAMP:123}}},centerRoomRef:()=>({set:summary=>{writes.push(summary);return Promise.resolve();}}),console};
  const publish=vm.runInNewContext(source.slice(start,end)+';publishCenterRoom',context);
  const room={host:'host',hostName:'Host',state:'lobby',createdAt:100,players:{host:{name:'Host',score:0,q:0}}};
  publish(room,'1234');
  publish({...room,players:{host:{name:'Host',score:1,q:1}}},'1234');
  assert.equal(writes.length,1,'answer progress alone does not rewrite the invite');
  publish({...room,players:{...room.players,guest:{name:'Guest',score:0,q:0}}},'1234');
  assert.equal(writes.length,2,'player count updates the invite once');
  publish({...room,state:'playing'},'1234');
  assert.equal(writes.length,3,'room state updates the invite once');
});

test('Rashi match publishes invite summaries only when visible fields change',()=>{
  const html=fs.readFileSync('rashi-letters/student.html','utf8');
  const line=html.split(/\r?\n/).find(value=>value.startsWith('function publishRashiCenterRoom('));
  assert.ok(line);
  const writes=[];
  const context={mpCenterPath:'multiplayerCenter/class',studentId:'host',studentName:'Host',activePlayers:active,mpCenterSummarySignatures:Object.create(null),db:{ref:()=>({set:summary=>{writes.push(summary);return Promise.resolve();}})},firebase:{database:{ServerValue:{TIMESTAMP:123}}},console};
  const publish=vm.runInNewContext(line+';publishRashiCenterRoom',context);
  const room={host:'host',hostName:'Host',state:'lobby',createdAt:100,players:{host:{name:'Host',score:0,q:0}}};
  publish(room,'1234');
  publish({...room,players:{host:{name:'Host',score:1,q:1}}},'1234');
  assert.equal(writes.length,1,'answer progress alone does not rewrite the invite');
  publish({...room,players:{...room.players,guest:{name:'Guest',score:0,q:0}}},'1234');
  assert.equal(writes.length,2,'player count updates the invite once');
  publish({...room,state:'playing'},'1234');
  assert.equal(writes.length,3,'room state updates the invite once');
});
