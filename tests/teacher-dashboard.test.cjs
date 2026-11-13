const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function dashboard(rows,search=''){
 const nodes={},reads=[],listeners={};
 const node=id=>nodes[id]||(nodes[id]={classList:{values:new Set(),add(...v){v.forEach(x=>this.values.add(x))},remove(...v){v.forEach(x=>this.values.delete(x))}},parentElement:{appendChild(){}},innerHTML:'',textContent:'',replaceChildren(){this.innerHTML=''}});
 const api={workspaceId:'b3-2026',onAuthStateChanged:cb=>api.callback=cb};
 const document={getElementById:node,createElement:()=>({set textContent(v){this.innerHTML=String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}})};
 const db={ref:p=>({
  once:async()=>{reads.push(p);return {val:()=>rows[p]||{},exists:()=>!!rows[p]}},
  on:(event,listener)=>{listeners[p]=listener;listener({val:()=>rows[p]||null})},
  off:(event,listener)=>{if(listeners[p]===listener)delete listeners[p]}
 })};
 const html=fs.readFileSync('teacher-home.html','utf8'),code=html.match(/<script>\s*(\(function\(\)\{[\s\S]*?)<\/script>/)[1];
 vm.runInNewContext(code,{URLSearchParams,window:{B3SiteSettings:api,B3_FIREBASE_CONFIG:{},B3PrincipalScope:require('../principal-scope.js'),addEventListener(){}},firebase:{apps:[{}],database:()=>db},document,location:{search,replace(){}},console});
 return {nodes,reads,listeners,run:access=>api.callback({email:'teacher@test',uid:'principal-1'},true,access)};
}
test('regular teacher receives icon cards with selected-class links',async()=>{const x=dashboard({'b3Games/workspaces/b3-2026/classes/mine':{name:'Mine',active:true,toolGrants:{chazara:true,yiddish:true,'weekly-quiz':false}}});await x.run({authorized:true,role:'teacher',classIds:['mine']});const cards=x.nodes.classes.innerHTML;assert.match(cards,/tool-icon/);assert.match(cards,/🔁/);assert.match(cards,/yiddish-icon-v2.png/);assert.match(cards,/chazara\/teacher.html\?class=mine/);assert.ok(!cards.includes('weekly-quiz/teacher'));assert.deepEqual(x.reads,['b3Games/workspaces/b3-2026/classes/mine'])});
test('disabled classes produce no teacher tool cards',async()=>{const x=dashboard({'b3Games/workspaces/b3-2026/classes/mine':{active:false,toolGrants:{chazara:true}}});await x.run({authorized:true,role:'teacher',classIds:['mine']});assert.ok(!x.nodes.classes.innerHTML.includes('chazara/teacher'))});

test('administrator student tool entry lists active classes without using wildcard as a class ID',async()=>{
 const root='b3Games/workspaces/b3-2026/classes',row={name:'ET',active:true,members:{child:{active:true}}};
 const x=dashboard({[root]:{et:row,off:{active:false}},[root+'/et']:row},'?manageStudentTools=1');
 await x.run({authorized:true,role:'admin',classIds:['*']});
 assert.deepEqual(x.reads,[root,root+'/et']);assert.match(x.nodes.classes.innerHTML,/ET/);
});

test('teacher entry waits for auth before showing Google sign-in to signed-out visitors',async()=>{
 const x=dashboard({});
 // The actual page initially displays a neutral loading gate, not a login form.
 assert.equal(x.nodes.gate,undefined);
 assert.match(fs.readFileSync('teacher-home.html','utf8'),/id="gate" class="gate">Checking your teacher account/);
 await x.run({authorized:false,role:'',classIds:[]});
 assert.match(x.nodes.gate.innerHTML,/Sign in with Google/);
 assert.equal(x.reads.length,0);
});
test('principal dashboard removes class links immediately when supervision is revoked',async()=>{
 const teacherPath='b3Games/workspaces/b3-2026/teachers/principal-1';
 const x=dashboard({[teacherPath]:{role:'teacher',accountType:'principal',active:true,classIds:{et:true},supervisedTeachers:{rabbiA:{name:'Rabbi A',classIds:{et:true}}}},'b3Games/workspaces/b3-2026/classes/et':{name:'ET',active:true,toolGrants:{chazara:true}}});
 await x.run({authorized:true,role:'teacher',accountType:'principal',classIds:['et'],supervisedTeachers:{rabbiA:{name:'Rabbi A',classIds:{et:true}}}});
 await new Promise(setImmediate);
 assert.match(x.nodes.classes.innerHTML,/ET/);
 x.listeners[teacherPath]({val:()=>({role:'teacher',accountType:'principal',active:false,classIds:{}})});
 await new Promise(setImmediate);
 assert.doesNotMatch(x.nodes.classes.innerHTML,/ET/);
 assert.ok(x.nodes.signOut.classList.values.has('hidden'));
});

const CLS='b3Games/workspaces/b3-2026/classes/';
test('teacher home uses the Learning Island groups, only for tools turned on',async()=>{
 const x=dashboard({[CLS+'mine']:{name:'Mine',active:true,toolGrants:{chazara:true,shorashim:true,'weekly-quiz':true,'class-pointer':true}}});
 await x.run({authorized:true,role:'teacher',classIds:['mine']});
 const html=x.nodes.classes.innerHTML;
 for(const t of ['Chumash Cheder','Shorashim Grove','Challenge Playground','Teacher Tools'])assert.ok(html.includes(t),t);
 for(const t of ['Skills Library','Learning Beis Midrash','Class Village'])assert.ok(!html.includes(t),t+' should be hidden when none of its tools are on');
 assert.match(html,/class-pointer-prototype\/dashboard.html\?teacher=1&class=mine/);
 assert.ok(!html.includes('rashi-letters/teacher'));
});
test('owner-only links never appear on a teacher home',async()=>{
 const all={};for(const k of ['sefer-hamitzvos','halacha','yiddish','posuk-practice-scroll','rashi-letters','gematria','shorashim','chazara','game-show','student-rewards','weekly-quiz','gallery','class-pointer','name-picker','chavrusa','davening'])all[k]=true;
 const x=dashboard({[CLS+'mine']:{name:'Mine',active:true,toolGrants:all}});
 await x.run({authorized:true,role:'teacher',classIds:['mine']});
 const html=x.nodes.classes.innerHTML;
 for(const bad of ['sync-to-nigri','owner-admin','class-dashboard','comment-log'])assert.ok(!html.includes(bad),bad);
});
test('a new class with no tools shows a friendly empty state and no tool groups',async()=>{
 const x=dashboard({[CLS+'fresh']:{name:'Fresh',active:true}});
 await x.run({authorized:true,role:'teacher',classIds:['fresh']});
 const html=x.nodes.classes.innerHTML;
 assert.match(html,/No tools have been enabled for this class yet/);
 assert.ok(!html.includes('chazara/teacher')&&!html.includes('data-place="learn"'));
});
test('addClass in Owner Admin creates classes without any tool grants',()=>{
 const src=fs.readFileSync('owner-admin.html','utf8');
 const line=src.split('\n').find(l=>l.includes('q("addClass").onclick'));
 assert.ok(line&&/\.set\(\{name:name,active:true\}\)/.test(line));
 assert.ok(!/toolGrants/.test(line));
});
