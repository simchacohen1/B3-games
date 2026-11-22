const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const file of ['backend/functions/student-rewards-auto-award.js','backend/functions-staging/student-rewards-auto-award.js']){
 const src=fs.readFileSync(file,'utf8');
 const code=src.slice(src.indexOf('function entries('),src.indexOf('function safeKey'))+src.slice(src.indexOf('function understandCoversPosuk'),src.indexOf('async function verifyShorashim'));
 function run(attempts,evidence,award){
  const ctx={rtdb:{ref:()=>({get:async()=>({exists:()=>true,val:()=>attempts})})},Number,String,Object,Array,Math,Date,RegExp,Number};
  vm.createContext(ctx);vm.runInContext(code,ctx);return ctx.verifyMilestone('s','understand100',award,evidence);
 }
 const q=(n,v='correct')=>({posukNum:n,verdict:v});
 const range={a1:{questionTotal:3,questionResults:{0:q(1),1:q(1),2:q(3)}}};
 test(file+': a posuk in a range with no question is not paid',async()=>{
  assert.equal((await run(range,'chumash_1_1-3','chumash_1_1')).ok,true);
  assert.equal((await run(range,'chumash_1_1-3','chumash_1_3')).ok,true);
  const r=await run(range,'chumash_1_1-3','chumash_1_2');assert.equal(r.ok,false);assert.match(r.error,/No question/);
 });
 test(file+': a posuk with a wrong answer is not paid, even when another posuk was right',async()=>{
  const a={a1:{questionTotal:2,questionResults:{0:q(1),1:q(2,'wrong')}}};
  assert.equal((await run(a,'chumash_1_1-2','chumash_1_1')).ok,false); // overall below 100
  const b={a1:{questionTotal:2,questionResults:{0:q(1),1:{posukNum:2,verdict:'wrong',finalVerdict:'correct'}}}};
  assert.equal((await run(b,'chumash_1_1-2','chumash_1_2')).ok,true); // teacher-overruled answer counts
 });
 test(file+': an old single-posuk save without per-question rows still works, but never pays a range',async()=>{
  const old={a1:{comprehensionScore:100}};
  assert.equal((await run(old,'chumash_1_4','chumash_1_4')).ok,true);
  assert.equal((await run(old,'chumash_1_4-6','chumash_1_5')).ok,false);
 });
}
