'use strict';
// A student can be in several classes. When the homepage signs in without
// naming a class, the server must start them in a class they are still active
// in, not simply the first membership (which may be an inactive class).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const C='b3Games/workspaces/b3-2026/classes/';
function load(file,data,coreResult){
 const tokens=[];
 const admin={apps:[{}],initializeApp(){},app:()=>({options:{projectId:'test'}}),database:()=>({ref:p=>({once:async()=>({val:()=>data[p]??null}),transaction:async()=>({committed:true})})}),auth:()=>({createCustomToken:async(uid,claims)=>{tokens.push(claims);return 'token'}})};
 const ctx={exports:{},process:{env:{}},Buffer,console,require:n=>{
  if(n==='firebase-functions/v2/https')return {onRequest:(o,fn)=>fn};
  if(n==='firebase-admin')return admin;
  if(n==='./student-auth-core.cjs')return {studentAuth:async()=>({...coreResult}),studentClassBootstrap:(cls,id)=>cls?{name:cls.name}:null};
  if(n.startsWith('./'))return require(path.resolve(path.dirname(file),n));
  return require(n);
 }};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),ctx);
 return {tokens,run:async body=>{const res={set(){},status(c){this.code=c;return this},json(v){this.body=v;return this}};await ctx.exports.funTorahStudentAuth({method:'POST',body,ip:'1.1.1.1'},res);return res}};
}
function data(){return {
 'b3Games/students/s1/profile':{name:'Sam',active:true},
 'b3Games/students/s1/memberships':{'b3-2026_old':{workspaceId:'b3-2026',classId:'old',active:true},'b3-2026_et':{workspaceId:'b3-2026',classId:'et',active:true},'b3-2026_wt':{workspaceId:'b3-2026',classId:'wt',active:true}},
 [C+'old']:{active:false,name:'Old',members:{s1:{active:true}}},
 [C+'et']:{active:true,name:'ET',members:{s1:{active:true}}},
 [C+'wt']:{active:true,name:'WT',members:{s1:{active:true}}}
};}
for(const file of ['backend/functions/student-auth.js','backend/functions-staging/student-auth.js','backend/functions/homework-staging/student-auth.js']){
 test(file+': no class named -> starts in an active class, and lists every active class',async()=>{
  const x=load(file,data(),{ok:true,id:'s1',name:'Sam',classId:'old'}),r=await x.run({action:'login',name:'Sam',pin:'1234'});
  assert.equal(r.code,undefined,JSON.stringify(r.body));
  assert.equal(r.body.classId,'et');
  assert.equal(JSON.stringify(r.body.classChoices.map(c=>c.id).sort()),'["et","wt"]');
  assert.equal(x.tokens[0].b3ClassId,'et');
 });
 test(file+': the class the core picked is kept when it is active',async()=>{
  const x=load(file,data(),{ok:true,id:'s1',name:'Sam',classId:'wt'}),r=await x.run({action:'login',name:'Sam',pin:'1234'});
  assert.equal(r.body.classId,'wt');
 });
 test(file+': a named inactive class is still refused',async()=>{
  const x=load(file,data(),{ok:true,id:'s1',name:'Sam',classId:'et'}),r=await x.run({action:'login',name:'Sam',pin:'1234',classId:'old'});
  assert.equal(r.code,403);assert.equal(x.tokens.length,0);
 });
 test(file+': a membership removed on purpose is never used',async()=>{
  const d=data();d['b3Games/students/s1/memberships']['b3-2026_et'].active=false;d['b3Games/students/s1/memberships']['b3-2026_wt'].active=false;
  const x=load(file,d,{ok:true,id:'s1',name:'Sam',classId:'old'}),r=await x.run({action:'login',name:'Sam',pin:'1234'});
  assert.equal(r.code,403);assert.equal(x.tokens.length,0);
 });
}
