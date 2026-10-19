const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('./message-policy.js');
const thread={workspaceId:'b3-2026',classId:'classA',studentId:'student1'};
const context={workspaceId:'b3-2026',classId:'classA',classActive:true,studentActive:true,membershipActive:true,studentVerifiedId:'student1',teacherVerifiedId:'teacher1',teacherAuthorized:true,teacherAssignedToClass:true};
function permitted(actor,overrides={}){return policy.authorize({thread,actor,context:{...context,...overrides}}).allowed;}
test('student can access only own thread',()=>{
assert.equal(permitted({id:'student1',authenticated:true,role:'student'}),true);
assert.equal(permitted({id:'student2',authenticated:true,role:'student'}),false);
assert.equal(permitted({id:'student1',authenticated:false,role:'student'}),false);
});
test('teacher must be assigned to this class, verified, and authorized',()=>{
const actor={id:'teacher1',authenticated:true,role:'teacher'};
assert.equal(permitted(actor),true);
assert.equal(permitted(actor,{teacherAssignedToClass:false}),false);
assert.equal(permitted(actor,{teacherAuthorized:false}),false);
assert.equal(permitted(actor,{teacherVerifiedId:'teacher2'}),false);
assert.equal(permitted({...actor,id:'teacher2'}),false);
});
test('inactive student, class, or membership are denied',()=>{
const actor={id:'teacher1',authenticated:true,role:'teacher'};
for(const field of ['studentActive','classActive','membershipActive'])assert.equal(permitted(actor,{[field]:false}),false);
});
test('workspace and class boundaries are checked',()=>{
const actor={id:'teacher1',authenticated:true,role:'teacher'};
assert.equal(permitted(actor,{classId:'classB'}),false);
assert.equal(permitted(actor,{workspaceId:'different'}),false);
});
test('untrusted or invalid inputs deny by default',()=>{
assert.equal(policy.authorize({}).allowed,false);
assert.throws(()=>policy.threadPath({...thread,studentId:'../x'}));
assert.equal(policy.validateText('Hi!'),true);
assert.equal(policy.validateText('   '),false);
assert.equal(policy.validateText('x'.repeat(2001)),false);
});
