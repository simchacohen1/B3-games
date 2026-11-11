const assert=require('node:assert/strict');
const test=require('node:test');
const dashboard=require('../principal-dashboard.js');

class FakeElement {
  constructor(tag,doc){
    this.nodeType=1;this.tagName=tag;this.ownerDocument=doc;
    this.children=[];this.dataset={};this.handlers={};this.hidden=false;this.open=false;
    this.textContent='';this.className='';this.value='';
  }
  append(...elements){for(const element of elements){element.parentElement=this;this.children.push(element);}}
  replaceChildren(...elements){this.children=[];this.append(...elements);}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,callback){this.handlers[name]=callback;}
  fire(name){this.handlers[name]?.();}
  querySelectorAll(selector){
    const hits=[];
    const visit=node=>{for(const child of node.children){
      if(selector==='.principal-class'&&child.className==='principal-class')hits.push(child);
      visit(child);
    }};
    visit(this);return hits;
  }
}
function fixture(){
  const doc={createElement(tag){return new FakeElement(tag,doc);}};
  const root=new FakeElement('root',doc);
  const storage=new Map();
  const store={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  const entries=['B3 ET · Morning','B3 WT · Afternoon','B4 ET · Morning'].map((name,index)=>({
    id:'class'+index,name,teacher:'Rabbi Example',card:new FakeElement('section',doc)
  }));
  return {root,store,entries};
}
function build(f){
  return dashboard.build(f.root,f.entries,{teacherCount:1,storage:f.store,persistKey:'fictional-principal'});
}
function groups(root){return root.children[0].children[3].children;}

test('groups named classes without conflating ET and WT',()=>{
  assert.equal(dashboard.gradeOf('B3 ET · Morning'),'B3');
  assert.equal(dashboard.gradeOf('B3 WT · Afternoon'),'B3');
  assert.equal(dashboard.gradeOf('B12 ET'),'B12');
  assert.equal(dashboard.gradeOf('Other program'),'Other classes');
});
test('unmatched school classes remain in an Other classes group',()=>{
  assert.equal(dashboard.gradeOf('Preschool'),'Other classes');
});
test('build requires a document element',()=>{
  assert.throws(()=>dashboard.build(null,[]),TypeError);
});
test('groups only provided already-authorized cards without cloning them',()=>{
  const f=fixture();build(f);const list=groups(f.root);
  assert.equal(list.length,2);
  const entries=list[0].children[1].children;
  assert.equal(entries.length,2);
  assert.strictEqual(entries[0].children[1],f.entries[0].card);
  assert.strictEqual(entries[1].children[1],f.entries[1].card);
  assert.equal(f.root.children[0].children[1].textContent,'3 supervised classes · 1 supervised teachers');
});
test('expand, collapse, search, and restore persisted group state',()=>{
  const f=fixture(),ui=build(f),list=groups(f.root);
  const first=list[0],second=list[1],firstClass=first.children[1].children[0];
  assert.equal(first.open,false);
  ui.expand.fire('click');assert.equal(first.open,true);assert.equal(firstClass.open,true);
  ui.collapse.fire('click');assert.equal(first.open,false);assert.equal(firstClass.open,false);
  ui.search.value='b3';ui.search.fire('input');
  assert.equal(first.hidden,false);assert.equal(second.hidden,true);
  assert.equal(f.root.children[0].children[1].textContent,'2 of 3 supervised classes · 1 supervised teachers');
  ui.search.value='';ui.search.fire('input');
  ui.expand.fire('click');
  build(f);assert.equal(groups(f.root)[0].open,true);
  assert.equal(groups(f.root)[0].children[1].children[0].open,true);
});
test('teacher filter matches class teacher without altering original cards',()=>{
  const f=fixture();f.entries[0].teacher='Rabbi Alef';
  f.entries[1].teacher='Rabbi Beis';
  const ui=build(f);
  ui.search.value='Beis';ui.search.fire('input');
  assert.equal(groups(f.root)[0].children[1].children[0].hidden,true);
  assert.equal(groups(f.root)[0].children[1].children[1].hidden,false);
  assert.strictEqual(groups(f.root)[0].children[1].children[1].children[1],f.entries[1].card);
});
