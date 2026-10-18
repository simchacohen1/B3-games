const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

async function chooser(mode,{saved=null,classIds=['et','wt']}={}){
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
      setAttribute(k,v){this.attributes[k]=v},addEventListener(k,v){this.listeners[k]=v},click(){this.listeners.click?.()}})
  };
  const C={validId:id=>/^[a-z]+$/.test(id),permitted:(access,id,row)=>!!row&&access.authorized&&access.classIds.includes(id)&&row.toolGrants['class-pointer']};
  const window={ClassPointerDashboardCore:C,B3_APP_CONTEXT:{workspaceId:'b3-2026'},
    B3SiteSettings:{onAuthStateChanged:fn=>callback=fn}};
  const store=new Map(saved?[['classPointerLastTeacherClass',saved]]:[]);
  const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))};
  vm.runInNewContext(read('class-pointer-prototype/dashboard.js'),{window,document,location,URL,firebase,console,localStorage});
  assert.equal(navigated,null,'nothing opens before the teacher is signed in and authorized');
  await callback({uid:'teacher'},true,{authorized:true,role:'teacher',classIds});
  assert.equal(buttons.children.length,classIds.filter(id=>classes[id]).length,'only assigned classes should appear');
  if(mode)assert.equal(navigated,null,'screen and whiteboard requests must never be sent without an explicit class choice');
  return {buttons,store,get navigated(){return navigated},message:elements.message.textContent};
}
test('Class Pointer teacher classroom opens directly in an authorized class (last used, else ET)',async()=>{
  // Approved change (PR #161): Teacher Tools > Classroom Pointer skips the intro chooser.
  const fresh=await chooser();
  assert.match(fresh.navigated,/classroom\.html\?dashboard=teacher&class=et$/);
  assert.doesNotMatch(fresh.navigated,/sendEveryone/);
  const last=await chooser(undefined,{saved:'wt'});
  assert.match(last.navigated,/class=wt$/);
  // A remembered class the teacher is no longer assigned to is never opened.
  const revoked=await chooser(undefined,{saved:'other',classIds:['wt']});
  assert.match(revoked.navigated,/class=wt$/);
  assert.equal(revoked.store.get('classPointerLastTeacherClass'),'wt');
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
  // Teacher Tools now deliberately has one Pointer tile; the modes live in its chooser.
  assert.match(index,/class-pointer-prototype\/dashboard\.html\?dashboard=teacher=1/.source?/class-pointer-prototype\/dashboard\.html\?teacher=1/:null);
  assert.match(index,/Classroom Pointer/);
  assert.doesNotMatch(index,/Send Class to Whiteboards/);
  assert.match(classroom,/classpointer:send-to-whiteboards/);
  assert.match(boards,/addEventListener\('classpointer:send-to-whiteboards'/);
});
