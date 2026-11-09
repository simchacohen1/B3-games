'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {evaluate,collect,markdown}=require('../scripts/feature-health-report.cjs');
const check={file:'authenticated.spec.ts',title:'complete journey'};
const catalog={features:[{name:'Homework',routes:['homework.html'],checks:[check]}]};
const report=(status='expected',last='passed',extra={})=>({suites:[{specs:[{...check,tests:[{status,results:[{status:last}],...extra}]}]}]});
test('exact complete journey passes only with a matching result and full route mapping',()=>{
 assert.equal(evaluate(catalog,[report()],['homework.html']).complete,true);
 assert.equal(evaluate(catalog,[report()],['homework.html','new-tool.html']).complete,false);
});
test('missing results and unmapped features stay untested',()=>{
 assert.equal(evaluate(catalog,[],[]).features[0].status,'untested');
 assert.equal(evaluate({features:[{name:'Recording',checks:[]}]},[report()],[]).features[0].status,'untested');
});
test('skip, failure and retry-only success are not passes',()=>{
 for(const [status,last,want] of [['skipped','skipped','blocked'],['unexpected','failed','failed'],['flaky','passed','flaky']])
  assert.equal(evaluate(catalog,[report(status,last)],[]).features[0].status,want);
});
test('expected failure never proves a working feature',()=>{
 assert.equal(collect(report('expected','failed',{expectedStatus:'failed'})).rows[0].state,'untested');
});
test('runner errors block apparently successful checks',()=>{
 const r=report();r.errors=[{message:'worker failed'}];
 assert.equal(evaluate(catalog,[r],[]).features[0].status,'blocked');
});
test('same title in a different file cannot satisfy requirement',()=>{
 const r=report();r.suites[0].specs[0].file='other.spec.ts';
 assert.equal(evaluate(catalog,[r],[]).features[0].status,'untested');
});
test('one successful requirement cannot hide a missing or failing requirement',()=>{
 const c={features:[{name:'Full workflow',checks:[check,{file:check.file,title:'reload'}]}]};
 assert.equal(evaluate(c,[report()],[]).features[0].status,'untested');
});
test('empty inventory never reports all clear and markdown escapes markup',()=>{
 const r=evaluate({features:[]},[],[]);
 assert.equal(r.complete,false);
 const text=markdown({...r,unmappedPages:['<bad>|route.html']},{sha:'abc',tier:'auth',at:'now'});
 assert.match(text,/INCOMPLETE/); assert.doesNotMatch(text,/<bad>/);
});
