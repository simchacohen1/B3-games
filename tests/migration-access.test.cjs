const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function gate(data={},stored={}){
 const elements=new Map(),storage=new Map(Object.entries({b3Games_studentId:'child',b3Games_studentClass:'new_class',...stored}));
 function element(){return {style:{},dataset:{},parentNode:{removeChild(){}},appendChild(){},contains(){return false},querySelector(){return {textContent:''}},remove(){},set innerHTML(v){this.html=v}}}
 const document={currentScript:{src:'https://example.test/game-gate.js',getAttribute:k=>k==='data-game-id'?'yiddish':null},head:element(),documentElement:element(),body:element(),scripts:[],readyState:'complete',createElement:element,getElementById:id=>elements.get(id),querySelectorAll:()=>[],addEventListener(){}};
 const ctx={document,window:{addEventListener(){}},location:{search:''},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},URL,URLSearchParams,Intl,Date,console,setTimeout:()=>1,clearTimeout(){},setInterval(){},fetch:async url=>({ok:true,json:async()=>data[new URL(url).pathname]??null})};
 let source=fs.readFileSync('game-gate.js','utf8');source=source.replace('  watchTeacherAccess();\n  checkNow();',`  window.testGate={resolveStudentClass,decide,state:()=>({studentClassId,studentActive}),overlay:()=>overlay,setTeacher:v=>verifiedTeacherAccess=v};`);
 vm.runInNewContext(source,ctx);return ctx.window.testGate;
}
const base={
 '/b3Games/students/child/profile.json':{name:'Child',active:true},
 '/b3Games/students/child/memberships.json':{a:{workspaceId:'b3-2026',classId:'new_class',active:true}},
 '/b3Games/workspaces/b3-2026/classes/new_class.json':{active:true,members:{child:{active:true}},toolGrants:{yiddish:true}}
};
test('generic class grants allow the tool without inheriting B3 global tool switches',async()=>{const g=gate(base);await g.resolveStudentClass();g.decide({games:{yiddish:false}});assert.equal(g.overlay(),null)});
test('revoked tool grant blocks an already-open generic class page',async()=>{const data=structuredClone(base),g=gate(data);await g.resolveStudentClass();g.decide({});assert.equal(g.overlay(),null);data['/b3Games/workspaces/b3-2026/classes/new_class.json'].toolGrants.yiddish=false;await g.resolveStudentClass();g.decide({});assert.ok(g.overlay())});
test('blocked profile is enforced despite saved class and forged teacher bypass',async()=>{const data=structuredClone(base);data['/b3Games/students/child/profile.json'].active=false;const g=gate(data,{b3TeacherBypass:'1'});await g.resolveStudentClass();g.decide({});assert.ok(g.overlay());assert.equal(g.state().studentActive,false)});
test('inactive membership does not fall back to saved class',async()=>{const data=structuredClone(base);data['/b3Games/students/child/memberships.json'].a.active=false;const g=gate(data);await g.resolveStudentClass();g.decide({});assert.ok(g.overlay())});
test('saved class cannot select another classroom',async()=>{const g=gate(base,{b3Games_studentClass:'someone_else'});await g.resolveStudentClass();assert.equal(g.state().studentClassId,'new_class')});
test('multiple memberships preserve the selected active class',async()=>{const data=structuredClone(base);data['/b3Games/students/child/memberships.json'].z={workspaceId:'b3-2026',classId:'second',active:true};data['/b3Games/workspaces/b3-2026/classes/second.json']={active:true,members:{child:{active:true}},toolGrants:{yiddish:true}};const g=gate(data,{b3Games_studentClass:'second'});await g.resolveStudentClass();assert.equal(g.state().studentClassId,'second')});
test('legacy B3 manual lock and individual exception continue working',async()=>{const data=structuredClone(base);data['/b3Games/students/child/memberships.json'].a.classId='et';data['/b3Games/workspaces/b3-2026/classes/et.json']={active:true,members:{child:{active:true}}};const g=gate(data,{b3Games_studentClass:'et'});await g.resolveStudentClass();g.decide({classAccess:{et:{mode:'locked'}}});assert.ok(g.overlay());g.decide({classAccess:{et:{mode:'locked'}},studentGameOverrides:{child:{yiddish:true}}});assert.equal(g.overlay(),null)});
