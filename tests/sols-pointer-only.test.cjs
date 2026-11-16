'use strict';
// sols.tools shows only Class Pointer to teachers and students (issue #832).
// The rule lives in sols-site/pointer-only.js, which only the sols.tools copy loads.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const P=require('../sols-site/pointer-only.js');
const source=fs.readFileSync(path.join(root,'sols-site','pointer-only.js'),'utf8');

test('only the home page, the teacher home page and Class Pointer pages may be opened',()=>{
 for(const ok of ['/','/index.html','/teacher-home.html','/class-pointer-prototype/classroom.html','/class-pointer-prototype/dashboard.html','/class-pointer-prototype/student-view.html'])
  assert.equal(P.allowedPath(ok),true,ok);
 for(const no of ['/halacha/index.html','/halacha/','/shorashim/teacher.html','/admin.html','/owner-admin.html','/assignment-center/student.html','/student-report/index.html',
  '/record_pesukim/student.html','/multiplayer/index.html','/all-pages.html','/follow-teacher/teacher.html','/class-pointer-prototype','/class-pointer-prototypes/x.html','/x/class-pointer-prototype/y.html','/Index.html'])
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

test('only a site administrator keeps the whole site; a teacher, a student and a visitor do not',()=>{
 const owner={email:'owner@example.org'},teacher={email:'teacher@example.org'},student={email:null};
 assert.equal(P.viewerKind(false,null,null),'','nothing is decided before sign-in has been checked');
 assert.equal(P.viewerKind(true,null,null),'limited','signed out');
 assert.equal(P.viewerKind(true,owner,{authorized:true,role:'admin'}),'full');
 assert.equal(P.viewerKind(true,teacher,{authorized:true,role:'teacher'}),'limited');
 assert.equal(P.viewerKind(true,teacher,{authorized:true,role:'teacher',accountType:'principal'}),'limited');
 assert.equal(P.viewerKind(true,student,{authorized:false,role:''}),'limited','a student has no email address');
 // A teacher whose access is still being looked up: wait, do not flip the view.
 assert.equal(P.viewerKind(true,teacher,{authorized:false,role:''}),'');
 assert.equal(P.viewerKind(true,teacher,null),'');
 // Claiming the role without being authorized is not enough.
 assert.equal(P.viewerKind(true,teacher,{authorized:false,role:'admin'}),'');
});

test('the script only changes what is shown: it reads sign-in state and writes one browser setting',()=>{
 // No database, storage or network access of its own.
 assert.ok(!/\.database\(|\.ref\(|\.storage\(|fetch\(|XMLHttpRequest|signOut\(|signInWith/.test(source));
 assert.match(source,/root\.localStorage\.setItem\(FULL_KEY, '1'\)/);
 assert.match(source,/fb\.auth\(\)\.onAuthStateChanged\(/);
 // Another page is left before it shows anything.
 assert.match(source,/if \(!full && !allowedPath\(root\.location\.pathname\)\) \{\s*try \{ doc\.documentElement\.style\.visibility = 'hidden'; \} catch \(e\) \{\}\s*root\.location\.replace\('\/'\);\s*return;/);
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
