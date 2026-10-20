const test=require('node:test'),assert=require('node:assert/strict');
const {entries,list}=require('../teacher-preview.js');
test('preview uses claimed teacher assignments rather than stale invite grants',()=>{
 const rows=entries({t:{role:'teacher',classIds:{a:true,b:false,'*':true}}},{invite:{email:'teacher@example.com',claimedUid:'t',classIds:{old:true}}},'owner');
 assert.equal(rows.length,1);assert.deepEqual(rows[0].classIds,['a']);assert.equal(rows[0].name,'teacher@example.com');
});
test('inactive, revoked, owner and duplicate teachers stay out of the picker',()=>{
 const rows=entries({owner:{role:'owner'},revoked:{active:false},t:{role:'teacher',classIds:{a:true}}},{one:{claimedUid:'t'},disabled:{active:false},old:{claimedUid:'revoked'},removed:{claimedUid:'missing'}},'owner');
 assert.equal(rows.length,1);assert.equal(rows[0].id,'one');
});
test('unclaimed invitations can preview their assigned classes',()=>{
 assert.deepEqual(entries({},{i:{email:'new@example.com',classIds:{new:true}}},'owner')[0].classIds,['new']);
});
test('non-owners cannot read the teacher directory',async()=>{
 let reads=0;const db={ref(){reads++;throw Error('unexpected read')}};
 for(const access of [{authorized:true,role:'teacher'},{authorized:false,role:'admin'},{}])await assert.rejects(list(db,'b3',access,'owner'),/Only the owner/);
 assert.equal(reads,0);
});
test('owner preview reads only the workspace teacher and invitation records',async()=>{
 const paths=[];const db={ref(path){paths.push(path);return {once:async()=>({val:()=>({})})}}};
 assert.deepEqual(await list(db,'b3',{authorized:true,role:'admin'},'owner'),[]);
 assert.deepEqual(paths,['b3Games/workspaces/b3/teachers','b3Games/workspaces/b3/teacherInvites']);
});

test('Chazara only skips the UID-based teacher lookup inside a verified read-only preview',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const html=fs.readFileSync('chazara/teacher.html','utf8');
 const predicate=html.match(/function needsTeacherAssignmentRefresh\(access\)\{[^\n]+\}/)?.[0];
 assert.ok(predicate,'Chazara must have an explicit owner-preview exception');
 const withGuard=vm.runInNewContext(predicate+';needsTeacherAssignmentRefresh',{window:{B3_READ_ONLY_TEACHER_PREVIEW:true}});
 const withoutGuard=vm.runInNewContext(predicate+';needsTeacherAssignmentRefresh',{window:{B3_READ_ONLY_TEACHER_PREVIEW:false}});
 assert.equal(withGuard({role:'teacher',preview:true}),false,'verified preview uses selected teacher scope');
 assert.equal(withGuard({role:'teacher',preview:false}),true,'real teacher reloads live class assignments');
 assert.equal(withoutGuard({role:'teacher',preview:true}),true,'URL/forged preview flag alone cannot bypass teacher lookup');
 assert.equal(withGuard({role:'admin',preview:false}),false,'owners use administrator scope');
 assert.equal((html.match(/if\(needsTeacherAssignmentRefresh\(access\)\)\{/g)||[]).length,2,
  'initial load and one-minute refresh must have the same policy');
});
