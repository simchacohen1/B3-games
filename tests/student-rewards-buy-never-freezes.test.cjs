'use strict';
// A student's Buy / Cancel must never leave the page frozen: network calls time out,
// and the buttons are freed before the list refresh runs.
const test=require('node:test'),assert=require('node:assert'),fs=require('fs');
const src=fs.readFileSync(__dirname+'/../student-rewards/student.js','utf8');
const fn=name=>{const i=src.indexOf('async function '+name+'(');assert.ok(i>=0);const j=src.indexOf('\n}',i);return src.slice(i,j)};
for(const name of ['redeem','cancelRequest'])test(name+' times out and frees the buttons before refreshing',()=>{
  const body=fn(name);
  assert.match(body,/AbortSignal\.timeout\(/,'fetch has a timeout');
  assert.match(body,/withTimeout\(user\.getIdToken\(\)/,'token fetch has a timeout');
  assert.doesNotMatch(body,/await load\(\)/,'refresh must not hold the busy flag');
  assert.match(body,/state\.busy=false;\s*load\(\)/);
});
test('student.html loads the fixed script',()=>assert.match(fs.readFileSync(__dirname+'/../student-rewards/student.html','utf8'),/student\.js\?g=1&v=20261126-buy-timeout/));
