'use strict';
// Synthetic, no-network coverage of the actual Class Gallery screenshot POST
// handler and student resolver. No Firebase credentials or real student data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const functionsDir = path.join(__dirname, '../backend/functions');
const jpeg = 'data:image/jpeg;base64,' + Buffer.from([255,216,255,224,0,1]).toString('base64');

function setup({failUpload=false, failPost=false, removed=false}={}) {
  const students = {
    alpha: {profile:{name:'Fictional Alpha',active:true,classId:'et'},memberships:{
      et:{workspaceId:'b3-2026',classId:'et',active:!removed}
    }},
    beta: {profile:{name:'Fictional Beta',active:true,classId:'wt'},memberships:{
      wt:{workspaceId:'b3-2026',classId:'wt',active:true}
    }},
    gamma: {profile:{name:'Fictional Gamma',active:true},memberships:{
      et:{workspaceId:'b3-2026',classId:'et',active:true},
      room:{workspaceId:'b3-2026',classId:'roomC',active:true}
    }}
  };
  const tree = {b3Games:{students,workspaces:{'b3-2026':{classes:{
    et:{name:'B3 ET',active:true,members:{alpha:{active:true},gamma:{active:true}}},
    wt:{name:'B3 WT',active:true,members:{beta:{active:true}}},
    roomC:{name:'Room C',active:true,members:{gamma:{active:true}}}
  }}}},posukPractice:{allowedStudents:{}}};
  const reads=[],posts=[],uploads=[],deletes=[],limits=new Map();
  let nextId=0;
  const at = p => String(p).split('/').filter(Boolean).reduce((v,k)=>v==null?undefined:v[k],tree);
  const database = {ref(p) {
    return {
      once: async () => {reads.push(p);return {val:()=>at(p)??null};},
      transaction: async fn => {
        const old=limits.get(p)??null, updated=fn(old);
        if(updated===undefined)return {committed:false};
        limits.set(p,updated);return {committed:true};
      },
      push: () => {
        const key='fictional_post_'+(++nextId);
        return {key,set:async data=>{
          if(failPost)throw new Error('synthetic database write failed');
          posts.push({path:p+'/'+key,data});
        }};
      }
    };
  }};
  const storage = {bucket(name) {
    return {name,file:p=>({
      save:async(bytes,options)=>{
        if(failUpload)throw new Error('synthetic storage upload failed');
        uploads.push({path:p,bytes:Buffer.from(bytes),options});
      },
      delete:async()=>{deletes.push(p);}
    })};
  }};
  const admin={apps:[{}],database:()=>database,storage:()=>storage};
  const mocks={
    'firebase-admin':admin,
    'firebase-functions/v2/https':{onRequest:(opts,handler)=>handler},
    './student-passcodes.cjs':{readPasscode:async(_get,id)=>({
      passcode:{alpha:'1111',beta:'2222',gamma:'3333'}[id]||''
    })}
  };
  function load(file) {
    const mod={exports:{}};
    const localRequire=name=>{
      if(Object.prototype.hasOwnProperty.call(mocks,name))return mocks[name];
      if(name==='./student-login-core.cjs')return load('student-login-core.cjs');
      return require(name);
    };
    const source=fs.readFileSync(path.join(functionsDir,file),'utf8');
    new Function('require','module','exports',source)(localRequire,mod,mod.exports);
    return mod.exports;
  }
  const handler=load('class-gallery-submit.js').classGallerySubmit;
  async function call(method,body={}) {
    let code=200,response;
    const res={set(){return this;},status(v){code=v;return this;},json(v){response=v;return this;}};
    await handler({method,body},res);
    return {code,body:response};
  }
  return {call,reads,posts,uploads,deletes,limits};
}
const request=(overrides={})=>({
  studentId:'alpha',studentName:'Fictional Alpha',pin:'1111',classId:'et',
  title:'My Shorashim work',description:'A synthetic picture',
  image:jpeg,source:'shorashim',...overrides
});

test('GET readiness performs no database read, storage upload or post',async()=>{
  const s=setup(),r=await s.call('GET');
  assert.equal(r.code,200);
  assert.equal(r.body.ready,true);
  assert.deepEqual([s.reads.length,s.posts.length,s.uploads.length],[0,0,0]);
});
test('verified ET student creates exactly one pending post and private screenshot',async()=>{
  const s=setup(),r=await s.call('POST',request());
  assert.equal(r.code,201);
  assert.equal(r.body.pending,true);
  assert.equal(s.posts.length,1);
  assert.match(s.posts[0].path,/^classGallery\/posts\/fictional_post_/);
  assert.equal(s.posts[0].data.classId,'et');
  assert.equal(s.posts[0].data.studentId,'alpha');
  assert.equal(s.posts[0].data.status,'pending');
  assert.equal(s.posts[0].data.category,'Shorashim');
  assert.equal(s.uploads.length,1);
  assert.match(s.uploads[0].path,/^classGallery\/verified\/et\//);
  assert.equal(s.uploads[0].options.contentType,'image/jpeg');
});
test('a verified new-class student writes only to its class-scoped gallery',async()=>{
  const s=setup(),r=await s.call('POST',request({
    studentId:'gamma',studentName:'Fictional Gamma',pin:'3333',classId:'roomC'
  }));
  assert.equal(r.code,201);
  assert.equal(s.posts.length,1);
  assert.match(s.posts[0].path,/^b3Games\/workspaces\/b3-2026\/classes\/roomC\/resources\/gallery\/posts\//);
  assert.equal(s.posts[0].data.classId,'roomC');
  assert.equal(s.posts[0].data.studentId,'gamma');
});
test('wrong individual passcode cannot create a post or upload',async()=>{
  const s=setup(),r=await s.call('POST',request({pin:'wrong'}));
  assert.equal(r.code,401);
  assert.equal(s.posts.length,0);
  assert.equal(s.uploads.length,0);
});
test('revoked membership cannot create a post or upload',async()=>{
  const s=setup({removed:true}),r=await s.call('POST',request());
  assert.equal(r.code,403);
  assert.equal(s.posts.length,0);
  assert.equal(s.uploads.length,0);
});
test('student in two classes cannot post to an unassigned third class',async()=>{
  const s=setup(),r=await s.call('POST',request({
    studentId:'gamma',studentName:'Fictional Gamma',pin:'3333',classId:'wt'
  }));
  assert.equal(r.code,403);
  assert.equal(s.posts.length,0);
  assert.equal(s.uploads.length,0);
});
test('invalid image never uploads or creates a pending post',async()=>{
  const s=setup(),r=await s.call('POST',request({image:'data:image/jpeg;base64,AAAA'}));
  assert.equal(r.code,400);
  assert.equal(s.posts.length,0);
  assert.equal(s.uploads.length,0);
});
test('same student cannot submit a second screenshot immediately',async()=>{
  const s=setup();
  assert.equal((await s.call('POST',request())).code,201);
  const again=await s.call('POST',request({title:'Again'}));
  assert.equal(again.code,429);
  assert.equal(s.posts.length,1);
  assert.equal(s.uploads.length,1);
});
test('storage failure leaves no gallery post and attempts cleanup',async()=>{
  const s=setup({failUpload:true}),r=await s.call('POST',request());
  assert.equal(r.code,500);
  assert.equal(s.posts.length,0);
  assert.equal(s.uploads.length,0);
  assert.equal(s.deletes.length,1);
});
test('database failure after upload deletes orphaned private screenshot',async()=>{
  const s=setup({failPost:true}),r=await s.call('POST',request());
  assert.equal(r.code,500);
  assert.equal(s.posts.length,0);
  assert.equal(s.uploads.length,1);
  assert.equal(s.deletes.length,1);
  assert.equal(s.deletes[0],s.uploads[0].path);
});