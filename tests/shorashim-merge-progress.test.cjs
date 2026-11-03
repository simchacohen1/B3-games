'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mergeStudentCards}=require('../shorashim/merge-progress.js');

test('duplicate merge moves the old card while preserving concurrent unrelated progress',()=>{
  const current={name:'Synthetic',cards:{'shorashim:old':{learnedAt:20,createdAt:10,reviewCount:4,design:{drawing:'old-drawing'}},'shorashim:keeper':{learnedAt:30,design:{backgroundColor:'#fff'}},'shorashim:new-progress':{learnedAt:50,reviewCount:9}},settings:{font:'large'}};
  const result=mergeStudentCards(current,'shorashim:old','shorashim:keeper','keeper');
  assert.equal(result.cards['shorashim:old'],undefined);
  assert.equal(result.cards['shorashim:keeper'].learnedAt,20);
  assert.equal(result.cards['shorashim:keeper'].reviewCount,4);
  assert.equal(result.cards['shorashim:keeper'].createdAt,10);
  assert.deepEqual(result.cards['shorashim:keeper'].design,{drawing:'old-drawing',backgroundColor:'#fff'});
  assert.deepEqual(result.cards['shorashim:new-progress'],{learnedAt:50,reviewCount:9});
  assert.deepEqual(result.settings,{font:'large'});
});

test('duplicate merge creates keeper history when none exists and safely skips missing old cards',()=>{
  const moved=mergeStudentCards({cards:{'shorashim:old':{learnedAt:12,score:8}}},'shorashim:old','shorashim:keeper','keeper');
  assert.deepEqual(moved.cards['shorashim:keeper'],{learnedAt:12,score:8,itemKey:'shorashim:keeper',itemId:'keeper'});
  assert.equal(mergeStudentCards({cards:{'shorashim:keeper':{learnedAt:5}}},'shorashim:old','shorashim:keeper','keeper'),undefined);
});
