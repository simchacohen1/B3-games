const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function dashboard(rows,search='',{emailLink=false}={}){const nodes={},reads=[];const node=id=>nodes[id]||(nodes[id]={classList:{add(){},remove(){}},parentElement:{appendChild(){}},innerHTML:'',textContent:'',querySelectorAll:()=>[]});const api={workspaceId:'b3-2026',isEmailSignInLink:()=>emailLink,onAuthStateChanged:cb=>api.callback=cb};const document={getElementById:node,createElement:()=>({set textContent(v){this.innerHTML=String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}})};const html=fs.readFileSync('teacher-home.html','utf8'),code=html.match(/<script>\s*(\(function\(\)\{[\s\S]*?)<\/script>/)[1];vm.runInNewContext(code,{URLSearchParams,window:{B3SiteSettings:api,B3_FIREBASE_CONFIG:{}},firebase:{apps:[{}],database:()=>({ref:p=>({once:async()=>{reads.push(p);return {val:()=>rows[p]||{},exists:()=>!!rows[p]}}})})},document,location:{search,replace(){}},console});return {nodes,reads,run:access=>api.callback({email:'teacher@test'},true,access)};}
test('regular teacher receives icon cards with selected-class links',async()=>{const x=dashboard({'b3Games/workspaces/b3-2026/classes/mine':{name:'Mine',active:true,toolGrants:{chazara:true,yiddish:true,'weekly-quiz':false}}});await x.run({authorized:true,role:'teacher',classIds:['mine']});const cards=x.nodes.classes.innerHTML;assert.match(cards,/tool-icon/);assert.match(cards,/🔁/);assert.match(cards,/yiddish-icon-v2.png/);assert.match(cards,/chazara\/teacher.html\?class=mine/);assert.ok(!cards.includes('weekly-quiz/teacher'));assert.deepEqual(x.reads,['b3Games/workspaces/b3-2026/classes/mine'])});
test('disabled classes produce no teacher tool cards',async()=>{const x=dashboard({'b3Games/workspaces/b3-2026/classes/mine':{active:false,toolGrants:{chazara:true}}});await x.run({authorized:true,role:'teacher',classIds:['mine']});assert.ok(!x.nodes.classes.innerHTML.includes('chazara/teacher'))});

test('administrator student tool entry lists active classes without using wildcard as a class ID',async()=>{
 const root='b3Games/workspaces/b3-2026/classes',row={name:'ET',active:true,members:{child:{active:true}}};
 const x=dashboard({[root]:{et:row,off:{active:false}},[root+'/et']:row},'?manageStudentTools=1');
 await x.run({authorized:true,role:'admin',classIds:['*']});
 assert.deepEqual(x.reads,[root,root+'/et']);assert.match(x.nodes.classes.innerHTML,/ET/);
});

test('teacher entry presents Google and email sign-in before auth resolves and for signed-out visitors',async()=>{
 const x=dashboard({});assert.match(x.nodes.gate.innerHTML,/Continue with Google/);
 await x.run({authorized:false,role:'',classIds:[]});assert.match(x.nodes.gate.innerHTML,/Continue with Google/);assert.equal(x.reads.length,0);
});

test('a new email sign-in link blocks restored teacher UI until link verification',async()=>{
 const x=dashboard({'b3Games/workspaces/b3-2026/classes/mine':{
  name:'Mine',active:true,toolGrants:{chazara:true}
 }},'',{emailLink:true});
 await x.run({authorized:true,role:'teacher',classIds:['mine']});
 assert.match(x.nodes.gate.innerHTML,/Complete email sign-in/);
 assert.match(x.nodes.teacherSignInStatus.textContent,/Complete the email-link verification/);
 assert.equal(x.reads.length,0);
 assert.equal(x.nodes.classes.innerHTML,'');
});
