'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const app=fs.readFileSync('shorashim/app.js','utf8');
const html=fs.readFileSync('shorashim/index.html','utf8');
// app.js is cache-busted on every release; require a build label dated on or after this feature.
const appBuildDate=()=>{const m=html.match(/<script src="app\.js\?v=(\d{8})[^"]*"><\/script>/);assert.ok(m,'app.js is loaded with a dated cache-bust label');return Number(m[1]);};
const fn=name=>{const line=app.split(/\r?\n/).find(x=>x.startsWith('function '+name+'('));assert.ok(line,name+' exists');return line;};

test('unlearned later roots and affixes are selectable without prior cards',()=>{
  const catalog={shorashim:[{id:'first',front:'ראשון'},{id:'later',front:'אחרון'},{id:'hidden',hidden:true}],prefix:[{id:'p1'},{id:'p2'}]};
  const s={cards:{}};
  const ctx=vm.createContext({currentTrack:'shorashim',student:()=>s,splitKey:k=>k.split(':'),getItem:k=>{const [t,id]=k.split(':');return catalog[t]?.find(x=>x.id===id)},isStudentAvailable:x=>!!x&&!x.hidden,document:{getElementById(){return null;}}});
  vm.runInContext(fn('canEditItem'),ctx);
  assert.equal(ctx.canEditItem('shorashim:later'),true);
  assert.equal(ctx.canEditItem('shorashim:first'),true);
  assert.equal(ctx.canEditItem('shorashim:hidden'),false);
  assert.equal(ctx.canEditItem('prefix:p2'),false);
  ctx.currentTrack='prefix';
  assert.equal(ctx.canEditItem('prefix:p2'),true);
  assert.equal(ctx.canEditItem('shorashim:later'),false);
});

test('word list does not label or disable future available words',()=>{
  const items=[{id:'first',front:'א',english:'first'},{id:'later',front:'ב',english:'later'}], nodes={};
  const document={getElementById(id){return nodes[id]||=({innerHTML:'',textContent:'',children:[],appendChild(el){this.children.push(el)}})},createElement(){return {}}};
  const s={cards:{}};
  const ctx=vm.createContext({currentTrack:'shorashim',student:()=>s,learningCatalog:()=>items,keyFor:(t,id)=>t+':'+id,document,selectedItemKey:null,escapeHTML:x=>x,reviewFilterLabel:()=>'Perek',loadEditorItem:()=>{}});
  vm.runInContext(fn('renderWordList'),ctx);
  ctx.renderWordList();
  assert.equal(nodes.wordList.children.length,2);
  for(const btn of nodes.wordList.children){assert.notEqual(btn.disabled,true);assert.match(btn.innerHTML,/Choose • Learn/);assert.doesNotMatch(btn.className,/locked/);}
  assert.match(html,/Choose any word in any order/);
  assert.doesNotMatch(html,/New items unlock strictly in order/);
  assert.ok(appBuildDate()>=20261019,'app.js cache-bust label must be on or after the perek-choice release');
});

test('Perek 18 and 19 learning lists stay separate without ordering locks',()=>{
  const items=[
    {id:'18-first',perek:18},{id:'18-second',perek:18},
    {id:'19-first',perek:19},{id:'19-second',perek:19},
    {id:'19-hidden',perek:19,hidden:true}
  ],s={cards:{}};
  const ctx=vm.createContext({currentTrack:'shorashim',learningPerek:18,
    visibleCatalog:()=>items.filter(x=>!x.hidden),itemPerek:x=>Number(x.perek),
    student:()=>s,keyFor:(t,id)=>t+':'+id});
  vm.runInContext(fn('learningCatalog'),ctx);
  vm.runInContext(fn('nextLearningUncreated'),ctx);
  assert.deepEqual(Array.from(ctx.learningCatalog().map(x=>x.id)),['18-first','18-second']);
  assert.equal(ctx.nextLearningUncreated().id,'18-first');
  ctx.learningPerek=19;
  assert.deepEqual(Array.from(ctx.learningCatalog().map(x=>x.id)),['19-first','19-second']);
  assert.equal(ctx.nextLearningUncreated().id,'19-first');
  s.cards['shorashim:19-first']={learnedAt:Date.now()};
  assert.equal(ctx.nextLearningUncreated().id,'19-second');
  assert.equal(ctx.learningCatalog('prefix').length,4); // non-Shorashim tracks are not filtered
});

test('choosing a perek updates the menu without leaving Shorashim',()=>{
  const screens=[],ctx=vm.createContext({currentTrack:'prefix',learningPerek:18,selectedItemKey:'prefix:p',followAllowsScreen:()=>true,goScreen:x=>screens.push(x)}); // no Follow Teacher restriction active
  vm.runInContext(fn('chooseLearningPerek'),ctx);
  ctx.chooseLearningPerek('19');
  assert.equal(ctx.currentTrack,'shorashim');
  assert.equal(ctx.learningPerek,19);
  assert.equal(ctx.selectedItemKey,null);
  assert.deepEqual(screens,['learnScreen']);
  ctx.chooseLearningPerek('18');
  assert.equal(ctx.learningPerek,18);
  assert.deepEqual(screens,['learnScreen','learnScreen']);
  ctx.chooseLearningPerek('22');
  assert.deepEqual(screens,['learnScreen','learnScreen']);
  assert.match(html,/data-go="shorashimPerekScreen" data-track="shorashim"/);
  assert.match(html,/data-learning-perek="18"/);
  assert.match(html,/data-learning-perek="19"/);
  assert.match(html,/changeLearningPerekBtn/);
});
