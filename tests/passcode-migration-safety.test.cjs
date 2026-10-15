'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {manageStudents}=require('../backend/functions/student-management-core.cjs');

const owner={uid:'owner',email:'simcha5770@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
const teacher={uid:'other',email:'teacher@example.org',email_verified:true,firebase:{sign_in_provider:'google.com'}};
function store(seed){
 const tree=structuredClone(seed),writes=[];
 const bits=p=>String(p).split('/').filter(Boolean);
 const get=async p=>bits(p).reduce((node,key)=>node?.[key],tree)??null;
 const update=async changes=>{
  writes.push(structuredClone(changes));
  for(const [path,value] of Object.entries(changes)){
   const b=bits(path),last=b.pop();let curr=tree;
   for(const k of b)curr=curr[k]??={};
   if(value===null)delete curr[last];
   else curr[last]=structuredClone(value);
  }
 };
 return {tree,writes,get,update};
}
const fixture=()=>store({
 b3Games:{
  students:{alpha:{profile:{name:'Alpha',passcode:'1111',active:true}}},
  workspaces:{'b3-2026':{classes:{et:{members:{alpha:{name:'Alpha',passcode:'1111'}}}}}}
 },
 posukPractice:{allowedStudents:{alpha:{name:'Alpha',passcode:'1111'}}}
});
const migrate=(s,options={})=>manageStudents(s,owner,{action:'migratePasscodes',migrationProtocol:'passcodes-v2-preview-20261015',backupConfirmed:true,...options},1000);

test('dry-run lists only counts, never credentials, and performs no writes',async()=>{
 const s=fixture(),before=structuredClone(s.tree);
 const r=await migrate(s,{deletePublic:true,dryRun:true});
 assert.equal(r.dryRun,true);
 assert.equal(r.copied,1);
 assert.equal(r.cleared,3);
 assert.deepEqual(r.conflicts,[]);
 assert.deepEqual(r.unmatched,[]);
 assert.deepEqual(s.tree,before);
 assert.deepEqual(s.writes,[]);
 assert.equal(JSON.stringify(r).includes('1111'),false);
});
test('copy and cleanup preserves the private credential and clears all three exposed copies',async()=>{
 const s=fixture();
 await migrate(s,{deletePublic:true});
 assert.equal(s.tree.b3Private.passcodes.alpha.passcode,'1111');
 assert.equal(s.tree.b3Games.students.alpha.profile.passcode,undefined);
 assert.equal(s.tree.b3Games.workspaces['b3-2026'].classes.et.members.alpha.passcode,undefined);
 assert.equal(s.tree.posukPractice.allowedStudents.alpha.passcode,undefined);
 assert.equal(s.writes.length,1);
});
test('already-private PIN stays authoritative even when exposed legacy PIN differs',async()=>{
 const s=fixture();s.tree.b3Private={passcodes:{alpha:{passcode:'9999',chosenPinVersion:1}}};
 await migrate(s,{deletePublic:true});
 assert.equal(s.tree.b3Private.passcodes.alpha.passcode,'9999');
 assert.equal(s.tree.b3Private.passcodes.alpha.chosenPinVersion,1);
 assert.equal(s.tree.posukPractice.allowedStudents.alpha.passcode,undefined);
});
test('conflicting public passcodes block destructive cleanup without modifying anything',async()=>{
 const s=fixture();s.tree.posukPractice.allowedStudents.alpha.passcode='2222';
 const r=await migrate(s,{deletePublic:true,dryRun:true});
 assert.deepEqual(r.conflicts,['alpha']);
 await assert.rejects(migrate(s,{deletePublic:true}),{code:409});
 assert.equal(s.writes.length,0);
 assert.equal(s.tree.b3Games.students.alpha.profile.passcode,'1111');
});
test('class-only passcodes are included in private-only copy, but unsafe deletion is blocked',async()=>{
 const s=store({b3Games:{workspaces:{'b3-2026':{classes:{newClass:{members:{orphan:{name:'Orphan',passcode:'4321'}}}}}}}});
 const r=await migrate(s,{deletePublic:true,dryRun:true});
 assert.equal(r.copied,1);
 assert.deepEqual(r.unmatched,['orphan']);
 await assert.rejects(migrate(s,{deletePublic:true}),{code:409});
 assert.equal(s.writes.length,0);
 await migrate(s,{deletePublic:false});
 assert.equal(s.tree.b3Private.passcodes.orphan.passcode,'4321');
 assert.equal(s.tree.b3Games.workspaces['b3-2026'].classes.newClass.members.orphan.passcode,'4321');
});
test('class-only identity becomes safe for cleanup after a central profile is linked',async()=>{
 const s=store({b3Games:{students:{orphan:{profile:{name:'Orphan',active:true}}},workspaces:{'b3-2026':{classes:{newClass:{members:{orphan:{name:'Orphan',passcode:'4321'}}}}}}}});
 await migrate(s,{deletePublic:true});
 assert.equal(s.tree.b3Private.passcodes.orphan.passcode,'4321');
 assert.equal(s.tree.b3Games.workspaces['b3-2026'].classes.newClass.members.orphan.passcode,undefined);
});
test('an unrelated teacher cannot preview or run the owner migration',async()=>{
 const s=fixture();
 for(const dryRun of [true,false])await assert.rejects(manageStudents(s,teacher,{action:'migratePasscodes',deletePublic:true,dryRun}),{code:403});
 assert.equal(s.writes.length,0);
});

test('the dedicated preview endpoint reads without deleting and returns protocol marker',async()=>{
 const s=fixture(),before=structuredClone(s.tree);
 const result=await manageStudents(s,owner,{action:'previewPasscodeMigration'},1000);
 assert.equal(result.ok,true);
 assert.equal(result.dryRun,true);
 assert.equal(result.protocol,'passcodes-v2-preview-20261015');
 assert.equal(result.cleared,3);
 assert.deepEqual(s.tree,before);
 assert.deepEqual(s.writes,[]);
});
test('legacy preview parameters on destructive action are blocked without confirmed v2 protocol',async()=>{
 const s=fixture();
 await assert.rejects(manageStudents(s,owner,{action:'migratePasscodes',deletePublic:true,dryRun:true},1000),{code:409});
 await assert.rejects(manageStudents(s,owner,{action:'migratePasscodes',deletePublic:true,backupConfirmed:true},1000),{code:409});
 await assert.rejects(manageStudents(s,owner,{action:'migratePasscodes',deletePublic:true,migrationProtocol:'passcodes-v2-preview-20261015'},1000),{code:409});
 assert.equal(s.writes.length,0);
});
test('non-owner cannot call the new read-only preview endpoint',async()=>{
 const s=fixture();
 await assert.rejects(manageStudents(s,teacher,{action:'previewPasscodeMigration'},1000),{code:403});
 assert.equal(s.writes.length,0);
});
test('owner UI cannot run legacy destructive migration before verifying new preview protocol',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const page=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const start=page.indexOf('el("securePasscodesButton").addEventListener');
 const end=page.indexOf('el("addStudentToClassButton").addEventListener',start);
 assert.ok(start>=0&&end>start);
 const handler=page.slice(start,end);
 assert.ok(handler.includes('trustedStudentAction("previewPasscodeMigration",{})'));
 assert.ok(handler.includes('preview.dryRun!==true || preview.protocol!==protocol'));
 assert.ok(handler.indexOf('previewPasscodeMigration')<handler.indexOf('trustedStudentAction("migratePasscodes"'));
 assert.ok(handler.includes('backupConfirmed:true'));
});
