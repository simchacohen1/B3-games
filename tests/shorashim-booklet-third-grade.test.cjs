'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const app=fs.readFileSync('shorashim/app.js','utf8');
const html=fs.readFileSync('shorashim/index.html','utf8');
const teacher=fs.readFileSync('shorashim/teacher.js','utf8');
const teacherHtml=fs.readFileSync('shorashim/teacher.html','utf8');
const review=fs.readFileSync('shorashim/review-categories.js','utf8');
const imported=fs.readFileSync('shorashim/booklet-3rd-grade.js','utf8');
const globals={window:{}};
vm.runInNewContext(imported,globals);
const cards=globals.window.FTT_BOOKLET_SHORASHIM;
const fn=name=>{const line=app.split(/\r?\n/).find(x=>x.startsWith('function '+name+'('));assert.ok(line,'missing '+name);return line;};
const newContext=(overrides={})=>{
  const s={cards:{}};
  const ctx=vm.createContext({
    window:globals.window,
    currentTrack:'shorashim',
    learningPerek:'booklet',
    bookletWeek:1,
    student:()=>s,
    db:{catalog:{shorashim:[{id:'p18',perek:18,front:'Other',english:'other'},{id:'p19',perek:19,front:'Second',english:'second'}]}},
    isStudentAvailable:item=>!!item&&!item.hidden,
    keyFor:(track,id)=>track+':'+id,
    splitKey:key=>key.split(':'),
    itemPerek:item=>item?.bookletWeek?0:Number(item?.perek)||18,
    ...overrides
  });
  ['bookletCatalog','getItem','visibleCatalog','learningCatalog','nextLearningUncreated'].forEach(name=>vm.runInContext(fn(name),ctx));
  return {ctx,s};
};

test('booklet exactly matches 30 weeks of six separately identified cards',()=>{
  assert.equal(cards.length,180);
  assert.equal(new Set(cards.map(x=>x.id)).size,180);
  for(let week=1;week<=30;week++){
    const rows=cards.filter(x=>x.bookletWeek===week);
    assert.equal(rows.length,6,'Week '+week);
    assert.deepEqual(Array.from(rows.map(x=>x.bookletNumber)),[1,2,3,4,5,6]);
    rows.forEach(x=>{assert.ok(x.front);assert.ok(x.english);assert.equal(x.source,'Shoroshim Booklet — 3rd Grade');});
  }
  assert.deepEqual([cards[0].front,cards[0].english],['א.כ.ל','eat']);
  assert.deepEqual([cards[5].front,cards[5].english],['נ.ג.ד','tell']);
  assert.deepEqual([cards.at(-1).front,cards.at(-1).english],['תּוֹרָה','law, lesson']);
  assert.equal(cards.find(x=>x.bookletWeek===15&&x.bookletNumber===1).english,'from where?');
  assert.equal(cards.find(x=>x.bookletWeek===19&&x.bookletNumber===5).english,'palm of hand, sole, spoon');
  assert.ok(Object.isFrozen(cards));
  assert.ok(Object.isFrozen(cards[0]));
});

test('booklet words never mingle with Perek 18 and Perek 19 lists',()=>{
  const {ctx}=newContext();
  assert.equal(ctx.learningCatalog().length,6);
  assert.ok(ctx.learningCatalog().every(x=>x.bookletWeek===1));
  assert.equal(ctx.learningCatalog()[0].id,'booklet-3rd-w01-1');
  assert.equal(ctx.getItem('shorashim:booklet-3rd-w30-6').english,'law, lesson');
  ctx.bookletWeek=30;
  assert.equal(ctx.learningCatalog().length,6);
  assert.equal(ctx.nextLearningUncreated().id,'booklet-3rd-w30-1');
  ctx.bookletWeek='all';
  assert.equal(ctx.learningCatalog().length,180);
  ctx.learningPerek=18;
  assert.deepEqual(Array.from(ctx.learningCatalog().map(x=>x.id)),['p18']);
  ctx.learningPerek=19;
  assert.deepEqual(Array.from(ctx.learningCatalog().map(x=>x.id)),['p19']);
  assert.equal(ctx.getItem('shorashim:p18').front,'Other');
  assert.equal(ctx.getItem('prefix:booklet-3rd-w01-1'),null);
});

test('booklet allows any chosen week and preserves student word progression',()=>{
  const {ctx,s}=newContext();
  ctx.bookletWeek=20;
  const row=ctx.learningCatalog()[3];
  assert.equal(row.bookletWeek,20);
  s.cards['shorashim:'+row.id]={itemKey:'shorashim:'+row.id,itemType:'shorashim',learnedAt:12345};
  assert.equal(ctx.getItem('shorashim:'+row.id).english,'altar');
  assert.equal(ctx.learningCatalog().length,6);
  assert.equal(ctx.nextLearningUncreated().bookletNumber,1);
  assert.equal(ctx.learningCatalog().filter(x=>s.cards['shorashim:'+x.id]?.learnedAt).length,1);
});

test('three-choice UI, week dropdown, source load order and review filter are wired',()=>{
  for(const x of ['18','19','booklet'])assert.match(html,new RegExp('data-learning-perek="'+x+'"'));
  assert.match(html,/id="bookletWeekSelect"/);
  for(let n=1;n<=30;n++)assert.match(html,new RegExp('<option value="'+n+'">Week '+n+'</option>'));
  assert.match(html,/data-review-perek="booklet"/);
  assert.match(html,/Change List/);
  assert.ok(html.indexOf('booklet-3rd-grade.js?v=')<html.indexOf('app.js?v=20261020-follow-pointer1'));
  assert.ok(teacherHtml.indexOf('booklet-3rd-grade.js?v=')<teacherHtml.indexOf('teacher.js?v=20261019-booklet-1'));
  assert.match(review,/reviewPerekFilter === 'booklet'/);
  assert.match(teacher,/window\.FTT_BOOKLET_SHORASHIM\.find/);
  assert.doesNotMatch(app,/\`\$\{learningPerek/);
});

test('the source list never writes to Firebase or mutates the school catalog',()=>{
  assert.doesNotMatch(imported,/\.ref\(|\.set\(|\.update\(/i);
  assert.match(app,/if\(learningPerek==='booklet'\)return bookletCatalog\(\)\.filter/);
});
