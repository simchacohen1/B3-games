const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

function fixture(initial='boards'){
  let authCallback,navigation=null;
  const createElement=()=>({
    textContent:'',hidden:false,disabled:false,attrs:{},events:{},
    setAttribute(k,v){this.attrs[k]=v},
    getAttribute(k){return this.attrs[k]},
    addEventListener(k,fn){this.events[k]=fn}
  });
  const elements=Object.fromEntries(['teacherChoice','teacherSignIn','welcome','message','classChoice','openTeacher'].map(k=>[k,createElement()]));
  const buttons={
    children:[],replaceChildren(){this.children=[]},appendChild(b){this.children.push(b)},
    get childElementCount(){return this.children.length},querySelectorAll(){return this.children}
  };
  elements.teacherClassButtons=buttons;
  const modes=['lesson','screens','boards'].map(mode=>{
    const btn=createElement();btn.attrs['data-classroom-mode']=mode;return btn
  });
  const classes={et:{name:'B3 ET',toolGrants:{'class-pointer':true}},wt:{name:'B3 WT',toolGrants:{'class-pointer':true}}};
  const db={ref:()=>({once:async()=>({val:()=>classes}),child:id=>({once:async()=>({val:()=>classes[id]})})})};
  const firebase={apps:[{}],database:()=>db};
  const location={href:'https://funtorahtools.com/class-pointer-prototype/dashboard.html?teacher=1'+
    (initial==='boards'?'&sendEveryoneBoards=1':initial==='screens'?'&sendEveryoneShare=1':''),assign:url=>navigation=url};
  const window={
    B3_APP_CONTEXT:{workspaceId:'b3-2026'},
    ClassPointerDashboardCore:{validId:s=>/^[a-z]+$/.test(s),permitted:(a,id,row)=>a.classIds.includes(id)&&row?.toolGrants?.['class-pointer']===true},
    B3SiteSettings:{onAuthStateChanged:cb=>{authCallback=cb}}
  };
  const document={
    getElementById:id=>elements[id],
    querySelector:()=>({setAttribute(){}}),
    querySelectorAll:()=>modes,
    createElement
  };
  vm.runInNewContext(read('class-pointer-prototype/dashboard.js'),{window,document,location,URL,firebase,console});
  return {async ready(){await authCallback({uid:'teacher'},true,{authorized:true,role:'teacher',classIds:['et','wt']})},buttons,modes,elements,get navigation(){return navigation}};
}

test('all three homepage tiles use one class-and-mode chooser',()=>{
  const index=read('index.html'),html=read('class-pointer-prototype/dashboard.html');
  for(const mode of ['lesson','screens','boards'])assert.match(html,new RegExp('data-classroom-mode="'+mode+'"'));
  for(const tag of ['Class Pointer — Start a lesson','Send Class to Share Screen','Send Class to Whiteboards'])assert.ok(index.includes(tag));
  assert.match(index,/class-pointer-prototype\/dashboard\.html\?teacher=1/);
});

test('the chosen mode may change without losing ET/WT class authorization',async()=>{
  const f=fixture('boards');await f.ready();
  assert.equal(f.buttons.children.length,2);
  assert.equal(f.modes[2].attrs['aria-pressed'],'true');
  f.modes[1].events.click();
  assert.equal(f.modes[1].attrs['aria-pressed'],'true');
  assert.match(f.buttons.children[0].textContent,/B3 ET/);
  f.buttons.children[0].events.click();
  assert.match(f.navigation,/class=et/);
  assert.match(f.navigation,/sendEveryoneShare=1/);
  assert.doesNotMatch(f.navigation,/sendEveryoneBoards=1/);
});

test('teacher screens action displays the working gallery and broadcasts to the selected class',()=>{
  const classroom=read('class-pointer-prototype/classroom.js');
  const boards=read('class-pointer-prototype/student-boards.js');
  const sessions=read('class-pointer-prototype/dashboard-session.js');
  assert.match(classroom,/dispatchEvent\(new Event\('classpointer:send-to-screens'\)\)/);
  assert.match(boards,/addEventListener\('classpointer:send-to-screens',[^\n]+sendEveryone\('screens'\)/);
  assert.match(boards,/requestStudentDestination\(destination,policy\(\)\)/);
  assert.match(sessions,/const ref=activeRef/);
  assert.match(sessions,/context\.ref\.child\('classPointerSessions\/'\+room\)/);
});

test('student classroom has no duplicate sharing banner; restart stays visible',()=>{
  const activity=read('class-pointer-prototype/activity-share.js');
  const css=read('class-pointer-prototype/classroom.css');
  const classroom=read('class-pointer-prototype/classroom.js');
  assert.match(activity,/Do not cover it with a second floating share prompt/);
  assert.match(activity,/if\(\/\\\/class-pointer-prototype\\\/classroom\\\.html\$\/\.test\(location\.pathname\)\)return/);
  assert.match(classroom,/startButton\.hidden=true/);
  assert.match(classroom,/button\.disabled=true;button\.hidden=false;button\.textContent='Ending class…'/);
  assert.match(classroom,/button\.disabled=false;button\.textContent='↻ Start another class'/);
  assert.match(css,/#startClass:not\(\[hidden\]\)\{display:inline-flex!important/);
});

