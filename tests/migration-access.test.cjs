const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function gate(data={},stored={},tool="yiddish",signedIn=true){
 const elements=new Map(),storage=new Map(Object.entries({b3Games_studentId:'child',b3Games_studentClass:'new_class',...stored}));
 function element(){return {style:{},dataset:{},parentNode:{removeChild(){}},appendChild(){},setAttribute(){},contains(){return false},querySelector(){return {textContent:''}},remove(){},set innerHTML(v){this.html=v}}}
 const document={currentScript:{src:'https://example.test/game-gate.js',getAttribute:k=>k==='data-game-id'?tool:null},head:element(),documentElement:element(),body:element(),scripts:[],readyState:'complete',createElement:element,getElementById:id=>elements.get(id),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
 const firebase={auth:()=>({currentUser:signedIn?{getIdToken:async()=>'synthetic-id-token'}:null})};
 const readRest=url=>{const path=new URL(url).pathname.replace(/\.json$/,'');if(Object.prototype.hasOwnProperty.call(data,path+'.json'))return data[path+'.json'];const parent=Object.keys(data).map(k=>k.replace(/\.json$/,'')).filter(k=>path.startsWith(k+'/')).sort((a,b)=>b.length-a.length)[0];if(!parent)return data[path]??null;return path.slice(parent.length+1).split('/').reduce((value,key)=>value&&value[key],data[parent+'.json']);};
 const ctx={document,window:{firebase,B3StudentTools:require('../backend/functions/student-tool-policy.js'),addEventListener(){}},firebase,location:{search:''},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},URL,URLSearchParams,AbortController,Intl,Date,console,setTimeout:()=>1,clearTimeout(){},setInterval(){},fetch:async url=>{const parsed=new URL(url);if(!signedIn&&parsed.pathname.includes('/b3Games/students/'))return{ok:false,status:401,json:async()=>null};return{ok:true,json:async()=>readRest(url)}}};
 let source=fs.readFileSync('game-gate.js','utf8').replace(/\r\n/g,'\n');source=source.replace(/  (?:if \(!isGuestPreview\(\)\) )?watchTeacherAccess\(\);\s*checkNow\(\);/,`  window.testGate={resolveStudentClass,decide:settings=>{teacherCheckPending=false;decide(settings);},state:()=>({studentClassId,studentActive}),overlay:()=>overlay,setTeacher:v=>verifiedTeacherAccess=v,ready:markAuthReady};`);
 vm.runInNewContext(source,ctx);ctx.window.testGate.ready();return ctx.window.testGate;
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

test('Gallery page accepts the owner grant names gallery and tag',async()=>{for(const grant of ['gallery','tag','class-gallery']){const data=structuredClone(base);data['/b3Games/workspaces/b3-2026/classes/new_class.json'].toolGrants={[grant]:true};const g=gate(data,{},'class-gallery');await g.resolveStudentClass();g.decide({});assert.equal(g.overlay(),null)}});

test('individual restriction blocks direct tool entry and restores without changing classmates',async()=>{
 const data=structuredClone(base),cls=data['/b3Games/workspaces/b3-2026/classes/new_class.json'];
 cls.members.child.toolAccess={yiddish:false};cls.members.other={active:true};
 const g=gate(data);await g.resolveStudentClass();g.decide({});assert.ok(g.overlay());
 delete cls.members.child.toolAccess.yiddish;await g.resolveStudentClass();g.decide({});assert.equal(g.overlay(),null);
});
test('legacy class exceptions cannot bypass individual restrictions',async()=>{
 const data=structuredClone(base);data['/b3Games/students/child/memberships.json'].a.classId='et';
 data['/b3Games/workspaces/b3-2026/classes/et.json']={active:true,members:{child:{active:true,toolAccess:{yiddish:false}}}};
 const g=gate(data,{b3Games_studentClass:'et'});await g.resolveStudentClass();g.decide({classAccess:{et:{mode:'open'}},studentGameOverrides:{child:{yiddish:true}}});assert.ok(g.overlay());
});

test('class-level denial is enforced for each activity affected by strict Firebase rules',async()=>{
 const tools=['rashi-letters','chazara','gematria','shorashim','weekly-quiz','halacha','yiddish','sefer-hamitzvos'];
 for(const tool of tools){
  const data=structuredClone(base);
  data['/b3Games/workspaces/b3-2026/classes/new_class.json'].toolGrants={[tool]:false};
  const g=gate(data,{},tool);
  await g.resolveStudentClass();g.decide({});
  assert.ok(g.overlay(),tool+' must remain blocked when its class grant is false');
 }
});

test('signed-out users cannot read protected student records for any affected activity',async()=>{
 const tools=['rashi-letters','chazara','gematria','shorashim','weekly-quiz','halacha','yiddish','sefer-hamitzvos'];
 for(const tool of tools){
  const g=gate(structuredClone(base),{},tool,false);
  await assert.rejects(g.resolveStudentClass(),/HTTP 401/,tool+' must fail closed without Firebase auth');
 }
});
