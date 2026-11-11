const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync('teacher-home.html','utf8');
const registrySource=fs.readFileSync('shared/home-tool-registry.js','utf8');
const registryContext={window:{}};vm.runInNewContext(registrySource,registryContext);
const registry=registryContext.window.B3HomeToolRegistry;
test('teacher home inline script has valid syntax',()=>{
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 assert.ok(scripts.length);scripts.forEach(code=>new vm.Script(code));
});
test('teacher home uses the Learning Island groups and a Teacher Tools box',()=>{
 for(const t of ['Chumash Cheder','Shorashim Grove','Skills Library','Learning Beis Midrash','Class Village','Challenge Playground'])assert.ok(registry.groups.some(g=>g.title===t),t);
 assert.ok(html.includes('Teacher Tools'));
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
test('teacher home reads its tool and group catalog from the shared registry',()=>{
 assert.match(html,/shared\/home-tool-registry\.js/);
 assert.match(html,/TOOLS=Object\.fromEntries\(Object\.entries\(REGISTRY\.tools\)/);
 assert.match(html,/PLACES=REGISTRY\.groups\.map/);
 assert.ok(Object.keys(registry.tools).length>=20);
 for(const id of Object.keys(registry.tools))assert.ok(registry.tools[id].title&&registry.tools[id].href,id);
});
test('registry keeps owner-only controls out and retains class grant mapping for every homepage tool',()=>{
 const index=fs.readFileSync('index.html','utf8');
 assert.match(index,/shared\/home-tool-registry\.js/);
 assert.match(index,/const homeRegistry=window\.B3HomeToolRegistry/);
 const homepageIds=new Set([...index.matchAll(/data-game-id="([^"]+)"/g)].map(m=>m[1]));
 // Companions deliberately share the Posuk Practice grant, while the owner
 // home includes student-facing tools that have no separate teacher grant.
 for(const id of ['posuk-practice-scroll','chazara','shorashim','rashi-letters','yiddish','gematria','halacha','sefer-hamitzvos','gallery','class-gallery','student-rewards','weekly-quiz','game-show','multiplayer-center'])assert.ok(registry.tools[id],id);
 for(const id of ['owner-admin','sync-to-nigri','comment-log'])assert.ok(!registry.tools[id],id);
 assert.ok(homepageIds.has('posuk-practice-scroll'));
 assert.deepEqual(Array.from(registry.tools['posuk-practice-scroll'].companions,c=>c.title),['Chumash חידון','Mishnayos Practice','Mishnayos חידון']);
 assert.ok(registry.groups.find(g=>g.id==='learn').icon.includes('aria-label="Rebbe"'),'Chumash Rebbe illustration remains SVG');
 assert.match(index,/data-companion-of="posuk-practice-scroll"/);
 assert.match(fs.readFileSync('home-island.css','utf8'),/@media\(max-width:750px\)/);
});
