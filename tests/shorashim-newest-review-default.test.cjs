'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const app=fs.readFileSync('shorashim/app.js','utf8');
const categories=fs.readFileSync('shorashim/review-categories.js','utf8');
const html=fs.readFileSync('shorashim/index.html','utf8');
const sample=[
  {itemKey:'shorashim:old',itemType:'shorashim',learnedAt:100,reviewOrder:2},
  {itemKey:'shorashim:new',itemType:'shorashim',learnedAt:300,reviewOrder:1},
  {itemKey:'shorashim:middle',itemType:'shorashim',learnedAt:200,reviewOrder:3}
];
const items={old:{front:'ב'},new:{front:'א'},middle:{front:'ג'}};
const createContext=mode=>vm.createContext({
  document:{getElementById:id=>id==='reviewSort'?{value:mode}:null},
  eligibleLearnedCards:()=>sample,
  getItem:key=>items[key.split(':')[1]],
  reviewPerekFilter:'all'
});
function runBase(mode){
  const line=app.split(/\r?\n/).find(x=>x.startsWith('function reviewSortedCards()'));
  assert.ok(line,'base review sort function exists');
  const context=createContext(mode);
  vm.runInContext(line,context);
  return Array.from(context.reviewSortedCards(),c=>c.itemKey);
}
function runCategory(mode){
  const match=categories.match(/^  reviewSortedCards = function categoryAwareReviewSortedCards\(\) \{[\s\S]*?^  \};/m);
  assert.ok(match,'category-aware review sort exists');
  const context=createContext(mode);
  context.cardsForReviewTrack=()=>sample;
  vm.runInContext(match[0],context);
  return Array.from(context.reviewSortedCards(),c=>c.itemKey);
}
const names=a=>a.map(x=>x.split(':')[1]);

test('review defaults to newest learned first',()=>{
  assert.match(html,/<option value="newest" selected>Newest learned first<\/option>/);
  assert.ok(html.indexOf('<option value="newest"')<html.indexOf('<option value="learned"'));
  assert.deepEqual(names(runBase('newest')),['new','middle','old']);
  assert.deepEqual(names(runCategory('newest')),['new','middle','old']);
  assert.deepEqual(names(runBase(undefined)),['new','middle','old']);
  assert.deepEqual(names(runCategory(undefined)),['new','middle','old']);
});

test('oldest, alphabetical, and custom choices remain available',()=>{
  assert.deepEqual(names(runBase('learned')),['old','middle','new']);
  assert.deepEqual(names(runCategory('learned')),['old','middle','new']);
  assert.deepEqual(names(runBase('alpha')),['new','old','middle']);
  assert.deepEqual(names(runCategory('alpha')),['new','old','middle']);
  assert.deepEqual(names(runBase('manual')),['new','old','middle']);
  assert.deepEqual(names(runCategory('manual')),['new','old','middle']);
});

test('review remains in selected-card order unless Shuffle is chosen',()=>{
  assert.match(categories,/const keys = \[\.\.\.document\.querySelectorAll\('\.review-pick-check:checked'\)\]/);
  assert.match(categories,/let arr = keys\.map\(k => map\.get\(k\)\)\.filter\(Boolean\)/);
  assert.match(categories,/value === 'shuffle'/);
  assert.match(html,/<input type="radio" name="reviewOrderMode" value="order" checked>/);
  assert.match(html,/review-categories\.js\?v=20261019-newest-review/);
  assert.match(html,/app\.js\?v=20261020-follow-pointer1/);
});
