const test=require('node:test');
const assert=require('node:assert/strict');
const {makeService}=require('./message-service');
const thread={workspaceId:'b3-2026',classId:'classA',studentId:'student1'};
const data={
'b3Games/workspaces/b3-2026/classes/classA':{active:true,members:{student1:{active:true}}},
'b3Games/students/student1/memberships/classA':{active:true,workspaceId:'b3-2026',classId:'classA'},
'b3Games/students/student1/profile':{active:true},
'b3Games/workspaces/b3-2026/teachers/teacher1':{active:true,classIds:{classA:true}}
};
function setup(){const writes=[];const service=makeService({read:async path=>data[path]||null,write:async(path,value)=>{writes.push({path,value});},allocateId:()=> 'message1',now:()=>1700000000000});return {service,writes};}
test('authorized teacher sends text, with server generated author and timestamp',async()=>{const {service,writes}=setup();const result=await service.sendText({id:'teacher1',role:'teacher',authenticated:true},thread,' Hello ');assert.equal(result.text,'Hello');assert.equal(result.senderId,'teacher1');assert.equal(writes.length,1);assert.equal(writes[0].path,'assignmentCenter/workspaces/b3-2026/classes/classA/threads/student1/messages/message1');});
test('student can send only into own thread',async()=>{const {service,writes}=setup();await service.sendText({id:'student1',role:'student',authenticated:true},thread,'Hello');await assert.rejects(service.sendText({id:'student2',role:'student',authenticated:true},thread,'Hello'),/Unauthorized/);assert.equal(writes.length,1);});
test('unassigned teacher cannot read or send',async()=>{const {service,writes}=setup();await assert.rejects(service.list({id:'teacher2',role:'teacher',authenticated:true},thread),/Unauthorized/);await assert.rejects(service.sendText({id:'teacher2',role:'teacher',authenticated:true},thread,'Hi'),/Unauthorized/);assert.equal(writes.length,0);});
test('unauthenticated reads and invalid text denied',async()=>{const {service,writes}=setup();await assert.rejects(service.list({id:'student1',role:'student',authenticated:false},thread),/Unauthorized/);await assert.rejects(service.sendText({id:'teacher1',role:'teacher',authenticated:true},thread,'    '),/Invalid message/);assert.equal(writes.length,0);});
