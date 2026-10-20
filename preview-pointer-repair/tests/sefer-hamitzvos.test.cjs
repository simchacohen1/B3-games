const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function gate(data={},stored={},tool="yiddish"){
 const elements=new Map(),storage=new Map(Object.entries({b3Games_studentId:'child',b3Games_studentClass:'new_class',...stored}));
 function element(){return {style:{},dataset:{},parentNode:{removeChild(){}},appendChild(){},setAttribute(){},contains(){return false},querySelector(){return {textContent:''}},remove(){},set innerHTML(v){this.html=v}}}
 const document={currentScript:{src:'https://example.test/game-gate.js',getAttribute:k=>k==='data-game-id'?tool:null},head:element(),documentElement:element(),body:element(),scripts:[],readyState:'complete',createElement:element,getElementById:id=>elements.get(id),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
 const ctx={document,window:{B3StudentTools:require('../backend/functions/student-tool-policy.js'),addEventListener(){}},location:{search:''},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},URL,URLSearchParams,Intl,Date,console,setTimeout:()=>1,clearTimeout(){},setInterval(){},fetch:async url=>({ok:true,json:async()=>data[new URL(url).pathname]??null})};
 let source=fs.readFileSync('game-gate.js','utf8').replace(/\r\n/g,'\n');source=source.replace(/  (?:if \(!isGuestPreview\(\)\) )?watchTeacherAccess\(\);\s*checkNow\(\);/,`  markAuthReady(); window.testGate={resolveStudentClass,decide,state:()=>({studentClassId,studentActive}),overlay:()=>overlay,setTeacher:v=>verifiedTeacherAccess=v};`);
 vm.runInNewContext(source,ctx);return ctx.window.testGate;
}
const tool='sefer-hamitzvos';
function records(classId='new_class') {const cls={active:true,members:{child:{active:true}},toolGrants:{[tool]:true}};return {
 '/b3Games/students/child/profile.json':{active:true},
 '/b3Games/students/child/memberships.json':{a:{workspaceId:'b3-2026',classId,active:true}},
 ['/b3Games/workspaces/b3-2026/classes/'+classId+'.json']:cls,
 ['/b3Games/workspaces/b3-2026/classes/'+classId+'/active.json']:true,
 ['/b3Games/workspaces/b3-2026/classes/'+classId+'/members/child.json']:{active:true},
 ['/b3Games/workspaces/b3-2026/classes/'+classId+'/name.json']:'Synthetic Class',
 ['/b3Games/workspaces/b3-2026/classes/'+classId+'/siteEnabled.json']:true,
 ['/b3Games/workspaces/b3-2026/classes/'+classId+'/access.json']:null,
 ['/b3Games/workspaces/b3-2026/classes/'+classId+'/toolGrants.json']:{[tool]:true}
};}
test('Sefer HaMitzvos direct links enforce and refresh class grants, individual restrictions and emergency locks',async()=>{
 const data=records(),cls=data['/b3Games/workspaces/b3-2026/classes/new_class.json'],classPath='/b3Games/workspaces/b3-2026/classes/new_class',g=gate(data,{},tool);
 await g.resolveStudentClass();g.decide({});assert.equal(g.overlay(),null);
 data[classPath+'/toolGrants.json'][tool]=false;await g.resolveStudentClass();g.decide({});assert.ok(g.overlay());
 data[classPath+'/toolGrants.json'][tool]=true;data[classPath+'/members/child.json'].toolAccess={[tool]:false};await g.resolveStudentClass();g.decide({});assert.ok(g.overlay());
 delete data[classPath+'/members/child.json'].toolAccess;await g.resolveStudentClass();g.decide({siteEnabled:false});assert.ok(g.overlay());
 g.decide({});assert.equal(g.overlay(),null);
 data[classPath+'/access.json']={mode:'locked'};await g.resolveStudentClass();g.decide({});assert.ok(g.overlay());
});
test('Sefer HaMitzvos preserves ET lock, tool switch and teacher exceptions',async()=>{
 const g=gate(records('et'),{b3Games_studentClass:'et'},tool);await g.resolveStudentClass();
 g.decide({classAccess:{et:{mode:'locked'}}});assert.ok(g.overlay());
 g.decide({classAccess:{et:{mode:'open'}},classGames:{et:{[tool]:false}}});assert.ok(g.overlay());
 g.decide({classAccess:{et:{mode:'locked'}},studentGameOverrides:{child:{[tool]:true}}});assert.equal(g.overlay(),null);
});
test('all 613 original and coloring card pairs exist and page uses the shared gate',()=>{
 for(let n=1;n<=613;n++){const id=String(n).padStart(3,'0');for(const file of ['original/'+id+'.jpg','coloring/'+id+'.png'])assert.ok(fs.statSync('sefer-hamitzvos/'+file).size>0,file);}
 const html=fs.readFileSync('sefer-hamitzvos/index.html','utf8');assert.match(html,/src="..\/game-gate.js(?:\?[^\"]*)?" data-game-id="sefer-hamitzvos"/);
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];new vm.Script(script);
});
