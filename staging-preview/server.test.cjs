'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),vm=require('node:vm');
const site=fs.readFileSync('staging-preview/index.html','utf8');
test('staging auth harness targets only staging Firebase Auth and never opens database or billing',()=>{
 assert.match(site,/PRIVATE STAGING · AUTH TEST ONLY/);
 assert.match(site,/projectId:'fun-torah-tools-staging'/);
 assert.match(site,/authDomain:'fun-torah-tools-staging\.firebaseapp\.com'/);
 assert.match(site,/Email me a sign-in link/);
 assert.match(site,/sendSignInLinkToEmail/);
 assert.match(site,/signInWithEmailLink/);
 assert.match(site,/await auth\.signOut\(\)/);
 assert.doesNotMatch(site,/firebase\.database\(|\.database\(\)|stripe\.com|cloudfunctions\.net|funtorahtools\.com|b3-games\.firebaseapp\.com/);
 const scripts=[...site.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].filter(m=>m[1].trim());
 assert.equal(scripts.length,1);assert.doesNotThrow(()=>new vm.Script(scripts[0][1]));
});
test('staging server only serves preview after strong authentication',async()=>{
 const port=30000+Math.floor(Math.random()*20000),username='ftt-private-test',password='Abc123'.repeat(8);
 const child=spawn(process.execPath,['staging-preview/server.cjs'],{
  env:{...process.env,PORT:String(port),STAGING_USERNAME:username,STAGING_PASSWORD:password},
  stdio:'ignore'
 });
 try{
  let ready=false;
  for(let n=0;n<45;n++){
   try{const r=await fetch('http://127.0.0.1:'+port+'/health');if(r.ok){ready=true;break;}}catch(_){}
   await new Promise(resolve=>setTimeout(resolve,130));
  }
  assert.equal(ready,true,'Server must start');
  const url='http://127.0.0.1:'+port+'/';
  const unauthorized=await fetch(url);
  assert.equal(unauthorized.status,401);
  assert.match(unauthorized.headers.get('www-authenticate'),/^Basic /);
  const wrong=await fetch(url,{headers:{Authorization:'Basic '+Buffer.from(username+':wrong').toString('base64')}});
  assert.equal(wrong.status,401);
  const auth={'Authorization':'Basic '+Buffer.from(username+':'+password).toString('base64')};
  const ok=await fetch(url,{headers:auth});
  assert.equal(ok.status,200);assert.match(await ok.text(),/Teacher Sign In/);
  assert.match(ok.headers.get('content-security-policy'),/connect-src[^;]*identitytoolkit\.googleapis\.com/);
  assert.match(ok.headers.get('content-security-policy'),/script-src[^;]*www\.gstatic\.com/);
  assert.equal(ok.headers.get('cache-control'),'no-store, max-age=0');
  const forbidden=await fetch(url+'../firebase-config.js',{headers:auth});
  assert.equal(forbidden.status,404);
 }finally{child.kill('SIGTERM');}
});

