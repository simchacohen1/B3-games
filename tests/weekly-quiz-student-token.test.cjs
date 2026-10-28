'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

// Load the HTTPS wrapper with fake Firebase dependencies and capture its handler.
function loadHandler({verify,action}){
  const mod={exports:{}};let handler=null;
  const mockRequire=name=>{
    if(name==='firebase-functions/v2/https')return {onRequest:(options,fn)=>{handler=fn;return fn;}};
    if(name==='firebase-admin')return {apps:[{}],initializeApp(){},auth:()=>({verifyIdToken:verify}),database:()=>({ref:()=>({})})};
    if(name==='./weekly-quiz-student-core.cjs')return {weeklyQuizStudentAction:action};
    throw Error('Unexpected dependency in weekly quiz token test: '+name);
  };
  new Function('require','module','exports',fs.readFileSync(path.join(__dirname,'../backend/functions/weekly-quiz-student.js'),'utf8'))(mockRequire,mod,mod.exports);
  return handler;
}
async function call(handler,authorization){
  const out={status:0,body:null};
  const res={set(){},status(code){out.status=code;return this;},json(body){out.body=body;return this;}};
  await handler({method:'POST',headers:authorization?{authorization}:{},body:{action:'launch',launchId:'quiz_one'}},res);
  return out;
}

test('expired, revoked or malformed student tokens get 401, not a retried 500',async()=>{
  let actionCalls=0;
  for(const code of ['auth/id-token-expired','auth/id-token-revoked','auth/user-disabled','auth/argument-error']){
    const handler=loadHandler({verify:async()=>{const e=new Error('bad token');e.code=code;throw e;},action:async()=>{actionCalls++;return {};}});
    const out=await call(handler,'Bearer synthetic-bad-token');
    assert.equal(out.status,401,code);
    assert.equal(out.body.error,'Student sign-in required.');
  }
  assert.equal(actionCalls,0,'no quiz data is read for an invalid token');
});

test('missing token is 401; valid token reaches the quiz action; action failures keep their status',async()=>{
  const decoded={uid:'u1',b3StudentId:'s1',b3ClassId:'alpha'};
  let seen=null;
  const ok=loadHandler({verify:async(token,checkRevoked)=>{assert.equal(token,'good');assert.equal(checkRevoked,true);return decoded;},action:async args=>{seen=args.decoded;return {ok:true};}});
  assert.equal((await call(ok,'')).status,401);
  const good=await call(ok,'Bearer good');
  assert.equal(good.status,200);assert.deepEqual(good.body,{ok:true});assert.equal(seen,decoded);
  const forbidden=loadHandler({verify:async()=>decoded,action:async()=>{const e=new Error('This quiz is not assigned to you.');e.status=403;throw e;}});
  assert.deepEqual(await call(forbidden,'Bearer good'),{status:403,body:{error:'This quiz is not assigned to you.'}});
  const broken=loadHandler({verify:async()=>decoded,action:async()=>{throw new Error('database down');}});
  const originalError=console.error;console.error=()=>{};
  try{assert.deepEqual(await call(broken,'Bearer good'),{status:500,body:{error:'Could not load this quiz. Try again.'}});}
  finally{console.error=originalError;}
});
