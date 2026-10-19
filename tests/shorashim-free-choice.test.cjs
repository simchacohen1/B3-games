'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const app=fs.readFileSync('shorashim/app.js','utf8');
const html=fs.readFileSync('shorashim/index.html','utf8');
const fn=name=>{const line=app.split('\\n').find(x=>x.startsWith('function '+name+'('));assert.ok(line,name+' exists');return line;};

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
  const ctx=vm.createContext({currentTrack:'shorashim',student:()=>s,visibleCatalog:()=>items,keyFor:(t,id)=>t+':'+id,document,selectedItemKey:null,escapeHTML:x=>x,reviewFilterLabel:()=>'Perek',loadEditorItem:()=>{}});
  vm.runInContext(fn('renderWordList'),ctx);
  ctx.renderWordList();
  assert.equal(nodes.wordList.children.length,2);
  for(const btn of nodes.wordList.children){assert.equal(btn.disabled,true===false);assert.match(btn.innerHTML,/Choose • Learn/);assert.doesNotMatch(btn.className,/locked/);}
  assert.match(html,/Choose any word in any order/);
  assert.doesNotMatch(html,/New items unlock strictly in order/);
  assert.match(html,/app\\.js\\?v=20261019-free-choice/);
});
