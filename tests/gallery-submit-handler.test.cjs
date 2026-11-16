'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');

for(const classId of ['et','wt'])test(`fictional ${classId} screenshot submission saves canonical identity pending approval`,async()=>{
  const writes=[],files=[];
  const admin={apps:[{}],database:()=>({ref:path=>({
    transaction:async()=>({committed:true}),
    push:()=>({key:'fictional-post',set:async row=>writes.push({path,row})})
  })}),storage:()=>({bucket:()=>({name:'fictional-staging-bucket',file:path=>({
    save:async()=>files.push(path),delete:async()=>assert.fail('successful upload must be retained')
  })})})};
  const mod={exports:{}};
  new Function('require','module','exports',fs.readFileSync('backend/functions/class-gallery-submit.js','utf8'))(name=>{
    if(name==='node:crypto')return require(name);
    if(name==='firebase-admin')return admin;
    if(name==='firebase-functions/v2/https')return {onRequest:(_,handler)=>handler};
    if(name==='./student-login-core.cjs')return {resolveStudent:async()=>({id:'fictional-'+classId,classId,profile:{name:'Fictional '+classId},cls:{name:'B3 '+classId.toUpperCase()}})};
    throw new Error('Unexpected dependency '+name);
  },mod,mod.exports);
  let code=200,body;
  const res={set(){},status(n){code=n;return this;},json(v){body=v;return this;}};
  await mod.exports.classGallerySubmit({method:'POST',body:{
    studentName:'Spoofed Name',studentId:'spoofed',classId:classId==='et'?'wt':'et',
    title:'Fictional staging work',image:'data:image/png;base64,'+Buffer.from('89504e470d0a1a0a','hex').toString('base64'),source:'halacha'
  }},res);
  assert.equal(code,201);assert.equal(body.pending,true);
  assert.equal(writes.length,1);assert.equal(files.length,1);
  assert.equal(writes[0].path,'classGallery/posts');
  assert.equal(writes[0].row.studentId,'fictional-'+classId);
  assert.equal(writes[0].row.classId,classId);
  assert.equal(writes[0].row.studentName,'Fictional '+classId);
  assert.equal(writes[0].row.status,'pending');
  assert.equal(writes[0].row.category,'Halacha');
});
