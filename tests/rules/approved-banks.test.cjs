'use strict';
// This script connects only to the loopback demo emulator. The Firebase Node
// SDK does not honor NO_PROXY for its WebSocket connection.
for(const key of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'])delete process.env[key];
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-ftt-tests',database:{host:'127.0.0.1',port:19000,rules:fs.readFileSync(path.join(__dirname,'../../firebase-rules.json'),'utf8')}});
 try{
  await env.withSecurityRulesDisabled(async context=>context.database().ref('b3Games').set({admins:{'active-admin':{active:true},'revoked-admin':{active:false}},workspaces:{'b3-2026':{teachers:{'et-teacher':{active:true,classIds:{et:true}},'wt-teacher':{active:true,classIds:{wt:true}},'revoked-teacher':{active:false,classIds:{et:true}}}}}}));
  const bank={reviewed:true,updatedAt:1,items:[{question:'Who?',answerPhrases:['אברהם']},{question:'Where?',answerPhrases:['פתח האהל']}]};
  const bankPath='posukPractice/approvedQuestionBanks/b3-2026/Bereishis/18/1';
  const ref=(uid,claims={})=>env.authenticatedContext(uid,claims).database().ref(bankPath);
  await assertSucceeds(ref('et-teacher').set(bank));await assertSucceeds(ref('wt-teacher').set(bank));await assertSucceeds(ref('active-admin').set(bank));
  await assertSucceeds(ref('owner',{email:'simcha5770@gmail.com',email_verified:true}).set(bank));
  for(const uid of ['ordinary-student','revoked-teacher','revoked-admin','unknown-teacher'])await assertFails(ref(uid).set(bank));
  await assertFails(ref('unverified-owner',{email:'simcha5770@gmail.com',email_verified:false}).set(bank));
  await assertFails(env.unauthenticatedContext().database().ref(bankPath).set(bank));
  await assertSucceeds(env.unauthenticatedContext().database().ref(bankPath).once('value'));
  for(const items of [bank.items.slice(0,1),[...bank.items,bank.items[0]],[{question:'',answerPhrases:['אברהם']},bank.items[1]]])await assertFails(ref('et-teacher').set({...bank,items}));
  await assertFails(ref('et-teacher').set({...bank,reviewed:false}));await assertFails(ref('et-teacher').remove());
  await assertFails(env.authenticatedContext('et-teacher').database().ref('posukPractice/approvedQuestionBanks/other-workspace/Bereishis/18/1').set(bank));
  const saved=(await ref('et-teacher').once('value')).val();assert.equal(saved.items.length,2);assert.equal(saved.reviewed,true);
  console.log('PASS: real Firebase rules emulator — ET/WT/admin/owner writes; student/revoked/wrong-workspace/malformed/delete denial; public nonsensitive bank read.');
 }finally{await env.cleanup()}
})().catch(error=>{console.error(error);process.exitCode=1});
