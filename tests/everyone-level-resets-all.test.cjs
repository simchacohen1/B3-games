'use strict';
// Students panel: choosing a level for "Everyone" sets EVERY student to it, even when it is the level already selected,
// so students set one by one are reset too. (A drop-down only reports a change, so choosing the same level did nothing.)
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const dash=read('class-pointer-prototype/teacher-dashboard.js');

test('every press of a level button sets every student, including the level that is already selected',()=>{
  const start=dash.indexOf(' /* Everyone: one level for the whole class. */'),end=dash.indexOf(' sidebar.append(everyone);',start);
  const code=dash.slice(start,end);
  class El{constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.listeners={};this.className='';this.textContent='';this.id=''}
    append(...nodes){this.children.push(...nodes)}
    setAttribute(name,value){this.attrs[name]=String(value)}
    addEventListener(type,handler){(this.listeners[type]||(this.listeners[type]=[])).push(handler)}
    click(){for(const handler of this.listeners.click||[])handler({})}}
  const calls=[],head=new El('head');
  const context={el:(tag,cls,text)=>{const node=new El(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node},
    document:{createElement:tag=>new El(tag),head},window:{ClassPointerRoster:{setAll:level=>calls.push(level)}}};
  vm.runInNewContext(code+';globalThis.shown={group:everyoneGroup};',context);
  const group=context.shown.group;
  assert.ok(group&&group.id==='cpEveryoneLevel');
  const buttons=group.children;
  assert.deepEqual(buttons.map(b=>b.dataset.level),['none','point','highlight','pen']);
  const by=level=>buttons.find(b=>b.dataset.level===level);
  // The teacher sets one student to Pointer on their own, while Everyone is on Nothing: choosing Nothing for Everyone again must reset them.
  by('none').click();
  by('none').click();
  by('none').click();
  assert.deepEqual(calls,['none','none','none'],'the same level pressed again still sets everyone');
  by('pen').click();by('pen').click();by('none').click();
  assert.deepEqual(calls.slice(3),['pen','pen','none']);
  // The pressed state follows the last choice.
  assert.equal(by('none').attrs['aria-pressed'],'true');assert.equal(by('pen').attrs['aria-pressed'],'false');
  assert.equal(group.dataset.level,'none');
});

test('the Everyone control no longer listens for a drop-down change; the roster sync only shows the level',()=>{
  assert.doesNotMatch(dash,/everyoneSelect/);
  assert.doesNotMatch(dash,/setAll\(everyoneSelect/);
  assert.match(dash,/b\.addEventListener\('click',\(\)=>\{showEveryone\(v\);window\.ClassPointerRoster\?\.setAll\(v\)\}\)/);
  assert.match(dash,/if\(R\(\)\)showEveryone\(R\(\)\.everyone\(\)\);/);
  // setAll itself sets every student already in the class and forgets the ones set one by one.
  const cls=read('class-pointer-prototype/classroom.js');
  assert.match(cls,/setAll\(level\)\{\s*if\(!LEVELS\.includes\(level\)\)return;defaultLevel=level;nameLevels\.clear\(\);\s*for\(const m of \[\.\.\.members\.values\(\),\.\.\.presence\.values\(\)\]\)if\(m\.admitted\)applyLevel\(m,level\);/);
  assert.match(read('class-pointer-prototype/classroom.html'),/teacher-dashboard\.js\?v=20261117-send2/);
});
