'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../class-pointer-prototype/activity-share.js'),'utf8');
const start=source.indexOf('    function routeTeacherRequest(session){');
const end=source.indexOf('    function stop(){',start);
assert.ok(start>=0&&end>start,'Expected real activity redirect handler');
const redirectFunction=source.slice(start,end).trim();

function fixture({mode='boards',sharing=true,denied=false,ageMs=1000}={}){
  let assigned='',prompted=0;const saved=new Map();const now=Date.now();
  const room='class-pointer-12345678-1234-1234-1234-123456789abc';
  const session={roomId:room,permissionRevision:10,destinationRequest:{mode,at:now-ageMs}};
  const location={assign(url){assigned=url}};
  const context={
    permissionReady:true,permission:{whiteboardDenied:denied,screenSharingDenied:false},
    loadedAt:now,active:session,stream:sharing?{}:null,sessionStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)},
    inviteKey:'invite:et',location,root:'https://funtorahtools.com/',URL,Date,
    showPrompt(){prompted++}
  };
  const fn=vm.runInNewContext('('+redirectFunction.replace(/^function routeTeacherRequest/,'function')+')',context);
  return{send:()=>fn(session),get assigned(){return assigned},get prompted(){return prompted},saved};
}

test('whiteboard request from Shorashim never redirects, even while screen sharing',()=>{
  const f=fixture({mode:'boards',sharing:true});f.send();
  assert.equal(f.assigned,'');
  assert.equal(f.prompted,0);
});
test('screen requests still do not interrupt an active share',()=>{
  const f=fixture({mode:'screens',sharing:true});f.send();
  assert.equal(f.assigned,'');assert.equal(f.prompted,0);
});
test('whiteboard denial remains enforced',()=>{
  const f=fixture({mode:'boards',sharing:true,denied:true});f.send();
  assert.equal(f.assigned,'');
});
test('stale whiteboard requests cannot redirect a student',()=>{
  const f=fixture({mode:'boards',sharing:true,ageMs:90000});f.send();
  assert.equal(f.assigned,'');
});
test('whiteboard invite is not replayed twice',()=>{
  const f=fixture({mode:'boards',sharing:true});f.send();f.send();
  assert.equal(f.saved.size,1);
});
