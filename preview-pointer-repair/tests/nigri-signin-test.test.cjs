const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const helperSource=fs.readFileSync(__dirname+'/../sync-to-nigri/nigri-auth.js','utf8');
const page=fs.readFileSync(__dirname+'/../sync-to-nigri/classtime.html','utf8');

// Made-up tokens and keys only.
function load({user,fetchImpl}){
  const calls=[];
  const auth={currentUser:user,onAuthStateChanged(cb){setTimeout(()=>cb(user),0);return()=>{}}};
  const win={firebase:{auth:()=>auth,apps:[{auth:()=>auth}],app(){return{auth:()=>auth}}},B3_FIREBASE_CONFIG:{}};
  win.firebase.auth=function(){return auth};
  const sandbox={window:win,setTimeout,clearTimeout,console,fetch:async(url,opt)=>{calls.push({url,headers:{...opt.headers}});return fetchImpl(url,opt)}};
  vm.createContext(sandbox);vm.runInContext(helperSource,sandbox);
  return {NigriAuth:win.NigriAuth,calls,sandbox};
}
const signedIn={getIdToken:async()=>'fake-id-token'};

test('sends the sign-in first and does not send the key when accepted',async()=>{
  const {NigriAuth,calls}=load({user:signedIn,fetchImpl:()=>({status:200})});
  const out=await NigriAuth.request('/x',{method:'POST'},'fake-key');
  assert.equal(out.via,'signin');assert.equal(calls.length,1);
  assert.equal(calls[0].headers.Authorization,'Bearer fake-id-token');assert.equal(calls[0].headers['X-Sync-Key'],undefined);
});
test('falls back to the key after a 401 refusal',async()=>{
  let n=0;const {NigriAuth,calls}=load({user:signedIn,fetchImpl:()=>({status:n++===0?401:200})});
  const out=await NigriAuth.request('/x',{method:'POST'},'fake-key');
  assert.equal(out.via,'key');assert.equal(out.response.status,200);assert.equal(calls[1].headers['X-Sync-Key'],'fake-key');assert.equal(calls[1].headers.Authorization,undefined);
});
test('uses the key when nobody is signed in, and reports none when there is no key either',async()=>{
  const a=load({user:null,fetchImpl:()=>({status:200})});
  assert.equal((await a.NigriAuth.request('/x',{},'fake-key')).via,'key');
  const b=load({user:null,fetchImpl:()=>({status:200})});
  const none=await b.NigriAuth.request('/x',{});assert.equal(none.via,'none');assert.equal(none.response,null);assert.equal(b.calls.length,0);
});
test('does not retry other errors with the key',async()=>{
  const {NigriAuth,calls}=load({user:signedIn,fetchImpl:()=>({status:500})});
  assert.equal((await NigriAuth.request('/x',{},'fake-key')).via,'signin');assert.equal(calls.length,1);
});
test('a broken Firebase never throws out of getToken',async()=>{
  const sandbox={window:{firebase:{auth:()=>{throw new Error('x')},apps:[1],app(){throw new Error('x')}}},setTimeout,clearTimeout};
  vm.createContext(sandbox);vm.runInContext(helperSource,sandbox);
  assert.equal(await sandbox.window.NigriAuth.getToken(),null);
});

// The button script on the page, run against fake page elements.
function runButton({token,status,throws}){
  const script=page.match(/<script>\s*\(function \(\) \{\s*const button = document\.getElementById\('nigriTest'\)[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g,'');
  const els={nigriTest:{disabled:false,addEventListener(_,f){this.click=f}},nigriTestResult:{textContent:''}};
  const requested=[];
  const sandbox={document:{getElementById:id=>els[id]},NigriAuth:{getToken:async()=>token,request:async(path,opt,key)=>{requested.push({path,opt,key});if(throws)throw new Error('x');return{response:{status}}}}};
  vm.createContext(sandbox);vm.runInContext(script,sandbox);
  return {els,requested,click:()=>els.nigriTest.click()};
}
test('button says Sign-in accepted on 400, refused on 401, and uses the invalid class with no key',async()=>{
  const ok=runButton({token:'t',status:400});await ok.click();
  assert.equal(ok.els.nigriTestResult.textContent,'Sign-in accepted');
  assert.equal(ok.requested[0].path,'/read-marks?class=NOT_A_CLASS');assert.equal(ok.requested[0].opt.method,'GET');assert.equal(ok.requested[0].key,undefined);
  const no=runButton({token:'t',status:401});await no.click();assert.equal(no.els.nigriTestResult.textContent,'Sign-in refused');
  const odd=runButton({token:'t',status:500});await odd.click();assert.match(odd.els.nigriTestResult.textContent,/Could not check/);
  assert.equal(odd.els.nigriTest.disabled,false);
});
test('button asks you to sign in first, and survives a network failure',async()=>{
  const out=runButton({token:null,status:400});await out.click();
  assert.match(out.els.nigriTestResult.textContent,/Not signed in/);assert.equal(out.requested.length,0);
  const down=runButton({token:'t',throws:true});await down.click();assert.equal(down.els.nigriTestResult.textContent,'Could not reach the server.');
});
test('the Classtime page, its review script and the helper contain no Nigri write route or key',()=>{
  const review=fs.readFileSync(__dirname+'/../sync-to-nigri/classtime-review.js','utf8');
  for(const text of [page,helperSource,review])assert.doesNotMatch(text,/sync-marks|sync-points/);
  for(const text of [page,review])assert.doesNotMatch(text,/X-Sync-Key/);
  assert.match(page,/<script src="\.\/classtime-review\.js"><\/script>/);
});
