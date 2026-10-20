const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('direct Admin entry offers Google sign-in without class reads or retry loop when signed out',async()=>{
 const html=fs.readFileSync('admin.html','utf8'),start=html.indexOf('function taEsc('),end=html.indexOf('// ---- Owner Control page',start);
 const nodes={},document={getElementById:id=>nodes[id]||(nodes[id]={innerHTML:'',textContent:''})};let signIns=0;
 const api={getCurrentAccess:()=>({authorized:false,role:'',classIds:[]}),signInWithGoogle:async()=>{signIns++;throw Error('Please choose your teacher account.');}};
 const context={document,frame:{contentWindow:{B3SiteSettings:api,firebase:{database:()=>({ref(){throw Error('Signed-out visitors must not read a class');}})}}},setTimeout(){throw Error('Signed-out sign-in must not loop');},console};
 vm.runInNewContext(html.slice(start,end)+'\nthis.renderTeacherAccess=renderTeacherAccess;',context);
 await context.renderTeacherAccess();assert.match(nodes.teacherAccessPanel.innerHTML,/Sign in with Google/);assert.doesNotMatch(nodes.teacherAccessPanel.innerHTML,/Loading your class/);
 await nodes.taSignIn.onclick();assert.equal(signIns,1);assert.match(nodes.taSignInStatus.textContent,/choose your teacher account/);
});
test('homepage Admin entry routes signed-out visitors directly to teacher sign-in',()=>{
 const html=fs.readFileSync('index.html','utf8');assert.match(html,/window\.location\.href=isAuthorizedTeacher\?"admin\.html":"teacher-home\.html\?signin=1"/);
});
