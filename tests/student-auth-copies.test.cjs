// Issue #421: the staging sign-in functions are separate copies of the live one.
// Rerun the full student sign-in test file against each copy so they cannot drift.
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
for(const copy of ['backend/functions-staging/student-auth-core.cjs','backend/functions/homework-staging/student-auth-core.cjs']){
 test('student sign-in tests pass for '+copy,()=>{
  const r=spawnSync(process.execPath,['--test',path.join(__dirname,'student-auth.test.cjs')],{env:{...process.env,STUDENT_AUTH_CORE:path.resolve(__dirname,'..',copy)},encoding:'utf8'});
  assert.equal(r.status,0,r.stdout.slice(-3000)+r.stderr.slice(-2000));
 });
}
