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
