const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('direct Admin entry offers Google sign-in without class reads or retry loop when signed out',async()=>{
 const html=fs.readFileSync('admin.html','utf8'),start=html.indexOf('function taEsc('),end=html.indexOf('// ---- Owner Control page',start);
 const nodes={},document={getElementById:id=>nodes[id]||(nodes[id]={innerHTML:'',textContent:''})};let signIns=0;
 // Class Access now waits for the remembered-login restore to finish; B3SiteSettings reports "signed out" only after it failed.
 const api={getCurrentAccess:()=>({authorized:false,role:'',classIds:[]}),onAuthStateChanged:cb=>{setImmediate(()=>cb(null,false,{authorized:false}));return()=>{};},signInWithGoogle:async()=>{signIns++;throw Error('Please choose your teacher account.');}};
 // Only the 12 s safety timeout of that wait is allowed; a short timer would be a retry loop.
 const context={document,frame:{contentWindow:{B3SiteSettings:api,firebase:{database:()=>({ref(){throw Error('Signed-out visitors must not read a class');}})}}},setTimeout(fn,ms){if(!(ms>=10000))throw Error('Signed-out sign-in must not loop');return 1;},clearTimeout(){},console};
 vm.runInNewContext(html.slice(start,end)+'\nthis.renderTeacherAccess=renderTeacherAccess;',context);
 await context.renderTeacherAccess();assert.match(nodes.teacherAccessPanel.innerHTML,/Sign in with Google/);assert.doesNotMatch(nodes.teacherAccessPanel.innerHTML,/Loading your class/);
 await nodes.taSignIn.onclick();assert.equal(signIns,1);assert.match(nodes.taSignInStatus.textContent,/choose your teacher account/);
});
test('homepage Admin entry routes signed-out visitors directly to teacher sign-in',()=>{
 const html=fs.readFileSync('index.html','utf8');assert.match(html,/window\.location\.href=isAuthorizedTeacher\?"admin\.html":"teacher-home\.html\?signin=1"/);
});
test('remembered teacher login restored after the first empty check never shows Google sign-in',async()=>{
 const html=fs.readFileSync('admin.html','utf8'),start=html.indexOf('function taEsc('),end=html.indexOf('// ---- Owner Control page',start);
 const nodes={},document={getElementById:id=>nodes[id]||(nodes[id]={innerHTML:'',textContent:''})};let authorized=false,shown=0;
 const api={getCurrentAccess:()=>({authorized,role:'teacher',classIds:['et']}),onAuthStateChanged:cb=>{setImmediate(()=>{authorized=true;cb({uid:'t'},true,{authorized:true});});return()=>{};},signInWithGoogle:async()=>{throw Error('must not ask');}};
 const context={document,currentTab:'access',showTab(){shown++;},applyRoleView(){},frame:{contentWindow:{B3SiteSettings:api,firebase:{database:()=>({}),auth:()=>({currentUser:null,authStateReady:async()=>{}})}}},setTimeout(fn,ms){if(!(ms>=10000))throw Error('loop');return 1;},clearTimeout(){},console};
 vm.runInNewContext(html.slice(start,end)+'\nthis.renderTeacherAccess=renderTeacherAccess;',context);
 await context.renderTeacherAccess();
 assert.equal(shown,1);assert.doesNotMatch(nodes.teacherAccessPanel.innerHTML,/Sign in with Google/);
});
