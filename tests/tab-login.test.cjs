const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('site-settings.js','utf8');
function storage(){const m=new Map();return {get length(){return m.size},getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()};}
const shared=storage();
function tab(session=storage()){
 const user={uid:'teacher',email:'simcha5770@gmail.com',getIdToken:async()=> 'test-token'};
 const cls={name:'Class',active:true,members:{alice:{name:'Alice'},bob:{name:'Bob'}}};
 const db={ref:path=>({once:async()=>({val:()=>path.endsWith('/classes/et')?cls:null})})};
 const auth={currentUser:user,onAuthStateChanged:fn=>{fn(user);return ()=>{};},setPersistence:async function(p){this.persistence=p;}};
 const firebase={apps:[{}],database:()=>db,auth:()=>auth};
 firebase.auth.Auth={Persistence:{SESSION:'SESSION'}};
 const window={firebase,B3_FIREBASE_CONFIG:Object.fromEntries(['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId'].map(k=>[k,'test']))};
 const location={href:'https://example.test/index.html'};
 vm.runInNewContext(source,{window,firebase,sessionStorage:session,localStorage:shared,location,document:{readyState:'loading',addEventListener(){},getElementsByTagName:()=>[]},fetch:async()=>({ok:true,json:async()=>({passcodes:{alice:'1111',bob:'2222'}})}),AbortSignal,URL,console,Intl,Date,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto});
 return {api:window.B3SiteSettings,session,auth};
}
test('teacher tab and two student tabs keep separate identities through reload and exit',async()=>{
 const teacher=tab(),a=tab(),b=tab();
 await a.api.startActingAsStudent('et','alice');
 await b.api.startActingAsStudent('et','bob');
 assert.equal(teacher.api.getActingStudent(),null);
 assert.equal(a.api.getActingStudent().id,'alice');assert.equal(b.api.getActingStudent().id,'bob');
 assert.equal(tab(a.session).api.getActingStudent().id,'alice');
 assert.equal(shared.getItem('b3Games_classPin'),null);
 assert.equal(a.session.getItem('b3Games_classPin'),'1111');assert.equal(b.session.getItem('b3Games_classPin'),'2222');
 a.api.stopActingAsStudent();assert.equal(a.api.getActingStudent(),null);
 assert.equal(b.api.getActingStudent().id,'bob');assert.equal(teacher.auth.currentUser.uid,'teacher');
});
test('teacher remains signed in while a new student tab gets its own session',async()=>{
 const teacher=tab();
 const childSession=storage();
 const child={closed:false,sessionStorage:childSession,opener:{},document:{readyState:'complete'},location:{replace(url){this.href=url;}}};
 await teacher.api.startActingAsStudent('et','alice',child);
 assert.equal(teacher.auth.currentUser.uid,'teacher');
 assert.equal(teacher.auth.persistence,'SESSION');
 assert.equal(teacher.api.getActingStudent(),null);
 assert.equal(teacher.session.getItem('b3Games_studentId'),null);
 assert.equal(childSession.getItem('b3Games_studentId'),'alice');
 assert.equal(childSession.getItem('b3Games_classPin'),'1111');
 assert.equal(childSession.getItem('b3ActAsSeparateTab'),'1');
 assert.equal(JSON.parse(childSession.getItem('b3ActingAsStudent')).id,'alice');
 assert.match(child.location.href,/index\.html/);
 assert.equal(child.opener,null);
});
test('old browser-wide student mode is not inherited by new tabs',()=>{
 shared.setItem('b3ActingAsStudent',JSON.stringify({id:'old',classId:'et'}));
 assert.equal(tab().api.getActingStudent(),null);shared.clear();
});

test('switching an open student tab wipes the old student first and keeps one tab',async()=>{
 const teacher=tab();
 const childSession=storage();
 let signedOut=0;
 const child={closed:false,sessionStorage:childSession,opener:{},document:{readyState:'complete'},firebase:{auth:()=>({signOut:async()=>{signedOut++;}})},location:{replace(url){this.href=url;}}};
 await teacher.api.startActingAsStudent('et','alice',child);
 childSession.setItem('someToolCache','alice-data');
 const token1=childSession.getItem('b3ActAsToken');
 await teacher.api.startActingAsStudent('et','bob',child);
 assert.equal(signedOut,2,'old student is signed out before each start');
 assert.equal(childSession.getItem('someToolCache'),null);
 assert.equal(childSession.getItem('b3Games_studentId'),'bob');
 assert.equal(childSession.getItem('b3Games_classPin'),'2222');
 assert.equal(JSON.parse(childSession.getItem('b3ActingAsStudent')).id,'bob');
 assert.notEqual(childSession.getItem('b3ActAsToken'),token1);
 assert.equal(teacher.auth.currentUser.uid,'teacher');
});
test('a tab that cannot be cleared is refused and gets nothing for the new student',async()=>{
 const teacher=tab();
 const stuck=storage();stuck.setItem('b3ActingAsStudent',JSON.stringify({id:'alice',classId:'et'}));
 stuck.clear=()=>{};
 const child={closed:false,sessionStorage:stuck,opener:{},document:{readyState:'complete'},location:{replace(url){this.href=url;}}};
 await assert.rejects(()=>teacher.api.startActingAsStudent('et','bob',child),/clear the previous student/);
 assert.equal(stuck.getItem('b3Games_studentId'),null);
});
