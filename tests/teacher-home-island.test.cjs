const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync('teacher-home.html','utf8');
const indexHtml=fs.readFileSync('index.html','utf8');
require('../shared/home-tool-registry.js');
const R=globalThis.B3HomeToolRegistry,regSrc=fs.readFileSync('shared/home-tool-registry.js','utf8');
test('teacher home inline script has valid syntax',()=>{
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 assert.ok(scripts.length);scripts.forEach(code=>new vm.Script(code));
});
test('teacher home uses the Learning Island groups and a Teacher Tools box',()=>{
 for(const t of ['Chumash Cheder','Shorashim Grove','Skills Library','Learning Beis Midrash','Class Village','Challenge Playground','Teacher Tools'])assert.ok(regSrc.includes(t)||html.includes(t),t);
 assert.ok(html.includes('shared/home-tool-registry.js'));
});
test('index.html and teacher-home.html both render from the one shared registry (no hard-coded tile lists)',()=>{
 assert.ok(indexHtml.includes('shared/home-tool-registry.js')&&indexHtml.includes('renderMap({audience:"student"})'));
 assert.ok(!/data-game-id="shorashim"/.test(indexHtml)&&!/Mishnayos חידון/.test(indexHtml)&&!/Mishnayos חידון/.test(html));
});
test('a teacher with Posuk Practice gets Chumash חידון and both Mishnayos tiles, like the owner',()=>{
 const t=R.renderMap({audience:'teacher',isOn:id=>id==='posuk-practice-scroll',hrefFor:x=>x.href});
 for(const name of ['Chumash חידון','Mishnayos Practice','Mishnayos חידון'])assert.ok(t.includes(name),name);
 const st=R.renderMap({audience:'student'});
 for(const name of ['Chumash חידון','Mishnayos Practice','Mishnayos חידון'])assert.ok(st.includes(name),name);
 assert.ok(!R.renderMap({audience:'teacher',isOn:()=>false}).includes('Chumash'));
});
test('owner-only Teacher Tools never reach a teacher; grants still gate shared ones',()=>{
 const none=R.renderTeacherTools({audience:'teacher',classId:'c1',isOn:()=>false});
 assert.ok(!/sync-to-nigri|class-dashboard|davening_student_app_(et|wt)|admin\.html\?tab=access/.test(none));
 assert.ok(none.includes('Follow the Teacher')&&!none.includes('assignment-center'));
 assert.ok(R.renderTeacherTools({audience:'teacher',classId:'c1',isOn:g=>g==='homework'}).includes('assignment-center/teacher.html?class=c1'));
 assert.ok(R.renderTeacherTools({audience:'admin'}).includes('sync-to-nigri'));
});
test('owner-only items are not on the teacher home',()=>{
 assert.ok(!/sync-to-nigri|owner-admin\.html|comment-log|class-dashboard/.test(html.replace(/location\.replace\("index\.html"\)/,'')));
 assert.ok(!/sync-to-nigri|comment-log/.test(R.renderTeacherTools({audience:'teacher',classId:'x',isOn:()=>true})));
});
test('a new class record has no tool grants',()=>{
 const owner=fs.readFileSync('owner-admin.html','utf8');
 const m=owner.match(/q\("addClass"\)\.onclick=[^\n]*/)[0];
 assert.match(m,/\.set\(\{name:name,active:true(,schoolId:school)?\}\)/); // every class now belongs to a school
 assert.ok(!/toolGrants/.test(m));
});
