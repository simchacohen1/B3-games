'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const C=require('../shorashim/review-cycle-core.js');

const mk=n=>{const cards={},keys=[];for(let i=1;i<=n;i++){const k='shorashim:w'+i;keys.push(k);cards[k]={itemKey:k,itemType:'shorashim',learnedAt:i};}return {s:{cards},keys};};

test('batch takes the next words not yet reviewed in this cycle',()=>{
  const {s,keys}=mk(25);
  assert.equal(C.summary(s,'shorashim',keys).left,25);
  const b1=C.pickBatch(s,'shorashim',keys,10);
  assert.deepEqual(b1,keys.slice(0,10));
  b1.forEach(k=>C.markReviewed(s,'shorashim',k,keys,1000));
  assert.equal(C.summary(s,'shorashim',keys).left,15);
  assert.deepEqual(C.pickBatch(s,'shorashim',keys,10),keys.slice(10,20));
  assert.equal(C.pickBatch(s,'shorashim',keys,'all').length,15);
});

test('the place is kept in the student record (survives a save and reload)',()=>{
  const {s,keys}=mk(12);
  C.pickBatch(s,'shorashim',keys,5).forEach(k=>C.markReviewed(s,'shorashim',k,keys,1));
  const reloaded=JSON.parse(JSON.stringify(s));
  assert.equal(C.summary(reloaded,'shorashim',keys).left,7);
  assert.deepEqual(C.pickBatch(reloaded,'shorashim',keys,3),keys.slice(5,8));
});

test('finishing the last word completes the cycle and starts a new one',()=>{
  const {s,keys}=mk(3);
  const r=keys.map(k=>C.markReviewed(s,'shorashim',k,keys,5));
  assert.equal(r[0].completed,false);assert.equal(r[2].completed,true);
  const sum=C.summary(s,'shorashim',keys);
  assert.equal(sum.cycle,2);assert.equal(sum.left,3);
  assert.equal(C.pickBatch(s,'shorashim',keys,10).length,3);
});

test('review counts go up for each review, across cycles',()=>{
  const {s,keys}=mk(2);
  keys.forEach(k=>C.markReviewed(s,'shorashim',k,keys,1));
  C.markReviewed(s,'shorashim',keys[0],keys,2);
  assert.equal(C.reviewCountOf(s.cards[keys[0]]),2);
  assert.equal(C.reviewCountOf(s.cards[keys[1]]),1);
  assert.equal(C.reviewCountOf({}),0);
  assert.equal(C.countLabel(1),'1 time');assert.equal(C.countLabel(3),'3 times');
});

test('words learned later join the current cycle; tracks are separate',()=>{
  const {s,keys}=mk(2);
  C.markReviewed(s,'shorashim',keys[0],keys,1);
  const more=keys.concat('shorashim:w3');
  assert.equal(C.summary(s,'shorashim',more).left,2);
  assert.equal(C.summary(s,'prefix',['prefix:p1']).left,1);
  assert.equal(C.summary(s,'prefix',['prefix:p1']).cycle,1);
});

test('peek never changes the record (teacher page)',()=>{
  const s={cards:{}};
  const p=C.peek(s,'shorashim',['shorashim:a']);
  assert.deepEqual(p,{cycle:1,total:1,left:1,reviewed:0});
  assert.equal(s.reviewCycles,undefined);
});

test('page wiring: count choices, left text, batch end, teacher page, no points code touched',()=>{
  const html=fs.readFileSync('shorashim/index.html','utf8');
  ['10','20','50','100','all'].forEach(n=>assert.ok(html.includes(`data-count="${n}"`),n));
  ['cycleLeftLine','reviewCycleLeft','homeCycleLeft','reviewBatchDone'].forEach(id=>assert.ok(html.includes(`id="${id}"`),id));
  assert.ok(html.indexOf('review-cycle-core.js')<html.indexOf('app.js?v='));
  assert.ok(html.indexOf('review-cycles.js')>html.indexOf('review-categories.js'));
  const page=fs.readFileSync('shorashim/review-cycles.js','utf8');
  assert.ok(page.includes('Cycle complete!'));
  assert.ok(!/points|storagePath|audioURL|MediaRecorder/.test(page.replace(/shorashimRecorder/g,'')));
  const teacher=fs.readFileSync('shorashim/teacher.js','utf8');
  assert.ok(teacher.includes('reviewCountText')&&teacher.includes('cycleStats'));
  assert.ok(fs.readFileSync('shorashim/teacher.html','utf8').includes('review-cycle-core.js'));
});
