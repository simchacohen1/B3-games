const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('site-settings.js','utf8');
function storage(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()};}
const shared=storage();
function tab(session=storage()){
 const user={uid:'teacher',email:'simcha5770@gmail.com',getIdToken:async()=> 'test-token'};
 const cls={name:'Class',active:true,members:{alice:{name:'Alice'},bob:{name:'Bob'}}};
 const db={ref:path=>({once:async()=>({val:()=>path.endsWith('/classes/et')?cls:null})})};
 const auth={currentUser:user,onAuthStateChanged:fn=>{fn(user);return ()=>{};}};
 const firebase={apps:[{}],database:()=>db,auth:()=>auth};
 const window={firebase,B3_FIREBASE_CONFIG:Object.fromEntries(['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId'].map(k=>[k,'test']))};
 const location={href:'https://example.test/index.html'};
 vm.runInNewContext(source,{window,firebase,sessionStorage:session,localStorage:shared,location,document:{readyState:'loading',addEventListener(){},getElementsByTagName:()=>[]},fetch:async()=>({ok:true,json:async()=>({passcodes:{alice:'1111',bob:'2222'}})}),AbortSignal,URL,console,Intl,Date});
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
test('old browser-wide student mode is not inherited by new tabs',()=>{
 shared.setItem('b3ActingAsStudent',JSON.stringify({id:'old',classId:'et'}));
 assert.equal(tab().api.getActingStudent(),null);shared.clear();
});
