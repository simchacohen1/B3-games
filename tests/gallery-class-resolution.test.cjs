const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function resolve(rows){
 const ctx={window:{},localStorage:{getItem:()=> 'et'}};
 vm.runInNewContext(fs.readFileSync('student-class.js','utf8'),ctx);
 return ctx.window.FunTorahStudentClass.resolve({ref:path=>({once:async()=>({val:()=>rows[path]||null})})},'child');
}
const membership='b3Games/students/child/memberships',roster='posukPractice/allowedStudents/child',klass='b3Games/workspaces/b3-2026/classes/et';
test('legacy active ET roster and active class membership resolve',async()=>{
 const info=await resolve({[roster]:{classId:'et'},[klass]:{members:{child:{active:true}}}});assert.equal(info.classId,'et');
});
test('inactive modern membership cannot fall back to legacy roster',async()=>{
 const info=await resolve({[membership]:{a:{workspaceId:'b3-2026',classId:'et',active:false}},[roster]:{classId:'et'},[klass]:{members:{child:{active:true}}}});assert.equal(info.classId,'');
});
test('legacy roster alone does not grant membership',async()=>{
 const info=await resolve({[roster]:{classId:'et'},[klass]:{members:{}}});assert.equal(info.classId,'');
});
test('modern WT membership resolves without legacy fallback',async()=>{
 const info=await resolve({[membership]:{a:{workspaceId:'b3-2026',classId:'wt',active:true}}});assert.equal(info.classId,'wt');
});
