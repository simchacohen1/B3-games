'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const app=fs.readFileSync('shorashim/app.js','utf8');
const html=fs.readFileSync('shorashim/index.html','utf8');
const teacherHtml=fs.readFileSync('shorashim/teacher.html','utf8');
const g={window:{}};
vm.runInNewContext(fs.readFileSync('shorashim/chumash-vocab.js','utf8'),g);
g.window.B3ShorashimUnits=require('../shorashim/units.js');
const words=g.window.FTT_CHUMASH_VOCAB;
const csv=fs.readFileSync('shorashim/data/chumash-vocab-3-levels.csv','utf8').replace(/^﻿/,'').trim().split(/\r?\n/).slice(1).map(l=>{const a=l.split(',');return {level:a[0],hebrew:a[1],english:a.slice(2).join(',')};});
const fn=name=>{const line=app.split(/\r?\n/).find(x=>x.startsWith('function '+name+'('));assert.ok(line,'missing '+name);return line;};
const ctxFor=(unit,cards={})=>{
  const s={cards};
  const ctx=vm.createContext({window:g.window,currentTrack:'shorashim',learningPerek:unit,bookletWeek:1,student:()=>s,
    db:{catalog:{shorashim:[{id:'p18',perek:18,front:'x',english:'x'}]}},
    isStudentAvailable:i=>!!i&&!i.hidden,keyFor:(t,id)=>t+':'+id,splitKey:k=>{const i=k.indexOf(':');return [k.slice(0,i),k.slice(i+1)];}});
  ['bookletCatalog','chumashCatalog','chumashExtra','getItem','visibleCatalog','learningCatalog','unitKeyOf','unitLabels','studentUnits','currentLearningUnit'].forEach(n=>vm.runInContext(fn(n),ctx));
  return ctx;
};

test('three lists match the CSV exactly: 231 / 315 / 143',()=>{
  assert.equal(words.length,689);assert.equal(csv.length,689);
  for(const [lvl,n] of [['1',231],['2',315],['3',143]]){
    const inLvl=words.filter(w=>w.listName==='Chumash Vocab Level '+lvl);
    assert.equal(inLvl.length,n);
    assert.deepEqual(Array.from(inLvl.map(w=>[w.front,w.english]),a=>Array.from(a)),csv.filter(r=>r.level===lvl).map(r=>[r.hebrew,r.english]));
  }
  assert.equal(new Set(words.map(w=>w.id)).size,689);
  words.forEach(w=>assert.ok(/^[A-Za-z0-9-]+$/.test(w.id)&&!w.hidden&&Array.isArray(w.art)));
});
test('students see the three lists as Choose-a-list units, and learn only that list',()=>{
  const c=ctxFor('list:Chumash Vocab Level 2');
  const units=vm.runInContext('studentUnits()',c);
  for(const l of [1,2,3])assert.ok(units.some(u=>u.key==='list:Chumash Vocab Level '+l));
  assert.equal(units.find(u=>u.key==='list:Chumash Vocab Level 3').count,143);
  assert.equal(units[0].key,'perek:18','own lists stay first so default list never changes');
  assert.deepEqual(Array.from(units.slice(1).map(u=>u.key)),['list:Chumash Vocab Level 1','list:Chumash Vocab Level 2','list:Chumash Vocab Level 3']);
  assert.equal(vm.runInContext('learningCatalog()',c).length,315);
  assert.ok(vm.runInContext("getItem('shorashim:chumash-vocab-l1-001')",c));
});
test('the new lists do not change the regular catalog (home count, games, other lists)',()=>{
  const c=ctxFor('perek:18');
  assert.equal(vm.runInContext("visibleCatalog('shorashim')",c).length,1);
  assert.equal(vm.runInContext('learningCatalog()',c).length,1);
});
test('scripts are loaded by the student and teacher pages',()=>{
  assert.match(html,/chumash-vocab\.js/);assert.match(teacherHtml,/chumash-vocab\.js/);
});
test('B3 ET/WT shared catalog: copied Chumash words are not retagged Perek 18, so students see all 3 lists',()=>{
  const fnLine=n=>{if(n!=='normalizeCatalogUnits')return fn(n);const a=app.indexOf('function normalizeCatalogUnits(');return app.slice(a,app.indexOf('\n}',a)+2);};
  const copied=Array.from(words,w=>({id:w.id,front:w.front,english:w.english,hebrew:w.front,listName:w.listName,art:[],hidden:false}));
  const ctx=vm.createContext({window:g.window,classSpaceId:'',DEFAULT_CATALOG:{shorashim:[]},clone:v=>JSON.parse(JSON.stringify(v)),
    db:{catalog:null},currentTrack:'shorashim',learningPerek:null,bookletWeek:1,student:()=>({cards:{}}),
    isStudentAvailable:i=>!!i&&!i.hidden,keyFor:(t,id)=>t+':'+id});
  ['normalizeCatalogUnits'].concat(['bookletCatalog','chumashCatalog','chumashExtra','visibleCatalog','unitKeyOf','unitLabels','studentUnits']).forEach(n=>vm.runInContext(fnLine(n),ctx));
  ctx.db.catalog=vm.runInContext('normalizeCatalogUnits',ctx)({shorashim:[{id:'p18',front:'x',english:'x'},{id:'19-1',front:'y',english:'y'},...copied]});
  const byId=Object.fromEntries(ctx.db.catalog.shorashim.map(i=>[i.id,i]));
  assert.equal(byId.p18.perek,18);assert.equal(byId['19-1'].perek,19);
  const units=vm.runInContext('studentUnits()',ctx);
  for(const [l,n] of [[1,231],[2,315],[3,143]])assert.equal(units.find(u=>u.key==='list:Chumash Vocab Level '+l)?.count,n);
  assert.equal(units.find(u=>u.key==='perek:18').count,1);
});
