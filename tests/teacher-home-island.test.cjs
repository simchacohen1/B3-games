const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync('teacher-home.html','utf8');
test('teacher home inline script has valid syntax',()=>{
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 assert.ok(scripts.length);scripts.forEach(code=>new vm.Script(code));
});
test('teacher home uses the Learning Island groups and a Teacher Tools box',()=>{
 for(const t of ['Chumash Cheder','Shorashim Grove','Skills Library','Learning Beis Midrash','Class Village','Challenge Playground','Teacher Tools'])assert.ok(html.includes(t),t);
});
test('owner-only items are not on the teacher home',()=>{
 assert.ok(!/sync-to-nigri|owner-admin\.html|comment-log|class-dashboard/.test(html.replace(/location\.replace\("index\.html"\)/,'')));
});
test('a new class record has no tool grants',()=>{
 const owner=fs.readFileSync('owner-admin.html','utf8');
 const m=owner.match(/q\("addClass"\)\.onclick=[^\n]*/)[0];
 assert.match(m,/\.set\(\{name:name,active:true(,schoolId:school)?\}\)/); // every class now belongs to a school
 assert.ok(!/toolGrants/.test(m));
});
// The home page (index.html) shows the two חידון quizzes and Mishnayos Practice as companions
// of Posuk Practice. The teacher home must offer the same ones, with no separate tool grant.
test('Posuk Practice companions (Chumash חידון, Mishnayos Practice, Mishnayos חידון) are on the teacher home',()=>{
 const index=fs.readFileSync('index.html','utf8');
 const onHome=[...index.matchAll(/data-companion-of="posuk-practice-scroll" href="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(onHome.length,3);
 for(const href of onHome)assert.ok(html.includes("'"+href.replace('record-mishnayos/student.html"','')+"'")||href==='record-mishnayos/student.html',href);
 assert.match(html,/\['📖','Mishnayos Practice','record-mishnayos\/teacher\.html',true\]/,'teachers open the Mishnayos teacher dashboard for their class');
 assert.match(html,/x\[0\]==='posuk-practice-scroll'&&!previewActive\?companions:''/,'only next to Posuk Practice, so only for classes that have it');
 assert.ok(!/toolGrants\[.?(chidon|record-mishnayos)/i.test(html));
});
test('a teacher with more than one class gets a jump button for each class',()=>{
 assert.match(html,/id="classJump" class="hidden"/);
 assert.match(html,/q\("classJump"\)\.classList\[shown\.length<2\?"add":"remove"\]\("hidden"\)/);
 assert.match(html,/<section class="class-card" id="class-card-'\+esc\(id\)\+'"/);
 assert.match(html,/card\.scrollIntoView\(/);
});
