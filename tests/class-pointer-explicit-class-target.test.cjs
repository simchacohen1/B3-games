const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

async function chooser(mode){
  const uri='https://funtorahtools.com/class-pointer-prototype/dashboard.html?teacher=1'+(mode?'&'+mode+'=1':'');
  const elements={};
  let callback,navigated=null;
  const buttons={
    children:[],replaceChildren(){this.children=[]},
    appendChild(b){this.children.push(b)},
    get childElementCount(){return this.children.length},
    querySelectorAll(){return this.children}
  };
  const element=()=>({hidden:false,disabled:false,textContent:'',setAttribute(){},onclick:null});
  for(const id of ['openTeacher','classChoice','welcome','teacherChoice','teacherSignIn','message'])elements[id]=element();
  elements.teacherClassButtons=buttons;
  const classes={
    et:{name:'B3 ET',toolGrants:{'class-pointer':true}},
    wt:{name:'B3 WT',toolGrants:{'class-pointer':true}},
    other:{name:'Other Class',toolGrants:{'class-pointer':true}}
  };
  const ref=id=>({once:async()=>({val:()=>classes[id]})});
  const fakeClassRef={child:ref,once:async()=>({val:()=>classes})};
  const db={ref:()=>fakeClassRef};
  const firebase={apps:[1],database:()=>db};
  const location={href:uri,assign:url=>{navigated=url}};
  const document={
    getElementById:id=>elements[id],
    querySelector:()=>({setAttribute(){}}),
    createElement:()=>({type:'',className:'',textContent:'',disabled:false,attributes:{},listeners:{},
      setAttribute(k,v){this.attributes[k]=v},addEventListener(k,v){this.listeners[k]=v}})
  };
  const C={validId:id=>/^[a-z]+$/.test(id),permitted:(access,id,row)=>!!row&&access.authorized&&access.classIds.includes(id)&&row.toolGrants['class-pointer']};
  const window={ClassPointerDashboardCore:C,B3_APP_CONTEXT:{workspaceId:'b3-2026'},
    B3SiteSettings:{onAuthStateChanged:fn=>callback=fn}};
  vm.runInNewContext(read('class-pointer-prototype/dashboard.js'),{window,document,location,URL,firebase,console});
  assert.equal(navigated,null,'opening teacher tool must not automatically enter ET');
  await callback({uid:'teacher'},true,{authorized:true,role:'teacher',classIds:['et','wt']});
  assert.equal(buttons.children.length,2,'only assigned classes should appear');
  assert.equal(navigated,null,'loading class list must not start a classroom');
  return {buttons,get navigated(){return navigated},message:elements.message.textContent};
}
test('Class Pointer teacher chooses ET or WT explicitly rather than defaulting to ET',async()=>{
  const c=await chooser();
  assert.match(c.buttons.children[0].textContent,/B3 ET/);
  assert.match(c.buttons.children[1].textContent,/B3 WT/);
  c.buttons.children[1].listeners.click();
  assert.match(c.navigated,/class=wt/);
  assert.doesNotMatch(c.navigated,/sendEveryone/);
});
test('Teacher Tools screen-sharing action targets only chosen class',async()=>{
  const c=await chooser('sendEveryoneShare');
  assert.equal(c.navigated,null);
  assert.match(c.message,/Only the class you select/);
  c.buttons.children[0].listeners.click();
  assert.match(c.navigated,/class=et/);
  assert.match(c.navigated,/sendEveryoneShare=1/);
});
test('Teacher Tools whiteboards action targets only chosen class',async()=>{
  const c=await chooser('sendEveryoneBoards');
  assert.equal(c.navigated,null);
  c.buttons.children[1].listeners.click();
  assert.match(c.navigated,/class=wt/);
  assert.match(c.navigated,/sendEveryoneBoards=1/);
});
test('Teacher Tools and classroom wire whiteboard launch without automatic all-classes action',()=>{
  const index=read('index.html'),classroom=read('class-pointer-prototype/classroom.js'),boards=read('class-pointer-prototype/student-boards.js');
  assert.match(index,/Send Class to Whiteboards/);
  assert.match(index,/sendEveryoneBoards=1/);
  assert.match(classroom,/classpointer:send-to-whiteboards/);
  assert.match(boards,/addEventListener\('classpointer:send-to-whiteboards'/);
});
