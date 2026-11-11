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
