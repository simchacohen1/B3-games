'use strict';
// sols.tools front door: a visitor who is not signed in sees only the home pages and Class Pointer; anyone signed in gets the
// whole site (every page still runs its own access checks). Started as issue #832 (Class Pointer only).
// The rule lives in sols-site/pointer-only.js, which only the sols.tools copy loads.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const P=require('../sols-site/pointer-only.js');
const source=fs.readFileSync(path.join(root,'sols-site','pointer-only.js'),'utf8');

test('a signed-out visitor may open the home page, the teacher sign-in page and Class Pointer pages, with or without .html',()=>{
 for(const ok of ['/','/index.html','/index','/teacher-home.html','/teacher-home','/teacher-home/','/class-pointer-prototype/classroom.html','/class-pointer-prototype/dashboard.html','/class-pointer-prototype/student-view.html','/class-pointer-prototype','/class-pointer-prototype/'])
  assert.equal(P.allowedPath(ok),true,ok);
 for(const no of ['/halacha/index.html','/halacha/','/shorashim/teacher.html','/admin.html','/owner-admin.html','/assignment-center/student.html','/student-report/index.html',
  '/record_pesukim/student.html','/multiplayer/index.html','/all-pages.html','/follow-teacher/teacher.html','/class-pointer-prototypes/x.html','/x/class-pointer-prototype/y.html','/Index.html'])
  assert.equal(P.allowedPath(no),false,no);
 assert.equal(P.allowedPath(''),true,'an empty path is the home page');
});

test('on a home page only links into Class Pointer are kept',()=>{
 for(const ok of ['class-pointer-prototype/dashboard.html?teacher=1&class=abc','class-pointer-prototype/classroom.html?dashboard=teacher&class=abc&sendEveryoneShare=1',
  '/class-pointer-prototype/classroom.html','./class-pointer-prototype/dashboard.html','https://sols.tools/class-pointer-prototype/dashboard.html#x'])
  assert.equal(P.isPointerHref(ok),true,ok);
 for(const no of ['student-report/index.html?class=abc','admin.html?tab=students&class=abc','word-bank/teacher.html?class=abc','follow-teacher/teacher.html?class=abc',
  'halacha/index.html','javascript:void(0)','','#','https://sols.tools/halacha/index.html','shorashim/teacher.html?next=class-pointer-prototype/'])
  assert.equal(P.isPointerHref(no),false,no);
});

test('anyone signed in gets the whole site; a visitor who is not signed in does not; nothing is decided before sign-in is checked',()=>{
 const owner={email:'owner@example.org'},teacher={email:'teacher@example.org'},student={email:null};
 assert.equal(P.viewerKind(false,null),'','nothing is decided before sign-in has been checked');
 assert.equal(P.viewerKind(true,null),'limited','signed out');
 assert.equal(P.viewerKind(true,owner),'full');
 assert.equal(P.viewerKind(true,teacher),'full','a regular teacher');
 assert.equal(P.viewerKind(true,student),'full','a student has no email address');
});

test('the rule never grants access itself: it does not read roles, and a not-signed-in visitor is still sent home',()=>{
 assert.ok(!/\.role\b|authorized/.test(source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'')),'no role or authorization logic');
 assert.match(source,/if \(pendingBounce && kind === 'limited'\) \{ pendingBounce = false; root\.location\.replace\('\/'\); return; \}/);
 // The page stays hidden until sign-in has answered, and is shown anyway if it never does (its own checks still apply).
 assert.match(source,/root\.setTimeout\(function \(\) \{ if \(pendingBounce\) \{ pendingBounce = false; showPage\(\); \} \}, 8000\);/);
});

test('the script only changes what is shown: it reads sign-in state and writes one browser setting',()=>{
 // No database, storage or network access of its own.
 assert.ok(!/\.database\(|\.ref\(|\.storage\(|fetch\(|XMLHttpRequest|signOut\(|signInWith/.test(source));
 assert.match(source,/root\.localStorage\.setItem\(FULL_KEY, '1'\)/);
 assert.match(source,/fb\.auth\(\)\.onAuthStateChanged\(/);
 // Another page stays hidden until it is known whether anyone is signed in.
 assert.match(source,/if \(!full && !allowedPath\(root\.location\.pathname\)\) \{\s*pendingBounce = true;\s*try \{ doc\.documentElement\.style\.visibility = 'hidden'; \} catch \(e\) \{\}/);
 // The student home page hides the tools, the "nothing available" note and the homework link.
 assert.match(source,/#gamesArea,#disabledMessage,#lockedCard,#homeworkStudentLink\{display:none!important\}/);
});

test('funtorahtools.com never loads it: no page or script outside sols-site mentions it',()=>{
 for(const file of ['index.html','teacher-home.html','site-settings.js','game-gate.js','class-pointer-prototype/classroom.html'])
  assert.ok(!/pointer-only|sols-brand|solsFullSite/.test(fs.readFileSync(path.join(root,file),'utf8')),file);
});

test('the sols.tools build puts the rule first in the one script every page loads',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sols-build-'));
 try{
  fs.cpSync(path.join(root,'sols-site'),path.join(dir,'sols-site'),{recursive:true});
  fs.copyFileSync(path.join(root,'firebase-config.js'),path.join(dir,'firebase-config.js'));
  const subtitle='<div class="subtitle">Learning games and practice tools</div>';
  fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><html><head><title>Fun Torah Tools</title></head><body><h1>Fun Torah Tools</h1>'+subtitle+'</body></html>');
  fs.mkdirSync(path.join(dir,'halacha'));
  fs.writeFileSync(path.join(dir,'halacha','index.html'),'<!doctype html><html><head><title>Halacha | Fun Torah Tools</title></head><body>'+subtitle+'</body></html>');
  execFileSync(process.execPath,[path.join(dir,'sols-site','build.mjs'),dir],{stdio:'pipe'});
  const built=fs.readFileSync(path.join(dir,'sols-brand.js'),'utf8');
  assert.ok(built.indexOf('solsFullSite')>0&&built.indexOf('__solsBrand')>0,'both parts are in the file');
  assert.ok(built.indexOf('solsFullSite')<built.indexOf('window.__solsBrand'),'the rule runs before the branding');
  for(const page of ['index.html',path.join('halacha','index.html')]){
   const html=fs.readFileSync(path.join(dir,page),'utf8');
   assert.equal((html.match(/<script src="\/sols-brand\.js"><\/script>/g)||[]).length,1,page);
   assert.ok(html.indexOf('/sols-brand.js')<html.indexOf('</head>'),'loaded in the head, before the page');
  }
  assert.equal(fs.readFileSync(path.join(dir,'CNAME'),'utf8').trim(),'sols.tools');
  // Only the sols.tools home page gets the Class Pointer subtitle; the source and other pages keep theirs.
  assert.match(fs.readFileSync(path.join(dir,'index.html'),'utf8'),/<div class="subtitle">Class Pointer and whiteboard<\/div>/);
  assert.match(fs.readFileSync(path.join(dir,'halacha','index.html'),'utf8'),/Learning games and practice tools/);
  assert.match(fs.readFileSync(path.join(root,'index.html'),'utf8'),/<div class="subtitle">Learning games and practice tools<\/div>/);
  // The built script still parses.
  execFileSync(process.execPath,['--check',path.join(dir,'sols-brand.js')],{stdio:'pipe'});
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

// A teacher opens a deeper page (e.g. /daily-checklist/teacher.html) in a NEW tab. The page's own sign-in first says "nobody"
// and only afterwards receives the teacher's remembered Google login. That first answer must not send the teacher home.
function runGate({path='/daily-checklist/teacher.html',full=false,session={},defaultUser=null,remembered='never',busy=false,laterUser=null}={}){
 const vm=require('node:vm');
 const log={replaced:null,reloaded:0,visible:'unset'},timers=[],intervals=[],store={solsFullSite:full?'1':null};
 let defaultCb=null,remCb=null;
 const style={};
 const win={
  document:{documentElement:{style},head:null,readyState:'complete',getElementById:()=>null,addEventListener(){}},
  location:{pathname:path,replace(u){log.replaced=u},reload(){log.reloaded++}},
  localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=v},removeItem:k=>{delete store[k]}},
  sessionStorage:{getItem:k=>session[k]||null},
  setTimeout:(f,ms)=>{timers.push({f,ms});return timers.length},setInterval:(f)=>{intervals.push(f);return intervals.length},clearInterval(){},MutationObserver:function(){this.observe=()=>{}},
 };
 const apps=[{options:{}}];
 win.firebase={apps,auth:()=>({onAuthStateChanged:cb=>{defaultCb=cb}}),
  app(name){if(!name)return apps[0];if(name!=='FTTRememberedTeacher'||!win.__rem)throw new Error('no app');return win.__rem},
  initializeApp(opts,name){win.__rem={auth:()=>({onAuthStateChanged:cb=>{remCb=cb}})};return win.__rem}};
 vm.createContext(win);win.window=win;
 win.__b3SignInBusy=busy;
 vm.runInContext(source,win);
 defaultCb&&defaultCb(defaultUser);           // the page's own sign-in answers first
 if(remembered==='user'&&remCb)remCb({email:'teacher@example.org'});
 if(remembered==='nobody'&&remCb)remCb(null);
 if(remembered==='never')timers.filter(t=>t.ms===4000).forEach(t=>t.f());   // it never answers: fall back after the wait
 if(laterUser){defaultCb(laterUser);log.reloadedWhileBusy=log.reloaded;win.__b3SignInBusy=false;intervals.forEach(f=>f());}   // a student signs in on the page
 log.hooked=!!remCb;log.store=store;return log;
}

test('new tab, teacher remembered: the first "nobody" does not send a teacher home from a deeper page',()=>{
 const r=runGate({remembered:'user'});
 assert.equal(r.replaced,null);
 assert.equal(r.store.solsFullSite,'1','and the whole-site view is remembered');
});

test('new tab, nobody signed in anywhere: still sent to the home page, only after the remembered login has answered too',()=>{
 const before=runGate({remembered:'pending'});
 assert.equal(before.replaced,null,'waits for the remembered login');
 assert.equal(runGate({remembered:'nobody'}).replaced,'/');
 assert.equal(runGate({remembered:'never'}).replaced,'/','fallback after a few seconds');
});

test('a teacher whose whole-site view was already saved is not flipped back and bounced in a new tab',()=>{
 const r=runGate({full:true,remembered:'user'});
 assert.equal(r.replaced,null);assert.equal(r.reloaded,0);assert.notEqual(r.store.solsFullSite,null);
});

test('a student tab never waits on or uses the remembered teacher login',()=>{
 const r=runGate({session:{b3Games_studentId:'s1'},remembered:'user'});
 assert.equal(r.hooked,false);
 assert.equal(r.replaced,'/');
});

test('signed in on the page itself: no bounce',()=>{
 assert.equal(runGate({defaultUser:{email:'t@example.org'},remembered:'pending'}).replaced,null);
});

// Bug on sols.tools: a student typed name and passcode, pressed the button, and the page reloaded in the middle of signing in
// (the first sign-in in a browser changes the view from limited to full). The form came back empty; the second try worked.
test('a student signing in for the first time: the page is not reloaded until the sign-in has finished',()=>{
 const r=runGate({path:'/',remembered:'nobody',busy:true,laterUser:{email:null}});
 assert.equal(r.reloadedWhileBusy,0,'no reload while the sign-in is still being finished');
 assert.equal(r.reloaded,1,'the whole-site view is applied once the sign-in is done');
 assert.equal(r.store.solsFullSite,'1');
});

test('without a sign-in in progress the view still changes at once when someone signs in',()=>{
 const r=runGate({path:'/',remembered:'nobody',busy:false,laterUser:{email:null}});
 assert.equal(r.reloadedWhileBusy,1);
});

test('the home page raises the sign-in-busy flag for the whole student sign-in and always lowers it',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const fn=html.slice(html.indexOf('async function studentSignIn()'),html.indexOf('let actingStudentRestoreInFlight'));
 assert.ok(fn.indexOf('globalThis.__b3SignInBusy=true')>0&&fn.indexOf('globalThis.__b3SignInBusy=true')<fn.indexOf('checkStudentAccess('),'raised before the passcode check');
 assert.match(fn,/finally\{[^}]*globalThis.__b3SignInBusy=false/,'lowered in finally');
 assert.match(fn,/setLoginMsg\("Signing in…"\)/,'shows Signing in…');
 assert.match(source,/__b3SignInBusy\)\s*return/,'the gate honours the flag');
});
