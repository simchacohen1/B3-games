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

const Units=require('../shorashim/units.js');
const unitCtx=(items,extra={})=>{
  const s={cards:{}};
  const ctx=vm.createContext({window:{B3ShorashimUnits:Units},currentTrack:'shorashim',learningPerek:null,db:{settings:{}},
    visibleCatalog:()=>items.filter(x=>!x.hidden),student:()=>s,keyFor:(t,id)=>t+':'+id,...extra});
  ['unitKeyOf','unitLabels','studentUnits','currentLearningUnit','learningCatalog','nextLearningUncreated'].forEach(n=>vm.runInContext(fn(n),ctx));
  return {ctx,s};
};

test('every perek is its own learning list, with no ordering locks and no hardcoded perakim',()=>{
  const items=[
    {id:'18-first',perek:18},{id:'18-second',perek:18},
    {id:'19-first',perek:19},{id:'19-second',perek:19},
    {id:'19-hidden',perek:19,hidden:true},
    {id:'20-first',perek:20},{id:'7-first',perek:'7'}
  ];
  const {ctx,s}=unitCtx(items);
  // With no choice yet, the first perek in number order is used (Perek 7 here).
  assert.deepEqual(Array.from(ctx.learningCatalog().map(x=>x.id)),['7-first']);
  ctx.learningPerek='perek:18';
  assert.deepEqual(Array.from(ctx.learningCatalog().map(x=>x.id)),['18-first','18-second']);
  assert.equal(ctx.nextLearningUncreated().id,'18-first');
  ctx.learningPerek='perek:19';
  assert.deepEqual(Array.from(ctx.learningCatalog().map(x=>x.id)),['19-first','19-second']);
  s.cards['shorashim:19-first']={learnedAt:Date.now()};
  assert.equal(ctx.nextLearningUncreated().id,'19-second');
  ctx.learningPerek='perek:20';
  assert.deepEqual(Array.from(ctx.learningCatalog().map(x=>x.id)),['20-first'],'Perek 20 words are shown, not dropped or relabelled as 18');
  assert.equal(ctx.learningCatalog('prefix').length,6); // non-Shorashim tracks are not filtered
});

test('words without a perek are grouped by their list/category and teacher labels are used',()=>{
  const items=[{id:'a',listName:'Animals'},{id:'b',listName:'Animals'},{id:'c'},{id:'p',perek:3}];
  const {ctx}=unitCtx(items,{db:{settings:{unitLabels:{'perek:3':'Lech Lecha',[Units.labelStorageKey('list:Animals')]:'Animal words'}}}});
  assert.deepEqual(Array.from(ctx.studentUnits().map(u=>u.key)),['perek:3','list:Animals','list:Main List']);
  assert.deepEqual(Array.from(ctx.studentUnits().map(u=>u.label)),['Lech Lecha','Animal words','Main List']);
  ctx.learningPerek='list:Animals';
  assert.deepEqual(Array.from(ctx.learningCatalog().map(x=>x.id)),['a','b']);
});

test('choosing a unit updates the menu without leaving Shorashim',()=>{
  const screens=[],items=[{id:'x',perek:18},{id:'y',perek:19},{id:'z',perek:20}];
  const ctx=vm.createContext({window:{B3ShorashimUnits:Units},db:{settings:{}},visibleCatalog:()=>items,currentTrack:'prefix',learningPerek:'perek:18',selectedItemKey:'prefix:p',followAllowsScreen:()=>true,goScreen:x=>screens.push(x)}); // no Follow Teacher restriction active
  ['unitLabels','bookletAllowed','studentUnits','chooseLearningPerek'].forEach(n=>vm.runInContext(fn(n),ctx));
  ctx.chooseLearningPerek('perek:19');
  assert.equal(ctx.currentTrack,'shorashim');
  assert.equal(ctx.learningPerek,'perek:19');
  assert.equal(ctx.selectedItemKey,null);
  assert.deepEqual(screens,['learnScreen']);
  ctx.chooseLearningPerek('perek:20');
  assert.equal(ctx.learningPerek,'perek:20');
  assert.deepEqual(screens,['learnScreen','learnScreen']);
  ctx.chooseLearningPerek('perek:22'); // not in this class
  assert.deepEqual(screens,['learnScreen','learnScreen']);
  ctx.db.settings.showBooklet=false;
  ctx.chooseLearningPerek('booklet'); // the teacher turned the booklet off
  assert.deepEqual(screens,['learnScreen','learnScreen']);
  assert.match(html,/data-go="shorashimPerekScreen" data-track="shorashim"/);
  assert.match(html,/id="perekUnitChoices"/);
  assert.match(html,/changeLearningPerekBtn/);
});
