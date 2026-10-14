const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function app(login,{status=200,profile={active:true}}={}){
 const html=fs.readFileSync('record_pesukim/student.html','utf8'),a=html.indexOf('async function studentRecord('),b=html.indexOf("if(document.getElementById('startBtn'))",a),calls=[];
 assert.ok(a>=0&&b>a,'Extract only sign-in functions, not UI initialization');
 const ctx={firebaseConfig:{databaseURL:'https://example.test'},AbortController,AbortSignal,setTimeout,clearTimeout,fetch:async(url,options)=>{
  calls.push({url,...options});return options.method==='POST'?{ok:status===200,json:async()=>login}:{ok:true,json:async()=>profile};
 }};
 vm.runInNewContext(html.slice(a,b)+';this.check=checkAccess;',ctx);return {check:ctx.check,calls};
}
test('Posuk uses the canonical server-verified ID and profile access version',async()=>{
 const f=app({ok:true,id:'student_123'},{profile:{active:true,passcodeUpdatedAt:10}}),r=await f.check('Moshe','test-only-pin','student_123');
 assert.equal(r.ok,true);assert.equal(r.slug,'student_123');assert.equal(r.accessVersion,10);
 assert.deepEqual(JSON.parse(f.calls[0].body),{action:'login',name:'Moshe',pin:'test-only-pin'});
 assert.ok(f.calls[1].url.endsWith('/b3Games/students/student_123/profile.json'));
});
test('direct Posuk login accepts a canonical ID without reading the student directory',async()=>{
 const f=app({ok:true,id:'student_123'});assert.equal((await f.check('Moshe','test-only-pin')).slug,'student_123');
 assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>!c.url.endsWith('/b3Games/students.json')));
});
test('a server-rejected old passcode cannot restore Posuk access',async()=>{
 const f=app({error:'Passcode changed.'},{status:401});assert.equal((await f.check('Moshe','old-test-pin','student_123')).ok,false);assert.equal(f.calls.length,1);
});
test('ambiguous names rejected by the server never load a student profile',async()=>{
 const f=app({error:'Choose your full name.'},{status:409});assert.equal((await f.check('Moshe','test-only-pin')).ok,false);assert.equal(f.calls.length,1);
});
test('a different canonical ID or blocked profile cannot replace the saved account',async()=>{
 const f=app({ok:true,id:'another_student'});assert.equal((await f.check('Moshe','test-only-pin','student_123')).ok,false);assert.equal(f.calls.length,1);
 assert.equal((await app({ok:true,id:'student_123'},{profile:{active:false}}).check('Moshe','test-only-pin')).ok,false);
});
