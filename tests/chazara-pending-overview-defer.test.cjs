const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('chazara/teacher.html','utf8');
const start=source.indexOf('function refreshScopedViews(){');
const end=source.indexOf('// In the verified owner preview',start);
assert.ok(start>=0&&end>start,'refreshScopedViews source must be present');
const fn=source.slice(start,end);

function run({full=false,uid='teacher-a',boundUid='teacher-a',D={},R={},E={}}={}){
 const calls=[];
 const context={
  fullDashboardLoaded:full,teacherScope:{boundAuthUid:boundUid},
  auth:{currentUser:{uid}},D,R,E,
  populateManualStudents:()=>calls.push('manualStudents'),
  render:()=>calls.push('overview'),
  renderManualMatches:()=>calls.push('manualMatches'),
  renderApprovals:()=>calls.push('approvals'),
  renderRecordings:()=>calls.push('recordings')
 };
 vm.runInNewContext(fn+';refreshScopedViews();',context);
 return {D:JSON.parse(JSON.stringify(context.D)),calls};
}

test('pending-only Chazara does not synthesize incomplete third-class overview from pending events',()=>{
 const original={student_c:{name:'Existing overview',goal:12,reviews:{'18_1':{count:7,lastAt:90}}}};
 const out=run({D:structuredClone(original),R:{student_c:{classId:'alpha',name:'Student C'}},
  E:{student_c:{pending1:{perek:18,posuk:1,createdAt:100,reviewApplied:true}}}});
 assert.deepEqual(out.D,original);
 assert.deepEqual(out.calls,['approvals','recordings']);
});

test('explicit full dashboard retains legacy ET/WT summaries and computes scoped third-class event counts',()=>{
 const et={name:'ET Student',goal:10,reviews:{'18_1':{count:4,lastAt:5}}};
 const wt={name:'WT Student',goal:10,reviews:{'19_2':{count:6,lastAt:7}}};
 const out=run({full:true,
  D:{student_et:structuredClone(et),student_wt:structuredClone(wt)},
  R:{student_et:{classId:'et',name:'ET Student'},student_wt:{classId:'wt',name:'WT Student'},
   student_c:{classId:'alpha',name:'Third Student'}},
  E:{student_c:{
   a:{perek:20,posuk:2,createdAt:100,reviewApplied:true},
   b:{perek:20,posuk:2,createdAt:200,reviewApplied:true},
   rejected:{perek:20,posuk:2,createdAt:300,reviewApplied:true,teacherRejected:true},
   removed:{perek:20,posuk:3,createdAt:400,reviewApplied:true,removed:true},
   incomplete:{perek:20,posuk:4,createdAt:500,reviewApplied:false}
  }}});
 assert.deepEqual(out.D.student_et,et);
 assert.deepEqual(out.D.student_wt,wt);
 assert.equal(out.D.student_c.name,'Third Student');
 assert.equal(out.D.student_c.goal,10);
 assert.deepEqual(out.D.student_c.reviews,{'20_2':{count:2,lastAt:200}});
 assert.deepEqual(out.calls,['manualStudents','overview','manualMatches','approvals','recordings']);
});

test('superseded Google identity cannot rebuild Chazara overview or approval UI',()=>{
 const original={student_c:{name:'Prior data',reviews:{'18_1':{count:3}}}};
 const out=run({uid:'teacher-b',boundUid:'teacher-a',full:true,D:structuredClone(original),
  R:{student_c:{classId:'alpha',name:'Third Student'}},
  E:{student_c:{newEvent:{perek:18,posuk:1,createdAt:50,reviewApplied:true}}}});
 assert.deepEqual(out.D,original);
 assert.deepEqual(out.calls,[]);
});
