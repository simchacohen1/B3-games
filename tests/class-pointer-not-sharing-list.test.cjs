'use strict';
// Teacher "Student Screens" viewer: a boy sharing from Shorashim (not joined to Pointer) must appear in the gallery
// tile and in the large viewer, Back to gallery must return, and the teacher dashboard must open a class without
// flashing the class chooser. Runs the real scripts against small fakes (no browser, no Firebase).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const wait=(predicate,message)=>new Promise((resolve,reject)=>{
  const start=Date.now(),timer=setInterval(()=>{
    let ok=false;try{ok=predicate()}catch{}
    if(ok){clearInterval(timer);resolve()}
    else if(Date.now()-start>2000){clearInterval(timer);reject(Error(message))}
  },5);
});

function makeDom(){
  const created=[],byId=new Map(),docListeners={};
  function element(tag){
    const node={
      tag,className:'',style:{cssText:'',setProperty(){}},dataset:{},children:[],listeners:{},attrs:{},hidden:false,disabled:false,
      textContent:'',title:'',value:'',clientWidth:800,clientHeight:600,tabIndex:0,srcObject:null,
      classList:{toggle(){},add(){},remove(){},contains(){return false}},
      setAttribute(k,v){this.attrs[k]=String(v)},getAttribute(k){return this.attrs[k]??null},
      append(...n){this.children.push(...n)},appendChild(n){this.children.push(n);return n},prepend(...n){this.children.unshift(...n)},
      replaceChildren(...n){this.children=n},after(){},remove(){this.removed=true},focus(){},
      addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)},
      dispatchEvent(){return true},
      click(){for(const fn of this.listeners.click||[])fn({stopPropagation(){},target:this})},
      play(){return Promise.resolve()},getContext(){return{}},closest(){return null},querySelector(){return null},querySelectorAll(){return[]}
    };
    created.push(node);return node;
  }
  const document={
    activeElement:null,createElement:element,createTextNode:text=>({textContent:text}),
    getElementById:id=>byId.get(id)||null,
    addEventListener(type,fn){(docListeners[type]??=[]).push(fn)},
    dispatchEvent(event){for(const fn of docListeners[event.type]||[])fn(event);return true},
    querySelector:()=>null,querySelectorAll:()=>[]
  };
  class Event{constructor(type){this.type=type}}
  class CustomEvent extends Event{}
  class PointerEvent extends Event{}
  class ResizeObserver{observe(){}}
  class MutationObserver{observe(){}}
  return{created,byId,document,Event,CustomEvent,PointerEvent,ResizeObserver,MutationObserver,element};
}


// ---------- "Not sharing yet" list (teacher, Screens mode) ----------
async function fixture(roster){
  const dom=makeDom(),{document,element}=dom;
  const stage=element('section'),toggle=element('button'),joinLink=element('input'),endClass=element('button');
  const room='class-pointer-12345678-1234-1234-1234-123456789abc';
  joinLink.value='https://funtorahtools.com/class-pointer-prototype/classroom.html?room='+room;
  dom.byId.set('stage',stage);dom.byId.set('studentBoards',toggle);dom.byId.set('joinLink',joinLink);dom.byId.set('endClass',endClass);
  const members=new Map([['m1',{id:'m1',name:'Arik',studentId:'arik',admitted:true,peerId:'p1'}],['m2',{id:'m2',name:'Dovid',studentId:'dovid',admitted:true,peerId:'p2'}]]);
  const bridge={isTeacher:true,members:()=>members,started:()=>true,send(){},status(){},fail(error){throw Error(String(error))}};
  const window={ClassPointerBridge:bridge,ClassPointerDashboard:{students:async()=>roster,updateActivityPermissions:async()=>{},setStudentScreenSharing:async()=>{}}};
  const ctx={window,document,Event:dom.Event,CustomEvent:dom.CustomEvent,PointerEvent:dom.PointerEvent,ResizeObserver:dom.ResizeObserver,MutationObserver:dom.MutationObserver,
    URL,URLSearchParams,console,Promise,getComputedStyle:()=>({columnGap:'10px',paddingLeft:'10px',paddingRight:'10px',paddingTop:'10px',paddingBottom:'10px'}),
    requestAnimationFrame:fn=>setTimeout(fn,0),setTimeout,clearTimeout,setInterval:(fn,ms)=>{const t=setInterval(fn,ms);t.unref?.();return t},clearInterval,
    location:{search:'?dashboard=teacher&class=et',href:'https://funtorahtools.com/class-pointer-prototype/classroom.html?dashboard=teacher&class=et'}};
  vm.createContext(ctx);
  vm.runInContext(read('class-pointer-prototype/student-boards.js'),ctx);
  toggle.click();
  const panel=dom.created.find(node=>node.className==='boards-waiting');
  const text=node=>[node.textContent,...(node.children||[]).map(text)].join(' ');
  const chips=()=>dom.created.filter(node=>/^boards-waiting-chip/.test(node.className)&&!node.removed);
  return{members,panel,text:()=>text(panel),chips:()=>(panel.children[1]?.children||[]).map(c=>c.textContent)};
}
const roster=[{id:'arik',name:'Arik'},{id:'dovid',name:'Dovid'},{id:'moshe',name:'Moshe'}];

test('lists every boy on the roster who is not sharing, and says who is not even connected',async()=>{
  const f=await fixture(roster);
  await wait(()=>f.panel.hidden===false&&f.chips().length===3,'waiting list did not appear');
  assert.match(f.text(),/3 not sharing yet/);
  assert.match(f.text(),/0 of 3 sharing/);
  assert.deepEqual(f.chips(),['Arik','Dovid','Moshe (not connected)']);
});

test('updates by itself when a boy starts and when he stops sharing',async()=>{
  const f=await fixture(roster);
  await wait(()=>f.chips().length===3,'initial list');
  f.members.get('m1').screenStream={id:'s1'};
  await wait(()=>f.chips().length===2,'list did not shrink when Arik started sharing');
  assert.match(f.text(),/2 not sharing yet/);assert.match(f.text(),/1 of 3 sharing/);
  assert.ok(!f.chips().includes('Arik'));
  f.members.get('m1').screenStream=null;
  await wait(()=>f.chips().length===3,'list did not grow when Arik stopped');
});

test('says everyone is sharing when nobody is left',async()=>{
  const f=await fixture([{id:'arik',name:'Arik'},{id:'dovid',name:'Dovid'}]);
  await wait(()=>f.chips().length===2,'initial list');
  f.members.get('m1').screenStream={id:'s1'};f.members.get('m2').screenStream={id:'s2'};
  await wait(()=>/Everyone is sharing/.test(f.text()),'did not show the all-sharing message');
  assert.match(f.text(),/2 of 2 sharing/);assert.equal(f.chips().length,0);
});
